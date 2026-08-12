import { expect, test } from "@playwright/test";

import { installAppShellApiMocks } from "./api-mocks";

test("keeps a large subscription view bounded and visible during revalidation", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await installAppShellApiMocks(page);

  const podcasts = Array.from({ length: 10 }, (_, index) => ({
    id: index + 1,
    title: `Performance Podcast ${index + 1}`,
    rssUrl: `https://example.com/feed-${index + 1}.xml`,
    description: `Podcast ${index + 1}`,
    imageUrl: null,
    lastChecked: "2026-08-02T10:00:00Z",
    updateTime: null,
  }));
  const episodes = podcasts.flatMap((podcast, podcastIndex) =>
    Array.from(
      { length: podcastIndex === 0 ? 1_000 : 1 },
      (_, episodeIndex) => ({
        id: podcast.id * 10_000 + episodeIndex,
        podcastId: podcast.id,
        title: `Performance Episode ${podcast.id}-${episodeIndex + 1}`,
        description: null,
        audioUrl: `https://example.com/audio-${podcast.id}-${episodeIndex}.mp3`,
        duration: 1_800,
        downloaded: false,
        isListened: false,
        publishedAt: "2026-08-02T10:00:00Z",
      })
    )
  );
  let blockRevalidation = false;
  let releaseRevalidation: () => void = () => {};
  const revalidationGate = new Promise<void>((resolve) => {
    releaseRevalidation = resolve;
  });
  let podcastCalls = 0;
  let episodeCalls = 0;
  let playlistCalls = 0;

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
    podcastCalls += 1;
    if (blockRevalidation) {
      await revalidationGate;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ podcasts }),
    });
  });
  await page.route("**/api/episodes", async (route) => {
    episodeCalls += 1;
    if (blockRevalidation) {
      await revalidationGate;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ episodes }),
    });
  });
  await page.route("**/api/playlist", async (route) => {
    playlistCalls += 1;
    if (blockRevalidation) {
      await revalidationGate;
    }
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
          lastRunAt: null,
          lastSuccessAt: null,
          lastFailureAt: null,
        },
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

  await page.goto("/subscriptions");
  await expect(
    page.getByText("Performance Episode 1-1", { exact: true })
  ).toBeVisible();

  const mountedDownloadActions = await page
    .getByRole("button", { name: "Download" })
    .count();
  expect(mountedDownloadActions).toBe(0);
  expect(podcastCalls).toBeLessThanOrEqual(2);
  expect(episodeCalls).toBeLessThanOrEqual(2);
  expect(playlistCalls).toBeLessThanOrEqual(2);

  await page.getByRole("link", { name: "Settings" }).click();
  await expect(
    page.getByRole("heading", { name: "Settings", exact: true })
  ).toBeVisible();

  const podcastCallsBeforeRevalidation = podcastCalls;
  blockRevalidation = true;
  await page.getByRole("link", { name: "Subscriptions" }).click();
  await expect.poll(() => podcastCalls).toBeGreaterThan(
    podcastCallsBeforeRevalidation
  );
  await expect(
    page.getByText("Performance Episode 1-1", { exact: true })
  ).toBeVisible();
  await expect(page.getByText("Loading subscriptions")).toHaveCount(0);

  releaseRevalidation();
  await expect(
    page.getByText("Performance Episode 1-1", { exact: true })
  ).toBeVisible();
});
