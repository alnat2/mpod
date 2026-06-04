import { spawn } from "node:child_process";
import { once } from "node:events";
import { execFileSync } from "node:child_process";
import { remote } from "webdriverio";

const BASE_URL = process.env.MPOD_IOS_URL ?? "http://127.0.0.1:5050";
const DEVICE_NAME = process.env.MPOD_IOS_DEVICE ?? "iPhone 16";
const APPIUM_PORT = Number(process.env.MPOD_APPIUM_PORT ?? "4723");
const APPIUM_LOG_LEVEL = process.env.MPOD_APPIUM_LOG_LEVEL ?? "warn";
const APPIUM_START_TIMEOUT_MS = 45_000;
const TEST_USERNAME = process.env.MPOD_IOS_USERNAME ?? "mobile-qa";
const TEST_PASSWORD = process.env.MPOD_IOS_PASSWORD ?? "password123";
const CACHE_BUSTER = Date.now();

function appUrl(path) {
  const separator = path.includes("?") ? "&" : "?";
  return `${BASE_URL}${path}${separator}mpodIosSmoke=${CACHE_BUSTER}`;
}

function getBootedSimulator() {
  if (process.env.MPOD_IOS_UDID && process.env.MPOD_IOS_PLATFORM_VERSION) {
    return {
      deviceName: DEVICE_NAME,
      platformVersion: process.env.MPOD_IOS_PLATFORM_VERSION,
      udid: process.env.MPOD_IOS_UDID,
    };
  }

  const output = execFileSync("xcrun", ["simctl", "list", "devices", "booted", "--json"], {
    encoding: "utf8",
  });
  const parsed = JSON.parse(output);

  for (const [runtime, devices] of Object.entries(parsed.devices ?? {})) {
    const booted = devices.find((device) => device.state === "Booted");
    if (!booted) {
      continue;
    }

    const platformVersion = runtime.match(/iOS-(\d+-\d+)$/)?.[1]?.replace("-", ".");
    if (!platformVersion) {
      continue;
    }

    return {
      deviceName: booted.name,
      platformVersion,
      udid: booted.udid,
    };
  }

  throw new Error("No booted iOS Simulator found");
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForAppiumReady(appiumProcess) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < APPIUM_START_TIMEOUT_MS) {
    if (appiumProcess.exitCode !== null) {
      throw new Error(`Appium exited early with code ${appiumProcess.exitCode}`);
    }

    try {
      const response = await fetch(`http://127.0.0.1:${APPIUM_PORT}/status`);
      if (response.ok) {
        return;
      }
    } catch {
      // Server is still starting.
    }

    await wait(500);
  }

  throw new Error("Timed out waiting for Appium to start");
}

function startAppium() {
  const appiumProcess = spawn(
    "npx",
    ["appium", "--port", String(APPIUM_PORT), "--log-level", APPIUM_LOG_LEVEL],
    {
      cwd: new URL("../..", import.meta.url),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  appiumProcess.stdout.on("data", (chunk) => process.stdout.write(chunk));
  appiumProcess.stderr.on("data", (chunk) => process.stderr.write(chunk));

  return appiumProcess;
}

async function stopAppium(appiumProcess) {
  if (!appiumProcess || appiumProcess.exitCode !== null) {
    return;
  }

  appiumProcess.kill("SIGTERM");
  await Promise.race([once(appiumProcess, "exit"), wait(5_000)]);

  if (appiumProcess.exitCode === null) {
    appiumProcess.kill("SIGKILL");
  }
}

async function assertNoHorizontalOverflow(driver, route) {
  const result = await driver.execute(() => {
    const viewportWidth = document.documentElement.clientWidth;
    const documentOverflow =
      Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) -
      viewportWidth;

    const overflowingElements = Array.from(document.querySelectorAll("body *"))
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          className: element.className?.toString?.() ?? "",
          tagName: element.tagName,
          text: element.textContent?.trim().replace(/\s+/g, " ").slice(0, 80) ?? "",
          overflow: Math.round(element.scrollWidth - element.clientWidth),
          width: Math.round(rect.width),
        };
      })
      .filter((element) => element.width > 0 && element.overflow > 1)
      .slice(0, 10);

    return {
      documentOverflow: Math.round(documentOverflow),
      overflowingElements,
      viewportWidth,
    };
  });

  if (result.documentOverflow > 1) {
    throw new Error(
      `${route} has horizontal document overflow: ${JSON.stringify(result, null, 2)}`,
    );
  }
}

async function assertBottomNavLabelsVisible(driver, route) {
  const result = await driver.execute(() => {
    const labels = Array.from(document.querySelectorAll("nav a span, nav button span"))
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          text: element.textContent?.trim() ?? "",
          clientWidth: Math.round(element.clientWidth),
          scrollWidth: Math.round(element.scrollWidth),
          visible: rect.width > 0 && rect.height > 0,
        };
      })
      .filter((label) =>
        ["Home", "Subscriptions", "Settings", "Add podcast"].includes(label.text),
      );

    return {
      labels,
      navText: document.querySelector("nav")?.textContent?.trim().replace(/\s+/g, " "),
    };
  });

  const visibleLabels = new Set(
    result.labels.filter((label) => label.visible).map((label) => label.text),
  );
  const missingLabels = ["Home", "Subscriptions", "Settings", "Add podcast"].filter(
    (label) => !visibleLabels.has(label),
  );
  const clippedLabels = result.labels.filter(
    (label) => label.scrollWidth > label.clientWidth + 1,
  );

  if (missingLabels.length > 0 || clippedLabels.length > 0) {
    throw new Error(
      `${route} bottom nav labels are not fully visible: ${JSON.stringify(
        { missingLabels, clippedLabels, result },
        null,
        2,
      )}`,
    );
  }
}

