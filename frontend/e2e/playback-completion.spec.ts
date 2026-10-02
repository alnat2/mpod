import { expect, test } from "@playwright/test";

import { installAppShellApiMocks } from "./api-mocks";

test("starts the topmost fallback after the last episode really ends", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await installAppShellApiMocks(page);
  await page.route("**/api/playback/diagnostics", (route) => route.fulfill({ status: 204 }));

  await page.addInitScript(() => {
    class FakeAudio extends EventTarget {
      src = "";
      currentTime = 0;
      duration = 600;
      readyState = HTMLMediaElement.HAVE_NOTHING;
      ended = false;
      playbackRate = 1;
      defaultPlaybackRate = 1;
      paused = true;
      error: MediaError | null = null;
      playCalls = 0;

      constructor() {
        super();
        (
          globalThis as typeof globalThis & { __mpodTestAudio?: FakeAudio }
        ).__mpodTestAudio ??= this;
      }

      load() {
        this.currentTime = 0;
        this.readyState = HTMLMediaElement.HAVE_NOTHING;
        this.paused = true;
        this.ended = false;
      }

      async play() {
        this.playCalls += 1;
        this.paused = false;
      }

      pause() {
        if (this.paused) {
          return;
        }
        this.paused = true;
        this.dispatchEvent(new Event("pause"));
      }
    }

    Object.defineProperty(globalThis, "Audio", {
      configurable: true,
      value: FakeAudio,
    });
  });

  const firstEpisode = {
    id: 1,
    podcastId: 1,
    podcastTitle: "Test Podcast",
    podcastImageUrl: null,
    title: "First fallback episode",
    description: "First notes",
    audioUrl: "https://example.com/1.mp3",
    duration: 600,
    downloaded: false,
    isListened: false,
    publishedAt: "2026-08-10T08:00:00Z",
    playback: null,
  };
  const lastEpisode = {
    id: 2,
    podcastId: 1,
    podcastTitle: "Test Podcast",
    podcastImageUrl: null,
    title: "Last playing episode",
    description: "Last notes",
    audioUrl: "https://example.com/2.mp3",
    duration: 600,
    downloaded: false,
    isListened: false,
    publishedAt: "2026-08-10T09:00:00Z",
    playback: {
      episodeId: 2,
      positionSeconds: 590,
      lastUpdated: "2026-08-10T09:59:59Z",
    },
  };
  let completionPayload: { completed?: boolean; episodeId?: number } | null =
    null;
  let completed = false;

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
        queue: completed ? [firstEpisode] : [firstEpisode, lastEpisode],
        activePlayback: completed
          ? null
          : { episodeId: 2, lastUpdated: "2026-08-10T09:59:59Z" },
      }),
    });
  });
  await page.route("**/api/playback?*", async (route) => {
    const id = Number(new URL(route.request().url()).searchParams.get("episodeId"));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ playback: id === 2 ? lastEpisode.playback : null }),
    });
  });
  await page.route("**/api/episodes/*", async (route) => {
    const episodeId = Number(new URL(route.request().url()).pathname.split("/").at(-1));
    const episode = episodeId === 1 ? firstEpisode : lastEpisode;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ episode }),
    });
  });
  await page.route("**/api/playback/active", async (route) => {
    const payload = route.request().postDataJSON() as { episodeId: number };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        activePlayback: {
          episodeId: payload.episodeId,
          lastUpdated: "2026-08-10T10:00:00Z",
        },
      }),
    });
  });
  await page.route("**/api/playback", async (route) => {
    const payload = route.request().postDataJSON() as {
      completed: boolean;
      episodeId: number;
      positionSeconds: number;
    };
    if (payload.completed) {
      completionPayload = payload;
      completed = true;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        playback: {
          episodeId: payload.episodeId,
          positionSeconds: payload.positionSeconds,
          lastUpdated: "2026-08-10T10:00:00Z",
        },
        nextTarget: payload.completed
          ? { type: "episode", episodeId: 1 }
          : null,
        nextEpisodeId: payload.completed ? 1 : null,
      }),
    });
  });

  await page.goto("/home");
  await expect(
    page.getByRole("heading", { name: "Now playing", exact: true })
  ).toBeVisible();
  await expect(
    page.getByText("Last playing episode", { exact: true }).first()
  ).toBeVisible();

  await page.getByRole("button", { name: "Play" }).first().click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            globalThis as typeof globalThis & {
              __mpodTestAudio?: { src: string };
            }
          ).__mpodTestAudio?.src ?? ""
      )
    )
    .toContain("/api/episodes/2/audio");

  await page.evaluate(() => {
    const audio = (globalThis as typeof globalThis & {
      __mpodTestAudio?: { readyState: number; dispatchEvent: (event: Event) => boolean };
    }).__mpodTestAudio;
    if (!audio) throw new Error("Expected test audio instance");
    audio.readyState = HTMLMediaElement.HAVE_METADATA;
    audio.dispatchEvent(new Event("loadedmetadata"));
    audio.readyState = HTMLMediaElement.HAVE_FUTURE_DATA;
    audio.dispatchEvent(new Event("canplay"));
    audio.dispatchEvent(new Event("playing"));
  });

  await page.evaluate(() => {
    const audio = (
      globalThis as typeof globalThis & {
        __mpodTestAudio?: {
          currentTime: number;
          paused: boolean;
          ended: boolean;
          dispatchEvent: (event: Event) => boolean;
        };
      }
    ).__mpodTestAudio;
    if (!audio) {
      throw new Error("Expected test audio instance");
    }
    audio.currentTime = 600;
    audio.ended = true;
    audio.paused = true;
    audio.dispatchEvent(new Event("ended"));
  });

  await expect.poll(() => completionPayload).toMatchObject({
    completed: true,
    episodeId: 2,
  });
  await expect.poll(() => page.evaluate(() =>
    (globalThis as typeof globalThis & { __mpodTestAudio?: { src: string } }).__mpodTestAudio?.src
  )).toContain("/api/episodes/1/audio");
  await page.evaluate(() => {
    const audio = (globalThis as typeof globalThis & {
      __mpodTestAudio?: { readyState: number; dispatchEvent: (event: Event) => boolean };
    }).__mpodTestAudio;
    if (!audio) throw new Error("Expected test audio instance");
    audio.readyState = HTMLMediaElement.HAVE_METADATA;
    audio.dispatchEvent(new Event("loadedmetadata"));
    audio.readyState = HTMLMediaElement.HAVE_FUTURE_DATA;
    audio.dispatchEvent(new Event("canplay"));
    audio.dispatchEvent(new Event("playing"));
  });

  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            globalThis as typeof globalThis & {
              __mpodTestAudio?: { playCalls: number; src: string };
            }
          ).__mpodTestAudio ?? { playCalls: 0, src: "" }
      )
    )
    .toMatchObject({
      playCalls: 2,
      src: expect.stringContaining("/api/episodes/1/audio"),
    });
  await expect(
    page.getByText("First fallback episode", { exact: true }).first()
  ).toBeVisible();
});
