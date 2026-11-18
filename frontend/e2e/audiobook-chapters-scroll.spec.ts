import { expect, test } from "@playwright/test";

import { installAppShellApiMocks } from "./api-mocks";

function createMockAudiobook(chapterCount = 15, currentTrackId = 8) {
  const tracks = Array.from({ length: chapterCount }, (_, index) => {
    const id = index + 1;
    return {
      id,
      audiobookId: 5,
      trackNumber: id,
      title: `Chapter ${id}`,
      relPath: `${id}.mp3`,
      filePath: `/${id}.mp3`,
      duration: 1800,
      inPlaylist: true,
      isListened: id < currentTrackId,
      positionSeconds: id < currentTrackId ? 1800 : id === currentTrackId ? 250 : 0,
    };
  });

  const queueEpisode = {
    id: 5,
    podcastId: 0,
    type: "audiobook" as const,
    audiobookId: 5,
    trackId: currentTrackId,
    trackCount: chapterCount,
    hasChapters: true,
    title: `Chapter ${currentTrackId}`,
    author: "Author Name",
    podcastTitle: "Author Name",
    audioUrl: `/api/audiobooks/5/tracks/${currentTrackId}/audio`,
    duration: 1800,
    downloaded: true,
    isListened: false,
    publishedAt: null,
    playback: {
      audiobookId: 5,
      trackId: currentTrackId,
      positionSeconds: 250,
      lastUpdated: "2026-05-22T08:00:00Z",
    },
  };

  const audiobook = {
    id: 5,
    title: "Test Long Audiobook",
    author: "Author Name",
    relPath: "author/book",
    totalDuration: chapterCount * 1800,
    trackCount: chapterCount,
    listenedCount: currentTrackId - 1,
    isListened: false,
    positionSeconds: 250,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    hasCover: false,
    hasChapters: true,
    tracks,
  };

  return { tracks, queueEpisode, audiobook };
}

