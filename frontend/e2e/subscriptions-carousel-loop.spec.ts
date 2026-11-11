import { expect, test } from "@playwright/test";

import { installAppShellApiMocks } from "./api-mocks";

function createMockPodcasts(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    title: `Podcast ${i + 1}`,
    rssUrl: `https://example.com/feed-${i + 1}.xml`,
    description: `Description ${i + 1}`,
    imageUrl: null,
    lastChecked: "2026-05-22T08:00:00Z",
    updateTime: null,
  }));
}

function setupRoutes(page: any, podcastCount: number) {
  const podcasts = createMockPodcasts(podcastCount);

  return Promise.all([
    installAppShellApiMocks(page),
    page.route("**/api/auth/session", async (route: any) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          authenticated: true,
          user: { id: 1, username: "qa" },
          setupRequired: false,
        }),
      });
    }),
    page.route("**/api/settings", async (route: any) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          settings: {
            dailyRefreshTime: "03:00",
            playbackSpeed: "Speed 1.0x",
            proxyEnabled: false,
            proxyConfigured: true,
            appBuild: "test-build",
          },
        }),
      });
    }),
    page.route("**/api/playback/queue", async (route: any) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ queue: [], activePlayback: null }),
      });
    }),
    page.route("**/api/playlist", async (route: any) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ items: [] }),
      });
    }),
    page.route("**/api/podcasts", async (route: any) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ podcasts }),
      });
    }),
    page.route("**/api/episodes", async (route: any) => {
      const episodes = podcasts.map((podcast: any) => ({
        id: 100 + podcast.id,
        podcastId: podcast.id,
        title: `Episode for ${podcast.title}`,
        audioUrl: `https://example.com/audio-${podcast.id}.mp3`,
        duration: 300,
        downloaded: false,
        isListened: false,
        publishedAt: "2026-05-20T10:00:00Z",
      }));
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ episodes }),
      });
    }),
  ]);
}

test.describe("Subscriptions Carousel Loop - Mobile", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
  });

  test("mobile carousel loops backward to the last podcast when swiping right on first podcast (2 podcasts)", async ({
    page,
  }, testInfo) => {
    await setupRoutes(page, 2);

    await page.goto("/subscriptions");

    const carousel = page.getByRole("region", {
      name: "Podcast subscriptions",
    });
    await expect(carousel).toBeVisible();

    const firstSlide = page.getByRole("group", {
      name: "Podcast 1 (1 of 2)",
    });
    const secondSlide = page.getByRole("group", {
      name: "Podcast 2 (2 of 2)",
    });

    await expect(firstSlide).toBeVisible();
    // First slide should be active (not inert)
    await expect(firstSlide.locator("[inert]")).toHaveCount(0);

    // Swipe right (from x: 100 to x: 340) to scroll backward from slide 1
    const box = await carousel.boundingBox();
    expect(box).not.toBeNull();
    const startX = box!.x + 100;
    const endX = box!.x + 340;
    const y = box!.y + box!.height / 2;

    await page.mouse.move(startX, y);
    await page.mouse.down();
    await page.mouse.move(endX, y, { steps: 10 });
    await page.mouse.up();

    // After looping backward, slide 2 (last) should become active
    await expect(secondSlide.locator("[inert]")).toHaveCount(0, {
      timeout: 5000,
    });

    await page.screenshot({
      path: testInfo.outputPath("carousel-mobile-loop.png"),
    });
  });

  test("mobile carousel loops forward to the first podcast when swiping left on last podcast (3 podcasts)", async ({
    page,
  }, testInfo) => {
    await setupRoutes(page, 3);

    await page.goto("/subscriptions");

    const carousel = page.getByRole("region", {
      name: "Podcast subscriptions",
    });
    await expect(carousel).toBeVisible();

    const firstSlide = page.getByRole("group", {
      name: "Podcast 1 (1 of 3)",
    });
    const thirdSlide = page.getByRole("group", {
      name: "Podcast 3 (3 of 3)",
    });

    await expect(firstSlide).toBeVisible();

    // Swipe right once to go backward to slide 3
    const box = await carousel.boundingBox();
    expect(box).not.toBeNull();
    const y = box!.y + box!.height / 2;

    await page.mouse.move(box!.x + 100, y);
    await page.mouse.down();
    await page.mouse.move(box!.x + 340, y, { steps: 10 });
    await page.mouse.up();

    await expect(thirdSlide.locator("[inert]")).toHaveCount(0, {
      timeout: 5000,
    });

    // Now swipe left on slide 3 to loop forward back to slide 1
    await page.mouse.move(box!.x + 340, y);
    await page.mouse.down();
    await page.mouse.move(box!.x + 100, y, { steps: 10 });
    await page.mouse.up();

    await expect(firstSlide.locator("[inert]")).toHaveCount(0, {
      timeout: 5000,
    });

    await page.screenshot({
      path: testInfo.outputPath("carousel-mobile-loop-forward.png"),
    });
  });
});

test.describe("Subscriptions Carousel Loop - Desktop", () => {
  test.use({
    viewport: { width: 1440, height: 900 },
  });

  test("desktop carousel previous button is enabled and functional with multiple podcasts", async ({
    page,
  }, testInfo) => {
    await setupRoutes(page, 6);

    await page.goto("/subscriptions");

    await expect(
      page.getByRole("heading", { name: "Podcasts" })
    ).toBeVisible();

    const prevButton = page.getByRole("button", { name: "Previous slide" });
    const nextButton = page.getByRole("button", { name: "Next slide" });

    await expect(prevButton).toBeVisible();
    await expect(nextButton).toBeVisible();

    // In a loop carousel with >= 2 items, Previous button is not disabled initially
    await expect(prevButton).toBeEnabled();
    await expect(nextButton).toBeEnabled();

    await page.screenshot({
      path: testInfo.outputPath("carousel-desktop-loop.png"),
    });
  });
});
