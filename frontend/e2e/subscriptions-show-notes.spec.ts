import { expect, test } from "@playwright/test";

test("shows the expected episode actions and opens show notes", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });

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
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        podcasts: [
          {
            id: 1,
            title: "Build Your SaaS",
            rssUrl: "https://example.com/feed.xml",
            description: "Build in public",
            imageUrl: null,
            lastChecked: "2026-05-22T08:00:00Z",
            updateTime: null,
          },
        ],
      }),
    });
  });

  await page.route("**/api/playlist", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        items: [],
      }),
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
            title: "QA reorder third",
            description: "Episode notes from Playwright",
            audioUrl: "https://example.com/audio.mp3",
            duration: 900,
            downloaded: false,
            isListened: false,
            publishedAt: "2026-05-20T10:00:00Z",
          },
        ],
      }),
    });
  });

  await page.goto("/subscriptions");

  await expect(page.getByRole("heading", { name: "Subscriptions" })).toBeVisible();
  await expect(page.getByText("QA reorder third")).toBeVisible();
  await expect(page.getByRole("button", { name: "Download" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add to playlist" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Show notes" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Mark as listened" })).toBeVisible();

  await page.getByRole("button", { name: "Show notes" }).click();

  await expect(page.getByText("Show notes")).toBeVisible();
  await expect(
    page.getByText("Build Your SaaS - QA reorder third")
  ).toBeVisible();
  await expect(page.getByText("Episode notes from Playwright")).toBeVisible();
});

test("mobile subscriptions can scroll to the last shown episode", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });

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
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        podcasts: [
          {
            id: 1,
            title: "Long Feed",
            rssUrl: "https://example.com/feed.xml",
            description: "Lots of episodes",
            imageUrl: null,
            lastChecked: "2026-05-22T08:00:00Z",
            updateTime: null,
          },
        ],
      }),
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
        episodes: Array.from({ length: 40 }, (_, index) => ({
          id: 100 + index,
          podcastId: 1,
          title: `Episode ${index + 1}`,
          description: `Episode ${index + 1} notes`,
          audioUrl: "https://example.com/audio.mp3",
          duration: 900,
          downloaded: false,
          isListened: false,
          publishedAt: new Date(Date.UTC(2026, 4, index + 1, 10)).toISOString(),
        })),
      }),
    });
  });

  await page.goto("/subscriptions");

  await expect(page.getByText("Episode 1", { exact: true })).toBeVisible();

  const scroller = page.locator(".mpod-scroll").first();
  await expect(scroller).toBeVisible();

  await scroller.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
    element.dispatchEvent(new Event("scroll", { bubbles: true }));
  });

  await expect(page.getByText("Episode 40", { exact: true })).toBeVisible();
});
