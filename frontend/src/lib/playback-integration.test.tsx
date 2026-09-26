import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { api, type AudiobookTrack, type PlaybackQueueResponse, type PlaybackUpdateResponse, type PlaybackState } from "./api";
import { PlaybackProvider, usePlayback } from "./playback-context";
import type { QueueEpisode } from "./playback-context-types";
import { FakeAudio } from "../test/fake-audio";

const stamp = "2026-09-25T10:00:00Z";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

const track = (id: number, options: Partial<AudiobookTrack> = {}): AudiobookTrack => ({
  id,
  audiobookId: 10,
  trackNumber: id,
  title: `Chapter ${id}`,
  relPath: `${id}.mp3`,
  filePath: `/books/${id}.mp3`,
  duration: 100,
  isListened: false,
  inPlaylist: true,
  positionSeconds: 0,
  ...options,
});

const book: QueueEpisode = {
  type: "audiobook", id: 10, audiobookId: 10, trackId: 1, trackNumber: 1,
  title: "Book", podcastId: 0, podcastTitle: "Book", podcastImageUrl: null,
  description: null, audioUrl: "/api/audiobooks/10/tracks/1/audio", duration: 100,
  downloaded: false, isListened: false, publishedAt: null, playback: null,
};
function Harness() {
  const { currentEpisode, queue, playing, playbackError, positionSeconds,
    playQueueItem, playToggle, playAudiobookTrack } = usePlayback();
  return <>
    <div data-testid="source">{currentEpisode?.trackId ?? "none"}</div>
    <div data-testid="queue-track">{queue[0]?.trackId}</div>
    <div data-testid="playing">{String(playing)}</div>
    <div data-testid="error">{playbackError ?? "none"}</div>
    <div data-testid="position">{positionSeconds}</div>
    <button onClick={() => playQueueItem(queue[0]!)}>Book</button>
    <button onClick={playToggle}>Toggle</button>
    <button onClick={() => void playAudiobookTrack(10, track(3, { positionSeconds: 31 }))}>Choose C</button>
  </>;
}

