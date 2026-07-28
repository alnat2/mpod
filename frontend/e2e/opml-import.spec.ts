import { expect, test } from "@playwright/test";

test("imports OPML from the empty subscriptions state", async ({ page }) => {
  let podcasts = [] as Array<{
    id: number;
    title: string;
    rssUrl: string;
    description: string | null;
    imageUrl: string | null;
    lastChecked: string | null;
    updateTime: string | null;
  }>;
  let importRequested = false;

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

  await page.route("**/api/podcasts/import-opml", async (route) => {
    importRequested = true;
    podcasts = [
      {
        id: 1,
        title: "Imported OPML Feed",
        rssUrl: "https://example.com/imported.xml",
        description: "Imported through OPML",
        imageUrl: null,
        lastChecked: null,
        updateTime: null,
      },
    ];

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        imported: 1,
        skipped: 0,
      }),
    });
  });

  await page.route("**/api/podcasts", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ podcasts }),
    });
  });

  await page.route("**/api/playlist", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ items: [] }),
    });
  });

  await page.route("**/api/podcasts/1/episodes", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        episodes: [
          {
            id: 101,
            podcastId: 1,
            title: "Imported OPML episode",
            description: "Imported episode notes",
            audioUrl: "https://example.com/audio.mp3",
            duration: 1800,
            downloaded: false,
            isListened: false,
            publishedAt: "2026-05-22T10:00:00Z",
          },
        ],
      }),
    });
  });

  await page.goto("/subscriptions");

  await expect(
    page.getByRole("heading", { name: "No podcasts", exact: true })
  ).toBeVisible();
  await page.getByRole("button", { name: "Import OPML" }).click();
  await page.locator('input[type="file"]').setInputFiles({
    name: "feeds.opml",
    mimeType: "text/x-opml",
    buffer: Buffer.from("<opml />"),
  });
  await page.getByRole("button", { name: "Add Feed" }).click();

  await expect.poll(() => importRequested).toBe(true);
  await expect(
    page.getByRole("button", { name: /Imported OPML Feed/ })
  ).toBeVisible();
  await expect(page.getByText("1 / 1 episodes")).toBeVisible();
});
