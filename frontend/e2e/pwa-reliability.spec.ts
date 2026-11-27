import { expect, test } from "@playwright/test";

import { installAppShellApiMocks } from "./api-mocks";

test.describe("PWA reliability and pull-to-refresh", () => {
  test("mobile pull-to-refresh reloads subscriptions and opaque error banner recovers via Retry", async ({
    browser,
  }, testInfo) => {
    const context = await browser.newContext({
      viewport: { width: 360, height: 800 },
      hasTouch: true,
      colorScheme: "dark",
    });
    const page = await context.newPage();

    let podcastsCallCount = 0;
    let refreshAllCalls = 0;

    await installAppShellApiMocks(page);

    await page.route("**/api/auth/session", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          authenticated: true,
          user: { id: 1, username: "qa" },
          setupRequired: false,
        }),
      });
    });

    await page.route("**/api/podcasts", async (route) => {
      podcastsCallCount += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          podcasts: [
            {
              id: 1,
              title: "Test Podcast",
              rssUrl: "https://example.com/feed.xml",
              description: "Desc",
              imageUrl: null,
              lastChecked: null,
              updateTime: null,
            },
          ],
        }),
      });
    });

    await page.route("**/api/podcasts/refresh-all", async (route) => {
      refreshAllCalls += 1;
      await route.fulfill({
        status: 404,
        statusText: "Not Found",
        contentType: "text/html",
        body: "<html><body>Not Found</body></html>",
      });
    });

    await page.route("**/api/episodes", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ episodes: [] }),
      });
    });

    await page.route("**/api/playlist", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ items: [] }),
      });
    });

    await page.route("**/api/jobs/status", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          scheduler: {
            state: "idle",
            lastRunAt: "2026-11-26T04:40:00Z",
            lastSuccessAt: "2026-11-26T04:40:00Z",
          },
        }),
      });
    });

    await page.goto("/subscriptions");
    await expect(page.getByText("All caught up")).toBeVisible();
    const initialCalls = podcastsCallCount;

    // Simulate touch pull-to-refresh on empty state
    await page.evaluate(() => {
      const ptr = document.querySelector('[data-slot="pull-to-refresh"]');
      if (!ptr) throw new Error("Missing pull-to-refresh container");
      const target = ptr.querySelector("section") ?? ptr;
      const makeTouch = (y: number) =>
        new Touch({
          identifier: 1,
          target,
          clientX: 180,
          clientY: y,
          pageX: 180,
          pageY: y,
        });
      target.dispatchEvent(
        new TouchEvent("touchstart", {
          bubbles: true,
          cancelable: true,
          touches: [makeTouch(220)],
          targetTouches: [makeTouch(220)],
          changedTouches: [makeTouch(220)],
        })
      );
      ptr.dispatchEvent(
        new TouchEvent("touchmove", {
          bubbles: true,
          cancelable: true,
          touches: [makeTouch(300)],
          targetTouches: [makeTouch(300)],
          changedTouches: [makeTouch(300)],
        })
      );
      ptr.dispatchEvent(
        new TouchEvent("touchmove", {
          bubbles: true,
          cancelable: true,
          touches: [makeTouch(420)],
          targetTouches: [makeTouch(420)],
          changedTouches: [makeTouch(420)],
        })
      );
      ptr.dispatchEvent(
        new TouchEvent("touchend", {
          bubbles: true,
          cancelable: true,
          touches: [],
          targetTouches: [],
          changedTouches: [makeTouch(420)],
        })
      );
    });

    await expect
      .poll(() => podcastsCallCount, { timeout: 5000 })
      .toBeGreaterThan(initialCalls);

    // Trigger refresh-all to verify 404 diagnostic message and opaque banner
    await page.getByRole("button", { name: "Refresh all" }).click();
    await expect.poll(() => refreshAllCalls, { timeout: 5000 }).toBe(1);

    const alert = page.getByRole("alert");
    await expect(alert).toBeVisible();
    await expect(alert).toContainText(
      "404 Not Found (/api/podcasts/refresh-all)"
    );

    const bgColor = await alert.evaluate(
      (el) => getComputedStyle(el).backgroundColor
    );
    expect(bgColor).not.toBe("rgba(0, 0, 0, 0)");

    await page.screenshot({
      path: testInfo.outputPath("mobile-subscriptions-error-banner.png"),
    });

    const beforeRetryCalls = podcastsCallCount;
    await alert.getByRole("button", { name: "Retry" }).click();
    await expect(alert).toBeHidden();
    await expect
      .poll(() => podcastsCallCount, { timeout: 5000 })
      .toBeGreaterThan(beforeRetryCalls);

    await context.close();
  });

  test("desktop settings shows app build and Reload app control", async ({
    browser,
  }, testInfo) => {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    const page = await context.newPage();

    await installAppShellApiMocks(page);

    await page.route("**/api/auth/session", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          authenticated: true,
          user: { id: 1, username: "qa" },
          setupRequired: false,
        }),
      });
    });

    await page.route("**/api/proxy/status", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          proxy: {
            proxyEnabled: false,
            proxyConfigured: true,
            status: "off",
            externalIp: null,
            country: null,
            error: null,
          },
        }),
      });
    });

    await page.goto("/settings");
    await expect(page.getByText("Current app build: test-build")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Reload app" })
    ).toBeVisible();

    await page.screenshot({
      path: testInfo.outputPath("desktop-settings-reload.png"),
    });

    await context.close();
  });
});
