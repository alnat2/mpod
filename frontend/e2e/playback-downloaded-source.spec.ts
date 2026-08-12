import { expect, test } from "@playwright/test";

import { installAppShellApiMocks } from "./api-mocks";

test("reloads a completed download at the current playback position", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await installAppShellApiMocks(page);

  await page.addInitScript(() => {
    class FakeAudio extends EventTarget {
      private source = "";
      currentTime = 0;
      duration = 600;
      readyState = HTMLMediaElement.HAVE_METADATA;
      playbackRate = 1;
      defaultPlaybackRate = 1;
      paused = true;
      error: MediaError | null = null;
      loadCalls = 0;
      pauseCalls = 0;
      playPositions: number[] = [];

      constructor() {
        super();
        (
          globalThis as typeof globalThis & { __mpodTestAudio?: FakeAudio }
        ).__mpodTestAudio = this;
      }

      get src() {
        return this.source;
      }

      set src(value: string) {
        this.source = value;
        if (!value) {
          return;
        }
        this.readyState = HTMLMediaElement.HAVE_NOTHING;
        queueMicrotask(() => {
          this.readyState = HTMLMediaElement.HAVE_METADATA;
          this.dispatchEvent(new Event("loadedmetadata"));
          queueMicrotask(() => {
            this.readyState = HTMLMediaElement.HAVE_FUTURE_DATA;
            this.dispatchEvent(new Event("canplay"));
          });
        });
      }

      override addEventListener(
        type: string,
        callback: EventListenerOrEventListenerObject | null,
        options?: boolean | AddEventListenerOptions
      ) {
        super.addEventListener(type, callback, options);
      }

      async play() {
        this.playPositions.push(this.currentTime);
        this.paused = false;
        this.dispatchEvent(new Event("playing"));
      }

      pause() {
        if (this.paused) {
          return;
        }
        this.pauseCalls += 1;
        this.paused = true;
        this.dispatchEvent(new Event("pause"));
      }

      load() {
        this.loadCalls += 1;
        this.currentTime = 0;
        this.readyState = HTMLMediaElement.HAVE_NOTHING;
        queueMicrotask(() => {
          this.readyState = HTMLMediaElement.HAVE_METADATA;
          this.dispatchEvent(new Event("loadedmetadata"));
          queueMicrotask(() => {
            this.readyState = HTMLMediaElement.HAVE_FUTURE_DATA;
            this.dispatchEvent(new Event("canplay"));
          });
        });
      }
    }

    Object.defineProperty(globalThis, "Audio", {
      configurable: true,
      value: FakeAudio,
    });
  });

  const episode = {
    id: 1,
    podcastId: 1,
    podcastTitle: "Test Podcast",
    podcastImageUrl: null,
    title: "Downloading episode",
    description: "Notes",
    audioUrl: "https://example.com/1.mp3",
    duration: 600,
    downloaded: false,
    isListened: false,
    publishedAt: "2026-08-12T08:00:00Z",
    playback: {
      episodeId: 1,
      positionSeconds: 15,
      lastUpdated: "2026-08-12T08:00:00Z",
    },
  };
  let downloadedCheckStarted = false;
  let releaseDownloadedCheck!: () => void;
  const downloadedCheck = new Promise<void>((resolve) => {
    releaseDownloadedCheck = resolve;
  });
  let savedProgress: { positionSeconds?: number; completed?: boolean } | null =
    null;

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
        queue: [episode],
        activePlayback: {
          episodeId: 1,
          lastUpdated: "2026-08-12T08:00:00Z",
        },
      }),
    });
  });
  await page.route("**/api/playback/1", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ playback: episode.playback }),
    });
  });
  await page.route("**/api/episodes/1", async (route) => {
    downloadedCheckStarted = true;
    await downloadedCheck;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        episode: { ...episode, downloaded: true },
      }),
    });
  });
  await page.route("**/api/playback/active", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        activePlayback: {
          episodeId: 1,
          lastUpdated: "2026-08-12T08:01:00Z",
        },
      }),
    });
  });
  await page.route("**/api/playback", async (route) => {
    const payload = route.request().postDataJSON() as {
      episodeId: number;
      positionSeconds: number;
      completed: boolean;
    };
    savedProgress = payload;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        playback: {
          episodeId: payload.episodeId,
          positionSeconds: payload.positionSeconds,
          lastUpdated: "2026-08-12T08:01:00Z",
        },
        nextEpisodeId: null,
      }),
    });
  });

  await page.goto("/home");
  await expect(
    page.getByText("Downloading episode", { exact: true }).first()
  ).toBeVisible();
  await page.getByRole("button", { name: "Play" }).first().click();

  await expect.poll(() => downloadedCheckStarted).toBe(true);
  const originalSource = await page.evaluate(() => {
    const audio = (
      globalThis as typeof globalThis & {
        __mpodTestAudio?: { currentTime: number; src: string };
      }
    ).__mpodTestAudio;
    if (!audio) {
      throw new Error("Expected test audio instance");
    }
    audio.currentTime = 237;
    return audio.src;
  });
  releaseDownloadedCheck();

  await expect
    .poll(() =>
      page.evaluate(() => {
        const audio = (
          globalThis as typeof globalThis & {
            __mpodTestAudio?: {
              currentTime: number;
              loadCalls: number;
              pauseCalls: number;
              playPositions: number[];
              src: string;
            };
          }
        ).__mpodTestAudio;
        return audio
          ? {
              currentTime: audio.currentTime,
              loadCalls: audio.loadCalls,
              pauseCalls: audio.pauseCalls,
              playPositions: audio.playPositions,
              src: audio.src,
            }
          : null;
      })
    )
    .toEqual({
      currentTime: 237,
      loadCalls: 1,
      pauseCalls: 1,
      playPositions: [15, 237],
      src: originalSource,
    });
  await expect.poll(() => savedProgress).toMatchObject({
    positionSeconds: 237,
    completed: false,
  });
  await expect(page.getByRole("button", { name: "Pause" }).first()).toBeVisible();
});
