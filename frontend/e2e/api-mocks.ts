import type { Page } from "@playwright/test";

export async function installAppShellApiMocks(page: Page) {
  await page.route("**/api/settings", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        settings: {
          dailyRefreshTime: "03:00",
          playbackSpeed: "Speed 1.3x",
          proxyEnabled: false,
          proxyConfigured: true,
          appBuild: "test-build",
        },
      }),
    });
  });

  await page.route("**/api/playback/queue", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ queue: [], activePlayback: null }),
    });
  });
}
