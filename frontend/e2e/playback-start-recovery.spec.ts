import { expect, test } from "@playwright/test";
import { installAppShellApiMocks } from "./api-mocks";

function silentWav(seconds: number) {
  const sampleRate = 8000;
  const dataSize = sampleRate * seconds * 2;
  const wav = Buffer.alloc(44 + dataSize);
  wav.write("RIFF", 0); wav.writeUInt32LE(36 + dataSize, 4);
  wav.write("WAVEfmt ", 8); wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24); wav.writeUInt32LE(sampleRate * 2, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write("data", 36); wav.writeUInt32LE(dataSize, 40);
  return wav;
}

for (const width of [1280, 390]) {
  test(`recovers delayed native audio at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.clock.install();
    await installAppShellApiMocks(page);
    await page.addInitScript(() => {
      const NativeAudio = window.Audio;
      window.Audio = class extends NativeAudio {
        constructor() {
          super();
          (window as unknown as { testAudio: HTMLAudioElement }).testAudio = this;
        }
      };
    });
    const episodes = [1, 2].map((id) => ({
      id, podcastId: 1, podcastTitle: "Test Podcast", title: `Chapter ${id}`,
      audioUrl: `/api/episodes/${id}/audio`, duration: id === 1 ? 1 : 20,
      downloaded: true, isListened: false, publishedAt: null, playback: null,
    }));
    let completed = false;
    let nextAudioRequests = 0;
    await page.route("**/api/playback/diagnostics", (route) => route.fulfill({ json: { success: true } }));
    await page.route("**/api/auth/session", (route) => route.fulfill({ json: {
      authenticated: true, user: { id: 1, username: "qa" }, setupRequired: false,
    } }));
    await page.route("**/api/playback/queue", (route) => route.fulfill({ json: {
      queue: completed ? [episodes[1]] : episodes,
      activePlayback: { episodeId: completed ? 2 : 1, lastUpdated: "2026-10-01T10:00:00Z" },
    } }));
    await page.route("**/api/playback?*", (route) => route.fulfill({ json: { playback: null } }));
    await page.route("**/api/playback/active", (route) => route.fulfill({ json: {
      activePlayback: { episodeId: route.request().postDataJSON().episodeId, lastUpdated: "2026-10-01T10:00:00Z" },
    } }));
    await page.route("**/api/playback", (route) => {
      const payload = route.request().postDataJSON();
      if (payload.completed) completed = true;
      return route.fulfill({ json: {
        playback: { episodeId: payload.episodeId, positionSeconds: payload.positionSeconds, lastUpdated: "2026-10-01T10:00:00Z" },
        nextTarget: payload.completed && payload.episodeId === 1 ? { type: "episode", episodeId: 2 } : null,
        nextEpisodeId: null,
      } });
    });
    await page.route("**/api/episodes/*/audio", async (route) => {
      const id = Number(new URL(route.request().url()).pathname.split("/").at(-2));
      if (id === 2 && ++nextAudioRequests === 1) {
        // Leave the initial load pending; the watchdog must replace it.
        return;
      }
      const wav = silentWav(id === 1 ? 1 : 20);
      const range = route.request().headers().range;
      const start = Number(range?.match(/bytes=(\d+)-/)?.[1] ?? 0);
      await route.fulfill({
        status: range ? 206 : 200,
        contentType: "audio/wav",
        headers: { "Accept-Ranges": "bytes", ...(range ? { "Content-Range": `bytes ${start}-${wav.length - 1}/${wav.length}` } : {}) },
        body: wav.subarray(start),
      });
    });
    await page.goto("/home");
    await page.getByRole("button", { name: "Play", exact: true }).first().click();
    await expect.poll(() => completed).toBe(true);
    await expect.poll(() => nextAudioRequests).toBe(1);
    await page.clock.runFor(30_000);
    await expect.poll(() => nextAudioRequests).toBeGreaterThanOrEqual(2);
    await expect.poll(() => page.evaluate(() => {
      const audio = (window as unknown as { testAudio: HTMLAudioElement }).testAudio;
      return { paused: audio.paused, progressing: audio.currentTime > 0, source: audio.currentSrc };
    })).toMatchObject({ paused: false, progressing: true, source: expect.stringContaining("/api/episodes/2/audio") });
    await page.screenshot({ path: test.info().outputPath(`playback-recovery-${width}.png`) });
  });
}