async function assertVerticalSwipeScrolls(driver, route) {
  const before = await driver.execute(() => {
    const isScrollable = (element) => {
      const style = window.getComputedStyle(element);
      return (
        /auto|scroll/.test(style.overflowY) &&
        element.scrollHeight > element.clientHeight + 20
      );
    };
    const preferred = Array.from(document.querySelectorAll(".mpod-scroll"));
    const fallback = Array.from(document.querySelectorAll("main *"));
    const scrollers = [...preferred, ...fallback].filter(isScrollable);
    const scroller = scrollers[0] ?? document.scrollingElement;
    const rect = scroller?.getBoundingClientRect();
    return {
      rect: rect
        ? {
            bottom: Math.round(rect.bottom),
            left: Math.round(rect.left),
            right: Math.round(rect.right),
            top: Math.round(rect.top),
          }
        : null,
      contentBottom: Math.round(
        Array.from(scroller?.children ?? []).reduce((bottom, child) => {
          return Math.max(bottom, child.getBoundingClientRect().bottom);
        }, 0),
      ),
      scrollTop: scroller?.scrollTop ?? 0,
      scrollHeight: scroller?.scrollHeight ?? 0,
      clientHeight: scroller?.clientHeight ?? 0,
      viewportHeight: window.innerHeight,
    };
  });

  if (before.scrollHeight <= before.clientHeight + 20) {
    return;
  }

  const rect = before.rect;
  if (!rect) {
    throw new Error(`${route} has no detectable scroll container`);
  }

  if (before.contentBottom <= rect.bottom + 1) {
    return;
  }

  const x = Math.round((rect.left + rect.right) / 2);
  const startY = Math.max(rect.top + 80, Math.min(rect.bottom - 40, before.viewportHeight - 180));
  const endY = Math.max(rect.top + 20, startY - 260);

  await driver.execute("mobile: dragFromToForDuration", {
    duration: 0.7,
    fromX: x,
    fromY: startY,
    toX: x,
    toY: endY,
  });
  await wait(700);

  const after = await driver.execute(() => {
    const isScrollable = (element) => {
      const style = window.getComputedStyle(element);
      return (
        /auto|scroll/.test(style.overflowY) &&
        element.scrollHeight > element.clientHeight + 20
      );
    };
    const preferred = Array.from(document.querySelectorAll(".mpod-scroll"));
    const fallback = Array.from(document.querySelectorAll("main *"));
    const scrollers = [...preferred, ...fallback].filter(isScrollable);
    const scroller = scrollers[0] ?? document.scrollingElement;
    return {
      scrollTop: scroller?.scrollTop ?? 0,
    };
  });

  if (after.scrollTop <= before.scrollTop) {
    throw new Error(
      `${route} did not scroll after touch swipe: ${JSON.stringify({
        before,
        after,
      })}`,
    );
  }
}

async function bootstrapAuth(driver) {
  await driver.url(appUrl("/"));
  await wait(1_000);

  const result = await driver.executeAsync(
    async (username, password, done) => {
      async function request(path, body) {
        const response = await fetch(path, {
          method: "POST",
          credentials: "include",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify(body),
        });

        return {
          body: await response.text(),
          ok: response.ok,
          status: response.status,
        };
      }

      try {
        const sessionResponse = await fetch("/api/auth/session", {
          credentials: "include",
        });
        const session = await sessionResponse.json();

        if (session.authenticated) {
          done({ ok: true, mode: "existing-session" });
          return;
        }

        if (session.setupRequired) {
          const register = await request("/api/auth/register", {
            username,
            password,
          });
          done({ ...register, mode: "register" });
          return;
        }

        const login = await request("/api/auth/login", {
          username,
          password,
        });
        done({ ...login, mode: "login" });
      } catch (error) {
        done({
          error: error instanceof Error ? error.message : String(error),
          ok: false,
        });
      }
    },
    TEST_USERNAME,
    TEST_PASSWORD,
  );

  if (!result.ok) {
    throw new Error(`Unable to bootstrap Mobile Safari auth: ${JSON.stringify(result)}`);
  }
}

async function checkRoute(driver, route) {
  await driver.url(appUrl(route));
  await wait(1_500);

  await assertNoHorizontalOverflow(driver, route);
  await assertBottomNavLabelsVisible(driver, route);
  await assertVerticalSwipeScrolls(driver, route);

  console.log(`✓ ${route}`);
}

async function main() {
  const appiumProcess = startAppium();
  let driver;

  try {
    const simulator = getBootedSimulator();
    await waitForAppiumReady(appiumProcess);

    driver = await remote({
      hostname: "127.0.0.1",
      port: APPIUM_PORT,
      path: "/",
      capabilities: {
        platformName: "iOS",
        browserName: "Safari",
        "appium:automationName": "XCUITest",
        "appium:deviceName": simulator.deviceName,
        "appium:platformVersion": simulator.platformVersion,
        "appium:udid": simulator.udid,
        "appium:noReset": true,
        "appium:newCommandTimeout": 120,
        "appium:showXcodeLog": true,
      },
    });

    await driver.setTimeout({ script: 15_000 });
    await bootstrapAuth(driver);
    await checkRoute(driver, "/subscriptions");
    await checkRoute(driver, "/home");
    await checkRoute(driver, "/settings");
  } finally {
    if (driver) {
      await driver.deleteSession();
    }
    await stopAppium(appiumProcess);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
