import { expect, test } from "@playwright/test";

import { installAppShellApiMocks } from "./api-mocks";

test("shows the expected episode actions and opens show notes", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
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
      body: JSON.stringify({
        queue: [],
        activePlayback: null,
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

  await page.route("**/api/episodes", async (route) => {
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
            showNotes:
              "Episode notes from Playwright\nhttps://example.com/episode-notes.",
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

  const showNotesDialog = page.getByRole("dialog", { name: "Show notes" });
  await expect(showNotesDialog).toBeVisible();
  await expect(
    showNotesDialog.getByText("Build Your SaaS - QA reorder third")
  ).toBeVisible();
  await expect(
    showNotesDialog.getByText("Episode notes from Playwright")
  ).toBeVisible();
  await expect(
    showNotesDialog.getByRole("link", {
      name: "https://example.com/episode-notes",
    })
  ).toHaveAttribute("href", "https://example.com/episode-notes");
});

test("mobile subscriptions can scroll to the last shown episode", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
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

  await page.route("**/api/episodes", async (route) => {
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

  const mountedEpisodeActions = await page
    .getByRole("button", { name: "More actions" })
    .count();
  expect(mountedEpisodeActions).toBeLessThan(20);

  const scroller = page.locator(".mpod-scroll").first();
  await expect(scroller).toBeVisible();

  await scroller.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
    element.dispatchEvent(new Event("scroll", { bubbles: true }));
  });

  await expect(page.getByText("Episode 40", { exact: true })).toBeVisible();
});

test("default subscriptions view includes podcasts with playlist episodes", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
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
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        podcasts: [
          {
            id: 1,
            title: "Previously Listened Show",
            rssUrl: "https://example.com/listened.xml",
            description: "Already listened but queued",
            imageUrl: null,
            lastChecked: "2026-05-22T08:00:00Z",
            updateTime: null,
          },
          {
            id: 2,
            title: "Fresh Queue Show",
            rssUrl: "https://example.com/fresh.xml",
            description: "Fresh queued episode",
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
        items: [
          {
            episodeId: 101,
            position: 1,
            episode: {
              id: 101,
              title: "Listened queued episode",
              podcastId: 1,
              isListened: true,
              downloaded: false,
            },
          },
          {
            episodeId: 201,
            position: 2,
            episode: {
              id: 201,
              title: "Fresh queued episode",
              podcastId: 2,
              isListened: false,
              downloaded: false,
            },
          },
        ],
      }),
    });
  });

  await page.route("**/api/episodes", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        episodes: [
          {
            id: 101,
            podcastId: 1,
            title: "Listened queued episode",
            description: "Queued from older data",
            audioUrl: "https://example.com/listened.mp3",
            duration: 1200,
            downloaded: false,
            isListened: true,
            publishedAt: "2026-05-20T10:00:00Z",
          },
          {
            id: 201,
            podcastId: 2,
            title: "Fresh queued episode",
            description: "Still unlistened",
            audioUrl: "https://example.com/fresh.mp3",
            duration: 900,
            downloaded: false,
            isListened: false,
            publishedAt: "2026-05-21T10:00:00Z",
          },
        ],
      }),
    });
  });

  await page.goto("/subscriptions");

  await expect(page.getByRole("heading", { name: "Subscriptions" })).toBeVisible();
  await expect(page.getByText("2 podcasts")).toBeVisible();
  await expect(page.getByRole("button", { name: "Show all" })).toBeVisible();
  await expect(page.getByText("Previously Listened Show")).toBeVisible();
  await expect(page.getByText("Fresh Queue Show")).toBeVisible();
  await expect(page.getByText("Listened queued episode")).toBeVisible();
  await expect(page.getByText("In playlist")).toBeVisible();
});
