import { expect, test } from "@playwright/test";
import { installAppShellApiMocks } from "./api-mocks";

function wav(seconds: number) {
  const size = 8000 * seconds * 2;
  const body = Buffer.alloc(44 + size);
  body.write("RIFF"); body.writeUInt32LE(36 + size, 4);
  body.write("WAVEfmt ", 8); body.writeUInt32LE(16, 16);
  body.writeUInt16LE(1, 20); body.writeUInt16LE(1, 22);
  body.writeUInt32LE(8000, 24); body.writeUInt32LE(16000, 28);
  body.writeUInt16LE(2, 32); body.writeUInt16LE(16, 34);
  body.write("data", 36); body.writeUInt32LE(size, 40);
  return body;
}

for (const width of [1280, 390]) {
  test(`uses a native buffered source at ${width}px even when subsequent audio requests are blocked`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await installAppShellApiMocks(page);
    await page.addInitScript(() => {
      const NativeAudio = window.Audio;
      const state = window as unknown as {
        observedAudios: Array<{ audio: HTMLAudioElement; loads: number }>;
        mediaHandlers: Partial<Record<MediaSessionAction, MediaSessionActionHandler | null>>;
      };
      state.observedAudios = [];
      state.mediaHandlers = {};
      const nativeSetHandler = navigator.mediaSession.setActionHandler.bind(navigator.mediaSession);
      navigator.mediaSession.setActionHandler = (action, handler) => {
        state.mediaHandlers[action] = handler;
        nativeSetHandler(action, handler);
      };
      window.Audio = class extends NativeAudio {
        constructor() {
          super();
          const observed = { audio: this as HTMLAudioElement, loads: 0 };
          state.observedAudios.push(observed);
          const nativeLoad = this.load.bind(this);
          this.load = () => { observed.loads += 1; nativeLoad(); };
        }
      };
    });
    const episodes = [1, 2].map((id) => ({
      id, podcastId: 1, podcastTitle: "Playback QA", title: `Episode ${id}`,
      audioUrl: `/api/episodes/${id}/audio`, duration: id === 1 ? 8 : 20,
      downloaded: true, isListened: false, publishedAt: null,
      playback: id === 2 ? { episodeId: 2, positionSeconds: 3, lastUpdated: "2026-10-02T09:00:00Z" } : null,
    }));
    let completed = false;
    let requestsAfterCompletion = 0;
    const events: Array<{ event: string; code?: string; episodeId?: number }> = [];
    await page.route("**/api/playback/diagnostics", async (route) => {
      events.push(...route.request().postDataJSON().events);
      await route.fulfill({ status: 204 });
    });
    await page.route("**/api/auth/session", (route) => route.fulfill({ json: {
      authenticated: true, user: { id: 1, username: "qa" }, setupRequired: false,
    } }));
    await page.route("**/api/playback/queue", (route) => route.fulfill({ json: {
      queue: completed ? [episodes[1]] : episodes,
      activePlayback: { episodeId: completed ? 2 : 1, lastUpdated: "2026-10-02T09:00:00Z" },
    } }));
    await page.route("**/api/playback?*", (route) => route.fulfill({ json: { playback: null } }));
    await page.route("**/api/playback/active", (route) => route.fulfill({ json: {
      activePlayback: { episodeId: route.request().postDataJSON().episodeId, lastUpdated: "2026-10-02T09:00:00Z" },
    } }));
    await page.route("**/api/playback", (route) => {
      const payload = route.request().postDataJSON();
      if (payload.completed) completed = true;
      return route.fulfill({ json: {
        playback: { episodeId: payload.episodeId, positionSeconds: payload.positionSeconds, lastUpdated: "2026-10-02T09:00:00Z" },
        nextTarget: payload.completed ? { type: "episode", episodeId: 2 } : null, nextEpisodeId: null,
      } });
    });
    await page.route("**/api/episodes/*/audio", async (route) => {
      const id = Number(new URL(route.request().url()).pathname.split("/").at(-2));
      if (id === 2 && completed) { requestsAfterCompletion += 1; await route.abort(); return; }
      const body = wav(id === 1 ? 8 : 20);
      const range = route.request().headers().range;
      const start = Number(range?.match(/bytes=(\d+)-/)?.[1] ?? 0);
      await route.fulfill({ status: range ? 206 : 200, contentType: "audio/wav",
        headers: { "Accept-Ranges": "bytes", ...(range ? { "Content-Range": `bytes ${start}-${body.length - 1}/${body.length}` } : {}) },
        body: body.subarray(start) });
    });
    await page.goto("/home");
    await page.getByRole("button", { name: "Play", exact: true }).first().click();
    await expect.poll(() => events.some((event) => event.code === "PRELOAD_READY")).toBe(true);
    const reserveBefore = await page.evaluate(() => {
      const state = window as unknown as { observedAudios: Array<{ audio: HTMLAudioElement; loads: number }> };
      const reserve = state.observedAudios.find(({ audio }) => audio.src.includes("/episodes/2/audio"));
      return { loads: reserve?.loads, paused: reserve?.audio.paused, position: reserve?.audio.currentTime };
    });
    expect(reserveBefore).toEqual({ loads: 1, paused: true, position: 3 });
    await expect.poll(() => completed, { timeout: 15_000 }).toBe(true);
    await expect.poll(() => page.evaluate(() => {
      const state = window as unknown as { observedAudios: Array<{ audio: HTMLAudioElement; loads: number }> };
      const reserve = state.observedAudios.find(({ audio }) => audio.src.includes("/episodes/2/audio"));
      return { loads: reserve?.loads, playing: reserve ? !reserve.audio.paused : false,
        advancing: (reserve?.audio.currentTime ?? 0) > 3, rate: reserve?.audio.playbackRate };
    })).toEqual({ loads: 1, playing: true, advancing: true, rate: 1.3 });
    expect(requestsAfterCompletion).toBe(0);
    await expect.poll(() => events.some((event) => event.code === "PREPARED_SOURCE" && event.event === "play_attempt")).toBe(true);
    await page.screenshot({ path: test.info().outputPath(`preloaded-transition-${width}.png`) });
    // Media Session Pause must target the promoted element.
    await page.evaluate(() => {
      const state = window as unknown as { mediaHandlers: Partial<Record<MediaSessionAction, MediaSessionActionHandler | null>> };
      state.mediaHandlers.pause?.({ action: "pause" });
    });
    await expect.poll(() => page.evaluate(() => {
      const state = window as unknown as { observedAudios: Array<{ audio: HTMLAudioElement; loads: number }> };
      return state.observedAudios.every(({ audio }) => audio.paused);
    })).toBe(true);
  });
}
