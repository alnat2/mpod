import { expect, test } from "@playwright/test";

test("keeps playlist order stable when playing and persists drag reorder", async ({
  page,
}) => {
  let queueOrder = [101, 102];
  let reorderPayload: number[] | null = null;

  await page.addInitScript(() => {
    const play = async function (this: HTMLMediaElement) {
      this.dispatchEvent(new Event("playing"));
      return Promise.resolve();
    };
    const pause = function (this: HTMLMediaElement) {
      this.dispatchEvent(new Event("pause"));
    };

    Object.defineProperty(HTMLMediaElement.prototype, "play", {
      configurable: true,
      value: play,
    });

    Object.defineProperty(HTMLMediaElement.prototype, "pause", {
      configurable: true,
      value: pause,
    });
  });

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
            title: "Queue Podcast",
            rssUrl: "https://example.com/feed.xml",
            description: null,
            imageUrl: null,
            lastChecked: null,
            updateTime: null,
          },
        ],
      }),
    });
  });

  await page.route("**/api/playlist/reorder", async (route) => {
    reorderPayload = (route.request().postDataJSON() as { episodeIds: number[] }).episodeIds;
    queueOrder = [...reorderPayload];

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ success: true }),
    });
  });

  await page.route("**/api/playlist", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        items: queueOrder.map((episodeId, index) => ({
          episodeId,
          position: index + 1,
          episode: {
            id: episodeId,
            title: episodeId === 101 ? "First queued episode" : "Second queued episode",
            podcastId: 1,
            isListened: false,
            downloaded: false,
          },
        })),
      }),
    });
  });

  await page.route("**/api/episodes/101", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        episode: {
          id: 101,
          podcastId: 1,
          title: "First queued episode",
          description: "First notes",
          audioUrl: "https://example.com/audio-101.mp3",
          duration: 900,
          downloaded: false,
          isListened: false,
          publishedAt: "2026-05-10T10:00:00Z",
        },
      }),
    });
  });

  await page.route("**/api/episodes/102", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        episode: {
          id: 102,
          podcastId: 1,
          title: "Second queued episode",
          description: "Second notes",
          audioUrl: "https://example.com/audio-102.mp3",
          duration: 1200,
          downloaded: false,
          isListened: false,
          publishedAt: "2026-05-11T10:00:00Z",
        },
      }),
    });
  });

  await page.route("**/api/playback/101", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        playback: {
          episodeId: 101,
          positionSeconds: 12,
          lastUpdated: "2026-05-22T08:00:00Z",
        },
      }),
    });
  });

  await page.route("**/api/playback/102", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        playback: {
          episodeId: 102,
          positionSeconds: 48,
          lastUpdated: "2026-05-22T08:10:00Z",
        },
      }),
    });
  });

  await page.route("**/api/playback", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        playback: {
          episodeId: 102,
          positionSeconds: 48,
          lastUpdated: "2026-05-22T08:10:00Z",
        },
      }),
    });
  });

  await page.route("**/api/episodes/*/audio", async (route) => {
    await route.fulfill({
      status: 200,
      headers: {
        "content-type": "audio/mpeg",
      },
      body: "fake-audio",
    });
  });

  await page.goto("/home");

  await expect(page.getByRole("heading", { name: "Now playing" })).toBeVisible();
  await expect(page.getByText("First queued episode").first()).toBeVisible();

  const rowsBefore = await page.locator("[data-episode-row-id]").evaluateAll((nodes) =>
    nodes.map((node) => Number((node as HTMLElement).dataset.episodeRowId))
  );
  expect(rowsBefore).toEqual([101, 102]);

  await page
    .locator('[data-episode-row-id="102"]')
    .locator('button[aria-label="Play"]')
    .first()
    .click();

  await expect(page.locator("section").filter({ hasText: "Second queued episode" }).first()).toBeVisible();

  const rowsAfterPlay = await page.locator("[data-episode-row-id]").evaluateAll((nodes) =>
    nodes.map((node) => Number((node as HTMLElement).dataset.episodeRowId))
  );
  expect(rowsAfterPlay).toEqual([101, 102]);

  const firstRow = page.locator('[data-episode-row-id="101"]');
  const secondRow = page.locator('[data-episode-row-id="102"]');
  await firstRow.dragTo(secondRow);

  await expect
    .poll(() => reorderPayload)
    .toEqual([102, 101]);
});