describe("combined playback integration", () => {
  let tracks: AudiobookTrack[];
  let queue: QueueEpisode[];

  beforeEach(() => {
    vi.restoreAllMocks();
    FakeAudio.instances = [];
    vi.stubGlobal("Audio", FakeAudio);
    vi.stubGlobal("MediaError", { MEDIA_ERR_ABORTED: 1, MEDIA_ERR_NETWORK: 2, MEDIA_ERR_DECODE: 3, MEDIA_ERR_SRC_NOT_SUPPORTED: 4 });
    Object.defineProperty(navigator, "mediaSession", {
      configurable: true,
      value: { setActionHandler: vi.fn(), playbackState: "none" },
    });
    tracks = [track(1), track(2), track(3, { positionSeconds: 31 })];
    queue = [book];
    vi.spyOn(api.settings, "get").mockResolvedValue({ settings: {
      dailyRefreshTime: "03:00", playbackSpeed: "Speed 1.3x",
      audiobookPlaybackSpeed: "Speed 1x", proxyEnabled: false,
      proxyConfigured: false, appBuild: "test",
    } });
    vi.spyOn(api.playback, "queue").mockImplementation(async () => ({
      queue: queue.map((item) => ({ ...item })),
      activePlayback: { audiobookId: 10, trackId: 1, lastUpdated: stamp },
    }));
    vi.spyOn(api.audiobooks, "get").mockImplementation(async () => ({ audiobook: {
      id: 10, title: "Book", author: "Author", relPath: "book", hasCover: false,
      totalDuration: 300, trackCount: 3, listenedCount: 0, isListened: false,
      positionSeconds: 0, createdAt: stamp, updatedAt: stamp,
      tracks: tracks.map((item) => ({ ...item })),
    } }));
    vi.spyOn(api.playback, "get").mockImplementation(async (target) => ({
      playback: typeof target === "number" || "episodeId" in target
        ? { episodeId: typeof target === "number" ? target : target.episodeId, positionSeconds: 0, lastUpdated: stamp }
        : { audiobookId: target.audiobookId, trackId: target.trackId, positionSeconds: tracks.find((item) => item.id === target.trackId)?.positionSeconds ?? 0, lastUpdated: stamp },
    }));
    vi.spyOn(api.playback, "setActive").mockImplementation(async (target) => ({
      activePlayback: typeof target === "number"
        ? { episodeId: target, lastUpdated: stamp }
        : { ...target, lastUpdated: stamp },
    }));
    vi.spyOn(api.playback, "update").mockImplementation(async (payload) => ({
      playback: { audiobookId: 10, trackId: payload.trackId, positionSeconds: payload.positionSeconds, lastUpdated: stamp },
      nextTarget: payload.completed ? { type: "audiobook", audiobookId: 10, trackId: 2 } : undefined,
      nextTrackId: payload.completed ? 2 : null,
      nextEpisodeId: null,
    }));
  });

  async function startBook() {
    const user = userEvent.setup();
    render(<PlaybackProvider><Harness /></PlaybackProvider>);
    await waitFor(() => expect(screen.getByTestId("source")).toHaveTextContent("1"));
    await waitFor(() => expect(api.audiobooks.get).toHaveBeenCalled());
    await user.click(screen.getByRole("button", { name: "Book" }));
    const audio = FakeAudio.first;
    await waitFor(() => expect(audio.src).toContain("/tracks/1/audio"));
    await act(async () => { audio.readyState = 4; audio.emit("loadedmetadata"); audio.emit("canplay"); });
    await waitFor(() => expect(audio.playImpl).toHaveBeenCalled());
    return { user, audio };
  }

  it("stops after three rejected auto plays and ignores further readiness", async () => {
    const { audio } = await startBook();
    const completion = deferred<PlaybackUpdateResponse>();
    vi.mocked(api.playback.update).mockImplementation(async (payload) =>
      payload.completed ? completion.promise : {
        playback: { audiobookId: 10, trackId: payload.trackId, positionSeconds: payload.positionSeconds, lastUpdated: stamp },
        nextEpisodeId: null,
      }
    );
    audio.playImpl.mockClear();
    audio.playImpl.mockRejectedValue(new DOMException("Unsupported", "NotSupportedError"));
    await act(async () => { audio.ended = true; audio.paused = true; audio.currentTime = 100; audio.emit("ended"); });
    await waitFor(() => expect(audio.playImpl).toHaveBeenCalledTimes(1));
    await ready(audio);
    await waitFor(() => {
      expect(audio.playImpl).toHaveBeenCalledTimes(3);
      expect(screen.getByTestId("playing")).toHaveTextContent("false");
      expect(screen.getByTestId("error")).toHaveTextContent("NotSupportedError");
    });
    await ready(audio);
    expect(audio.playImpl).toHaveBeenCalledTimes(3);
    expect(audio.paused).toBe(true);
  });

  it("clears the pending retry timeout when the user chooses C", async () => {
    const { user, audio } = await startBook();
    const completion = deferred<PlaybackUpdateResponse>();
    vi.mocked(api.playback.update).mockReturnValue(completion.promise);
    const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout");
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    audio.playImpl.mockRejectedValueOnce(new DOMException("Unsupported", "NotSupportedError"));
    await act(async () => { audio.ended = true; audio.paused = true; audio.currentTime = 100; audio.emit("ended"); });
    await waitFor(() => expect(setTimeoutSpy.mock.calls.some(([, delay]) => delay === 5000)).toBe(true));
    const timeoutIndex = setTimeoutSpy.mock.calls.findIndex(([, delay]) => delay === 5000);
    const timeout = setTimeoutSpy.mock.results[timeoutIndex]!.value;
    const callback = setTimeoutSpy.mock.calls[timeoutIndex]![0];
    const lateRetry = audio.captureEvent("canplay");
    await user.click(screen.getByRole("button", { name: "Choose C" }));
    expect(clearTimeoutSpy).toHaveBeenCalledWith(timeout);
    await waitFor(() => expect(audio.src).toContain("/tracks/3/audio"));
    await ready(audio);
    const playsAtC = audio.playImpl.mock.calls.length;
    await act(async () => {
      lateRetry();
      if (typeof callback === "function") callback();
    });
    expect(audio.playImpl).toHaveBeenCalledTimes(playsAtC);
    expect(audio.paused).toBe(false);
    expect(screen.getByTestId("error")).toHaveTextContent("none");
    expect(audio.currentTime).toBe(31);
  });

  it.each(["resolve", "reject"] as const)("ignores a stale completion playback.get that later %ss", async (result) => {
    const { user, audio } = await startBook();
    const pendingGet = deferred<{ playback: PlaybackState | null }>();
    let rejectGet!: (error: Error) => void;
    const failedGet = new Promise<{ playback: PlaybackState | null }>((_, reject) => { rejectGet = reject; });
    const get = vi.mocked(api.playback.get);
    const defaultGet = get.getMockImplementation()!;
    get.mockImplementation((target) =>
      typeof target !== "number" && "audiobookId" in target && target.trackId === 2
        ? result === "resolve" ? pendingGet.promise : failedGet
        : defaultGet(target)
    );
    await act(async () => { audio.ended = true; audio.paused = true; audio.currentTime = 100; audio.emit("ended"); });
    await waitFor(() => expect(get).toHaveBeenCalledWith({ audiobookId: 10, trackId: 2 }));
    await user.click(screen.getByRole("button", { name: "Choose C" }));
    await waitFor(() => expect(audio.src).toContain("/tracks/3/audio"));
    await ready(audio);
    const loadsAtC = audio.loadImpl.mock.calls.length;
    const playsAtC = audio.playImpl.mock.calls.length;
    const activeAtC = vi.mocked(api.playback.setActive).mock.calls.length;
    await act(async () => {
      if (result === "resolve") pendingGet.resolve({ playback: { audiobookId: 10, trackId: 2, positionSeconds: 47, lastUpdated: stamp } });
      else rejectGet(new Error("Network unavailable"));
    });
    expect(screen.getByTestId("source")).toHaveTextContent("3");
    expect(screen.getByTestId("queue-track")).toHaveTextContent("3");
    expect(audio.src).toContain("/tracks/3/audio");
    expect(audio.currentTime).toBe(31);
    expect(audio.paused).toBe(false);
    expect(audio.loadImpl).toHaveBeenCalledTimes(loadsAtC);
    expect(audio.playImpl).toHaveBeenCalledTimes(playsAtC);
    expect(api.playback.setActive).toHaveBeenCalledTimes(activeAtC);
  });

  it("reports rejected completion, releases its lock and allows manual Play", async () => {
    tracks = [track(1)];
    const { user, audio } = await startBook();
    const update = vi.mocked(api.playback.update).mockRejectedValue(new Error("Network unavailable"));
    await act(async () => { audio.currentTime = 100; audio.ended = true; audio.paused = true; audio.emit("ended"); });
    await waitFor(() => expect(screen.getByTestId("error")).toHaveTextContent("Could not confirm playback completion."));
    expect(screen.getByTestId("playing")).toHaveTextContent("false");
    expect(update.mock.calls.filter(([payload]) => payload.completed)).toHaveLength(1);
    const playsBeforeRecovery = audio.playImpl.mock.calls.length;
    await user.click(screen.getByRole("button", { name: "Toggle" }));
    await ready(audio);
    await waitFor(() => {
      expect(audio.playImpl).toHaveBeenCalledTimes(playsBeforeRecovery + 1);
      expect(audio.paused).toBe(false);
    });
    expect(screen.getByTestId("error")).toHaveTextContent("none");
  });

  it.each(["completion", "queue"] as const)(
    "keeps C after B recovery and late A %s / B play responses", async (delayStage) => {
      const completionA = deferred<PlaybackUpdateResponse>();
      const queueA = deferred<PlaybackQueueResponse>();
      const progressB = deferred<PlaybackUpdateResponse>();
      let rejectOldBPlay!: (error: Error) => void;
      const oldBPlay = new Promise<void>((_, reject) => { rejectOldBPlay = reject; });
      const update = vi.mocked(api.playback.update).mockImplementation(async (payload) => {
        if (payload.completed && payload.trackId === 1) return completionA.promise;
        if (!payload.completed && payload.trackId === 2) return progressB.promise;
        return {
          playback: { audiobookId: 10, trackId: payload.trackId,
            positionSeconds: payload.positionSeconds, lastUpdated: stamp },
          nextEpisodeId: null,
        };
      });
      const { user, audio } = await startBook();
      await waitFor(() => expect(audio.paused).toBe(false));
      await act(async () => {
        audio.duration = 100; audio.currentTime = 100;
        audio.ended = true; audio.paused = true; audio.emit("ended");
      });
      await waitFor(() => expect(audio.src).toContain("/tracks/2/audio"));
      await ready(audio);
      await waitFor(() => expect(audio.paused).toBe(false));
      expect(update.mock.calls.filter(([p]) => p.completed && p.trackId === 1)).toHaveLength(1);
      const completionResult: PlaybackUpdateResponse = {
        playback: { audiobookId: 10, trackId: 1, positionSeconds: 100, lastUpdated: stamp },
        nextTarget: { type: "audiobook", audiobookId: 10, trackId: 2 },
        nextTrackId: 2, nextEpisodeId: null,
      };
      const queueCallsBefore = vi.mocked(api.playback.queue).mock.calls.length;
      vi.mocked(api.playback.queue).mockReturnValueOnce(queueA.promise);
      if (delayStage === "queue") {
        await act(async () => { completionA.resolve(completionResult); });
        await waitFor(() => expect(api.playback.queue).toHaveBeenCalledTimes(queueCallsBefore + 1));
      }
      await act(async () => {
        audio.currentTime = 23; audio.emit("timeupdate");
        audio.error = { code: 4 }; audio.paused = true; audio.emit("error");
      });
      expect(screen.getByTestId("error")).not.toHaveTextContent("none");
      expect(screen.getByTestId("playing")).toHaveTextContent("false");
      const loadsBeforeRecovery = audio.loadImpl.mock.calls.length;
      const playsBeforeRecovery = audio.playImpl.mock.calls.length;
      await user.click(screen.getByRole("button", { name: "Toggle" }));
      await waitFor(() => expect(audio.loadImpl).toHaveBeenCalledTimes(loadsBeforeRecovery + 1));
      const lateBReady = audio.captureEvent("canplay");
      audio.error = null;
      await ready(audio);
      await waitFor(() => {
        expect(audio.playImpl).toHaveBeenCalledTimes(playsBeforeRecovery + 1);
        expect(audio.paused).toBe(false);
      });
      expect(audio.src).toContain("/tracks/2/audio");

      // B is running again, then an independent Play Promise remains pending.
      await user.click(screen.getByRole("button", { name: "Toggle" }));
      await waitFor(() => expect(audio.paused).toBe(true));
      audio.playImpl.mockReturnValueOnce(oldBPlay);
      await user.click(screen.getByRole("button", { name: "Toggle" }));
      await waitFor(() => expect(audio.playImpl).toHaveBeenCalledTimes(playsBeforeRecovery + 2));
      expect(update).toHaveBeenCalledWith(expect.objectContaining({
        audiobookId: 10, trackId: 2, completed: false,
      }));
      await user.click(screen.getByRole("button", { name: "Choose C" }));
      await waitFor(() => expect(audio.src).toContain("/tracks/3/audio"));
      await ready(audio);
      await waitFor(() => expect(audio.paused).toBe(false));
      expect(screen.getByTestId("source")).toHaveTextContent("3");
      expect(screen.getByTestId("queue-track")).toHaveTextContent("3");
      expect(audio.currentTime).toBe(31);
      const loadsAtC = audio.loadImpl.mock.calls.length;
      const playsAtC = audio.playImpl.mock.calls.length;
      const activeCallsAtC = vi.mocked(api.playback.setActive).mock.calls.length;
      await act(async () => {
        if (delayStage === "completion") completionA.resolve(completionResult);
        queueA.resolve({ queue: [book], activePlayback: { audiobookId: 10, trackId: 1, lastUpdated: stamp } });
        progressB.resolve({ playback: { audiobookId: 10, trackId: 2, positionSeconds: 23, lastUpdated: stamp }, nextEpisodeId: null });
        lateBReady();
        rejectOldBPlay(new DOMException("Old B failed", "NotSupportedError"));
      });
      expect(audio.src).toContain("/tracks/3/audio");
      expect(audio.currentTime).toBe(31);
      expect(audio.paused).toBe(false);
      expect(screen.getByTestId("playing")).toHaveTextContent("true");
      expect(screen.getByTestId("error")).toHaveTextContent("none");
      expect(screen.getByTestId("queue-track")).toHaveTextContent("3");
      expect(audio.loadImpl).toHaveBeenCalledTimes(loadsAtC);
      expect(audio.playImpl).toHaveBeenCalledTimes(playsAtC);
      expect(api.playback.setActive).toHaveBeenCalledTimes(activeCallsAtC);
    }
  );
});

async function ready(audio: FakeAudio) {
  await act(async () => {
    audio.readyState = 1; audio.emit("loadedmetadata");
    audio.readyState = 4; audio.emit("canplay");
  });
}