test.describe("Audiobook playback chapters auto-scroll in real browser", () => {
  test("desktop browser: clicking Show chapters automatically scrolls the current chapter to the top", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await installAppShellApiMocks(page);

    const { queueEpisode, audiobook } = createMockAudiobook(15, 8);

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

    await page.route("**/api/playback/queue", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          queue: [queueEpisode],
          activePlayback: {
            audiobookId: 5,
            trackId: 8,
            lastUpdated: "2026-05-22T08:00:00Z",
          },
        }),
      });
    });

    await page.route("**/api/audiobooks/5", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ audiobook }),
      });
    });

    await page.goto("/");

    const showChaptersBtn = page.getByRole("button", { name: "Show chapters" }).first();
    await expect(showChaptersBtn).toBeVisible();
    await showChaptersBtn.click();

    const modal = page.locator('[data-slot="abook-playback-chapters-modal"]');
    await expect(modal).toBeVisible();

    const currentTrack = modal.locator('[data-current="true"]');
    await expect(currentTrack).toBeVisible();
    await expect(currentTrack).toContainText("Chapter 8");

    // Verify real viewport scroll metrics
    const metrics = await modal.evaluate((modalEl) => {
      const viewport = modalEl.querySelector('[data-slot="scroll-area-viewport"]') as HTMLElement;
      const activeItem = modalEl.querySelector('[data-current="true"]') as HTMLElement;
      return {
        scrollTop: viewport.scrollTop,
        offsetTop: activeItem.offsetTop,
        scrollHeight: viewport.scrollHeight,
        clientHeight: viewport.clientHeight,
      };
    });

    // In desktop view (408px height), with 15 tracks (~1140px total),
    // Chapter 8 is at offset ~530px. Viewport must have scrolled to bring it to the top!
    expect(metrics.scrollTop).toBeGreaterThan(0);
    expect(Math.abs(metrics.scrollTop - metrics.offsetTop)).toBeLessThanOrEqual(2);
  });

  test("mobile browser: clicking Show chapters automatically scrolls the current chapter to the top on 360x800", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await installAppShellApiMocks(page);

    const { queueEpisode, audiobook } = createMockAudiobook(15, 10);

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

    await page.route("**/api/playback/queue", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          queue: [queueEpisode],
          activePlayback: {
            audiobookId: 5,
            trackId: 10,
            lastUpdated: "2026-05-22T08:00:00Z",
          },
        }),
      });
    });

    await page.route("**/api/audiobooks/5", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ audiobook }),
      });
    });

    await page.goto("/");

    const mobileChaptersBtn = page.locator('[data-player-action="mobile-chapters"]');
    await expect(mobileChaptersBtn).toBeVisible();
    await mobileChaptersBtn.click();

    const modal = page.locator('[data-slot="abook-playback-chapters-modal"]');
    await expect(modal).toBeVisible();

    const currentTrack = modal.locator('[data-current="true"]');
    await expect(currentTrack).toBeVisible();
    await expect(currentTrack).toContainText("Chapter 10");

    const metrics = await modal.evaluate((modalEl) => {
      const viewport = modalEl.querySelector('[data-slot="scroll-area-viewport"]') as HTMLElement;
      const activeItem = modalEl.querySelector('[data-current="true"]') as HTMLElement;
      return {
        scrollTop: viewport.scrollTop,
        offsetTop: activeItem.offsetTop,
        scrollHeight: viewport.scrollHeight,
        clientHeight: viewport.clientHeight,
      };
    });

    // In mobile view (360px height), Chapter 10 must be scrolled into view at the top
    expect(metrics.scrollTop).toBeGreaterThan(0);
    expect(Math.abs(metrics.scrollTop - metrics.offsetTop)).toBeLessThanOrEqual(2);
  });

  test("does not jump or re-scroll when user manually scrolls through the list while listening", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await installAppShellApiMocks(page);

    const { queueEpisode, audiobook } = createMockAudiobook(15, 8);

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

    await page.route("**/api/playback/queue", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          queue: [queueEpisode],
          activePlayback: {
            audiobookId: 5,
            trackId: 8,
            lastUpdated: "2026-05-22T08:00:00Z",
          },
        }),
      });
    });

    await page.route("**/api/audiobooks/5", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ audiobook }),
      });
    });

    await page.goto("/");

    const showChaptersBtn = page.getByRole("button", { name: "Show chapters" }).first();
    await showChaptersBtn.click();

    const modal = page.locator('[data-slot="abook-playback-chapters-modal"]');
    await expect(modal).toBeVisible();

    // Verify initial auto-scroll
    const initialScrollTop = await modal.evaluate((modalEl) => {
      const viewport = modalEl.querySelector('[data-slot="scroll-area-viewport"]') as HTMLElement;
      return viewport.scrollTop;
    });
    expect(initialScrollTop).toBeGreaterThan(0);

    // User manually scrolls back to the top to see previous chapters
    await modal.evaluate((modalEl) => {
      const viewport = modalEl.querySelector('[data-slot="scroll-area-viewport"]') as HTMLElement;
      viewport.scrollTop = 0;
      viewport.dispatchEvent(new Event("scroll", { bubbles: true }));
    });

    const userScrolledTop = await modal.evaluate((modalEl) => {
      const viewport = modalEl.querySelector('[data-slot="scroll-area-viewport"]') as HTMLElement;
      return viewport.scrollTop;
    });
    expect(userScrolledTop).toBe(0);

    // Wait a moment (during which time ticks or duration renders could occur)
    await page.waitForTimeout(600);

    // Position must remain at 0, not jump back to Chapter 8
    const finalScrollTop = await modal.evaluate((modalEl) => {
      const viewport = modalEl.querySelector('[data-slot="scroll-area-viewport"]') as HTMLElement;
      return viewport.scrollTop;
    });
    expect(finalScrollTop).toBe(0);
  });
});
