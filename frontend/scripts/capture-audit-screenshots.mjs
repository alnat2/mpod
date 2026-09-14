import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");
const frontendDir = path.resolve(__dirname, "..");
const auditAssetsDir = path.resolve(repoRoot, "docs/audit-assets");

console.log("Starting Vite dev server on port 4173...");
const vite = spawn("npx", ["vite", "--port", "4173", "--host", "127.0.0.1"], {
  cwd: frontendDir,
  stdio: "pipe",
  shell: true,
});

vite.stdout.on("data", (d) => {
  console.log(`[vite] ${d}`);
});
vite.stderr.on("data", (d) => {
  console.error(`[vite err] ${d}`);
});
vite.on("error", (err) => {
  console.error(`[vite process error] ${err}`);
});

function waitForServer(url, timeout = 20000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const interval = setInterval(() => {
      http
        .get(url, () => {
          clearInterval(interval);
          resolve();
        })
        .on("error", () => {
          if (Date.now() - start > timeout) {
            clearInterval(interval);
            reject(new Error("Timeout waiting for Vite dev server"));
          }
        });
    }, 250);
  });
}

async function main() {
  try {
    await waitForServer("http://127.0.0.1:4173");
    console.log("Vite dev server is ready.");

    const browser = await chromium.launch({
      executablePath:
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      headless: true,
    });

    const context = await browser.newContext({
      viewport: { width: 1600, height: 1200 },
      deviceScaleFactor: 2,
    });
    const page = await context.newPage();

    console.log("Navigating to http://127.0.0.1:4173/component-preview ...");
    await page.goto("http://127.0.0.1:4173/component-preview", {
      waitUntil: "networkidle",
      timeout: 30000,
    });

    await page.waitForTimeout(1000);

    const components = [
      { id: "#audit-logo", file: "logo-actual.png" },
      { id: "#audit-topnav", file: "topnav-actual.png" },
      { id: "#audit-appshell", file: "appshell-actual.png" },
      { id: "#audit-auth", file: "auth-actual.png" },
      { id: "#audit-player", file: "player-actual.png" },
      { id: "#audit-queue", file: "queue-actual.png" },
      { id: "#audit-addpodcast", file: "addpodcast-actual.png" },
      { id: "#audit-filedropzone", file: "filedropzone-actual.png" },
      { id: "#audit-shownotes", file: "shownotes-actual.png" },
      { id: "#audit-podcastcard", file: "podcastcard-actual.png" },
      { id: "#audit-filemanager", file: "filemanager-actual.png" },
    ];

    for (const comp of components) {
      const locator = page.locator(comp.id);
      await locator.waitFor({ state: "visible", timeout: 10000 });
      const targetPath = path.join(auditAssetsDir, comp.file);
      await locator.screenshot({ path: targetPath });
      console.log(`Saved screenshot: ${comp.file}`);
    }

    // Capture ModalScreen (ShowNotes with backdrop at 1440x900)
    console.log("Navigating to ShowNotes modal view...");
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("http://127.0.0.1:4173/component-preview?modal=shownotes", {
      waitUntil: "networkidle",
      timeout: 30000,
    });
    await page.waitForTimeout(500);
    const modalScreenPath = path.join(auditAssetsDir, "modalscreen-actual.png");
    await page.screenshot({ path: modalScreenPath });
    console.log("Saved screenshot: modalscreen-actual.png");

    // Capture AudiobookPlaybackChaptersModal
    console.log("Navigating to Audiobook Chapters modal view...");
    await page.goto("http://127.0.0.1:4173/component-preview?modal=abookchapter", {
      waitUntil: "networkidle",
      timeout: 30000,
    });
    await page.waitForTimeout(500);
    const abookLocator = page.locator('[data-slot="abook-playback-chapters-modal"]');
    await abookLocator.waitFor({ state: "visible", timeout: 10000 });
    const abookPath = path.join(auditAssetsDir, "abookchapter-actual.png");
    await abookLocator.screenshot({ path: abookPath });
    console.log("Saved screenshot: abookchapter-actual.png");

    await browser.close();
    console.log("All component screenshots captured successfully!");
  } finally {
    vite.kill();
  }
}

main().catch((err) => {
  console.error("Screenshot capture failed:", err);
  vite.kill();
  process.exit(1);
});
