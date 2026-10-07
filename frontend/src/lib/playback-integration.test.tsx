import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
const podcastEpisode = (id: number, isListened = false): QueueEpisode => ({
  ...book,
  type: "episode",
  id,
  audiobookId: undefined,
  trackId: undefined,
  trackNumber: undefined,
  podcastId: 7,
  podcastTitle: "Podcast",
  audioUrl: `/api/episodes/${id}/audio`,
  isListened,
});
function Harness() {
  const { currentEpisode, queue, playing, playbackError, positionSeconds,
    playQueueItem, playToggle, playAudiobookTrack, updateQueue, reloadQueue, setSpeedLabel, speedLabel } = usePlayback();
  return <>
    <div data-testid="source">{currentEpisode?.trackId ?? "none"}</div>
    <div data-testid="queue-track">{queue[0]?.trackId}</div>
    <div data-testid="playing">{String(playing)}</div>
    <div data-testid="error">{playbackError ?? "none"}</div>
    <div data-testid="position">{positionSeconds}</div>
    <div data-testid="episode">{currentEpisode?.id}</div>
    <div data-testid="speed">{speedLabel}</div>
    <button onClick={() => playQueueItem(queue[0]!)}>Book</button>
    {queue[1] && <button onClick={() => playQueueItem(queue[1]!)}>Second</button>}
    <button onClick={playToggle}>Toggle</button>
    <button onClick={() => void playAudiobookTrack(10, track(2, { positionSeconds: 17 }))}>Choose B</button>
    <button onClick={() => void playAudiobookTrack(10, track(3, { positionSeconds: 31 }))}>Choose C</button>
    <button onClick={() => updateQueue((items) => items.slice(0, 1))}>Remove next</button>
    <button onClick={() => updateQueue((items) => items.filter((item) => item.type !== "audiobook"))}>Remove book</button>
    <button onClick={() => void reloadQueue()}>Reload</button>
    <button onClick={() => setSpeedLabel("Speed 2x")}>Speed 2x</button>
  </>;
}

describe("combined playback integration", () => {
  let tracks: AudiobookTrack[];
  let queue: QueueEpisode[];

  afterEach(() => vi.useRealTimers());

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
    const { unmount } = render(<PlaybackProvider><Harness /></PlaybackProvider>);
    await waitFor(() => expect(screen.getByTestId("source")).toHaveTextContent("1"));
    await waitFor(() => expect(api.audiobooks.get).toHaveBeenCalled());
    await user.click(screen.getByRole("button", { name: "Book" }));
    const audio = FakeAudio.first;
    await waitFor(() => expect(audio.src).toContain("/tracks/1/audio"));
    await act(async () => { audio.readyState = 4; audio.emit("loadedmetadata"); audio.emit("canplay"); });
    await waitFor(() => expect(audio.playImpl).toHaveBeenCalled());
    return { user, audio, unmount };
  }

  async function prepareReserve(audio: FakeAudio, position = 0) {
    await act(async () => { audio.emit("playing"); });
    await waitFor(() => expect(FakeAudio.instances.length).toBeGreaterThan(1));
    const reserve = FakeAudio.instances[1]!;
    await act(async () => {
      reserve.duration = 100;
      reserve.readyState = 1;
      reserve.emit("loadedmetadata");
      reserve.buffered = { length: 1, start: () => position, end: () => position + 5 };
      reserve.readyState = 4;
      reserve.emit("canplay");
    });
    return reserve;
  }

  it.each(["book", "podcast"])("starts the buffered %s source without another load and ignores old element events", async (kind) => {
    if (kind === "podcast") {
      queue = [podcastEpisode(1), podcastEpisode(2)];
      vi.mocked(api.playback.update).mockImplementation(async (payload) => ({
        playback: { episodeId: payload.episodeId, positionSeconds: payload.positionSeconds, lastUpdated: stamp },
        nextTarget: payload.completed ? { type: "episode", episodeId: 2 } : undefined,
        nextEpisodeId: null,
      }));
    }
    const user = userEvent.setup();
    render(<PlaybackProvider><Harness /></PlaybackProvider>);
    await waitFor(() => expect(screen.getByRole("button", { name: "Book" })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: "Book" }));
    const audio = FakeAudio.first;
    await ready(audio);
    await waitFor(() => expect(audio.paused).toBe(false));
    const activeCalls = vi.mocked(api.playback.setActive).mock.calls.length;
    const reserve = await prepareReserve(audio);
    expect(api.playback.setActive).toHaveBeenCalledTimes(activeCalls);
    expect(reserve.playImpl).not.toHaveBeenCalled();
    const loads = reserve.loadImpl.mock.calls.length;
    const oldPause = audio.captureEvent("pause");
    const oldPlaying = audio.captureEvent("playing");
    const oldEnded = audio.captureEvent("ended");
    const oldError = audio.captureEvent("error");
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    try {
      await act(async () => { audio.currentTime = 100; audio.ended = true; audio.paused = true; audio.emit("ended"); });
      await waitFor(() => expect(reserve.paused).toBe(false));
      expect(reserve.loadImpl).toHaveBeenCalledTimes(loads);
      expect(audio.src).toBe("");
      expect(screen.getByTestId("playing")).toHaveTextContent("true");
      await act(async () => {
        reserve.currentTime = 8; reserve.emit("timeupdate");
        audio.error = { code: 4 }; oldPause(); oldPlaying(); oldEnded(); oldError();
      });
      expect(reserve.paused).toBe(false);
      expect(screen.getByTestId("position")).toHaveTextContent("8");
      expect(screen.getByTestId("error")).toHaveTextContent("none");
      expect(vi.mocked(api.playback.update).mock.calls.filter(([payload]) => payload.completed)).toHaveLength(1);
    } finally {
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    }
  });

  it("resumes a prepared chapter at its buffered saved position and keeps controls on the new element", async () => {
    tracks[1] = track(2, { positionSeconds: 23 });
    vi.spyOn(api.settings, "update").mockResolvedValue({ settings: {
      dailyRefreshTime: "03:00", playbackSpeed: "Speed 1.3x", audiobookPlaybackSpeed: "Speed 2x",
      proxyEnabled: false, proxyConfigured: false, appBuild: "test",
    } });
    const { user, audio } = await startBook();
    const reserve = await prepareReserve(audio, 23);
    await act(async () => { audio.currentTime = 100; audio.ended = true; audio.paused = true; audio.emit("ended"); });
    await waitFor(() => expect(reserve.paused).toBe(false));
    expect(reserve.currentTime).toBe(23);
    await user.click(screen.getByRole("button", { name: "Speed 2x" }));
    expect(reserve.playbackRate).toBe(2);
    await user.click(screen.getByRole("button", { name: "Toggle" }));
    expect(reserve.paused).toBe(true);
    expect(screen.getByTestId("playing")).toHaveTextContent("false");
    expect(reserve.loadImpl).toHaveBeenCalledTimes(1);
  });

  it.each(["metadata", "error", "lost buffer"])("falls back without disturbing current playback when reserve has %s", async (state) => {
    const { audio } = await startBook();
    await act(async () => { audio.emit("playing"); });
    const reserve = FakeAudio.instances[1]!;
    await act(async () => {
      reserve.readyState = state === "metadata" ? 1 : 4;
      reserve.duration = 100;
      reserve.emit("loadedmetadata");
      if (state === "error") { reserve.error = { code: 4 }; reserve.emit("error"); }
      if (state === "lost buffer") {
        reserve.buffered = { length: 1, start: () => 0, end: () => 5 }; reserve.emit("canplay");
        reserve.buffered = { length: 0, start: () => 0, end: () => 0 };
      }
    });
    expect(audio.paused).toBe(false);
    expect(screen.getByTestId("error")).toHaveTextContent("none");
    await act(async () => { audio.currentTime = 100; audio.ended = true; audio.paused = true; audio.emit("ended"); });
    expect(audio.src).toContain("/tracks/2/audio");
    expect(reserve.playImpl).not.toHaveBeenCalled();
    expect(reserve.src).toBe("");
    await ready(audio);
    expect(audio.paused).toBe(false);
  });

  it.each(["Pause", "selection", "unmount"])("disposes the reserve on %s and ignores late readiness", async (action) => {
    const { audio, user, unmount } = await startBook();
    const reserve = await prepareReserve(audio);
    const lateReady = reserve.captureEvent("canplay");
    if (action === "Pause") await user.click(screen.getByRole("button", { name: "Toggle" }));
    else if (action === "selection") await user.click(screen.getByRole("button", { name: "Choose C" }));
    else unmount();
    expect(reserve.src).toBe("");
    await act(async () => { reserve.readyState = 4; lateReady(); });
    expect(reserve.playImpl).not.toHaveBeenCalled();
  });

  it("invalidates a prepared podcast when it leaves the queue", async () => {
    queue = [book, podcastEpisode(2)];
    tracks = [track(1)];
    const { audio, user } = await startBook();
    const reserve = await prepareReserve(audio);
    expect(reserve.src).toContain("/episodes/2/audio");
    await user.click(screen.getByRole("button", { name: "Remove next" }));
    expect(reserve.src).toBe("");
    expect(audio.paused).toBe(false);
    expect(reserve.playImpl).not.toHaveBeenCalled();
  });

  it("reconciles a different authoritative target after starting the prepared prediction", async () => {
    const { audio } = await startBook();
    const reserve = await prepareReserve(audio);
    const completion = deferred<PlaybackUpdateResponse>();
    vi.mocked(api.playback.update).mockReturnValue(completion.promise);
    await act(async () => { audio.currentTime = 100; audio.ended = true; audio.paused = true; audio.emit("ended"); });
    await waitFor(() => expect(reserve.paused).toBe(false));
    await act(async () => completion.resolve({
      playback: { audiobookId: 10, trackId: 1, positionSeconds: 100, lastUpdated: stamp },
      nextTarget: { type: "audiobook", audiobookId: 10, trackId: 3 }, nextEpisodeId: null,
    }));
    await waitFor(() => expect(reserve.src).toContain("/tracks/3/audio"));
    await ready(reserve);
    expect(reserve.currentTime).toBe(31);
    expect(screen.getByTestId("source")).toHaveTextContent("3");
    expect(reserve.paused).toBe(false);
  });

  it.each(["mixed", "wrap"])("uses the reserve after authoritative %s-queue completion", async (kind) => {
    tracks = [track(1)];
    const next = podcastEpisode(2);
    queue = kind === "wrap" ? [next, book] : [book, next];
    vi.mocked(api.playback.update).mockImplementation(async (payload) => {
      if (payload.completed) queue = [next];
      return {
        playback: { audiobookId: 10, trackId: payload.trackId, positionSeconds: payload.positionSeconds, lastUpdated: stamp },
        nextTarget: payload.completed ? { type: "episode", episodeId: 2 } : undefined, nextEpisodeId: null,
      };
    });
    const user = userEvent.setup();
    render(<PlaybackProvider><Harness /></PlaybackProvider>);
    await waitFor(() => expect(screen.getByRole("button", { name: "Second" })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: kind === "wrap" ? "Second" : "Book" }));
    const audio = FakeAudio.first;
    await ready(audio);
    const reserve = await prepareReserve(audio);
    const loads = reserve.loadImpl.mock.calls.length;
    await act(async () => { audio.currentTime = 100; audio.ended = true; audio.paused = true; audio.emit("ended"); });
    await waitFor(() => expect(screen.getByTestId("episode")).toHaveTextContent("2"));
    expect(reserve.paused).toBe(false);
    expect(reserve.loadImpl).toHaveBeenCalledTimes(loads);
    expect(reserve.playbackRate).toBe(1.3);
  });

  it("handles consecutive prepared chapters and Media Session Pause on the promoted element", async () => {
    tracks[2] = track(3);
    vi.mocked(api.playback.update).mockImplementation(async (payload) => ({
      playback: { audiobookId: 10, trackId: payload.trackId, positionSeconds: payload.positionSeconds, lastUpdated: stamp },
      nextTarget: payload.completed ? { type: "audiobook", audiobookId: 10, trackId: (payload.trackId ?? 0) + 1 } : undefined,
      nextEpisodeId: null,
    }));
    const { audio } = await startBook();
    const second = await prepareReserve(audio);
    await act(async () => { audio.currentTime = 100; audio.ended = true; audio.paused = true; audio.emit("ended"); });
    await waitFor(() => expect(second.paused).toBe(false));
    await act(async () => { second.emit("playing"); });
    await waitFor(() => expect(FakeAudio.instances.some((element) => element.src.includes("/tracks/3/audio"))).toBe(true));
    const third = FakeAudio.instances.find((element) => element.src.includes("/tracks/3/audio"))!;
    await act(async () => {
      third.duration = 100; third.readyState = 4;
      third.buffered = { length: 1, start: () => 0, end: () => 5 }; third.emit("canplay");
      second.currentTime = 100; second.ended = true; second.paused = true; second.emit("ended");
    });
    await waitFor(() => expect(third.paused).toBe(false));
    expect(third.loadImpl).toHaveBeenCalledTimes(1);
    const setHandler = vi.mocked(navigator.mediaSession.setActionHandler);
    const pause = setHandler.mock.calls.find(([action]) => action === "pause")![1]!;
    await act(async () => pause({ action: "pause" }));
    expect(third.paused).toBe(true);
    expect(screen.getByTestId("playing")).toHaveTextContent("false");
    expect(second.src).toBe("");
  });

  it("keeps recovery on a promoted element and ignores its late play result after Pause", async () => {
    const { audio } = await startBook();
    const reserve = await prepareReserve(audio);
    const pending = deferred<void>();
    reserve.playImpl.mockImplementationOnce(() => pending.promise);
    vi.useFakeTimers();
    await act(async () => { audio.currentTime = 100; audio.ended = true; audio.paused = true; audio.emit("ended"); });
    expect(reserve.playImpl).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(reserve.loadImpl).toHaveBeenCalledTimes(2);
    await ready(reserve);
    expect(reserve.playImpl).toHaveBeenCalledTimes(2);
    expect(reserve.paused).toBe(false);
    const pause = vi.mocked(navigator.mediaSession.setActionHandler).mock.calls
      .find(([action]) => action === "pause")![1]!;
    await act(async () => pause({ action: "pause" }));
    await act(async () => { reserve.paused = false; pending.resolve(); reserve.emit("playing"); });
    expect(reserve.paused).toBe(true);
    expect(screen.getByTestId("playing")).toHaveTextContent("false");
  });

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

  it("records one trace when the next chapter starts before completion confirmation fails", async () => {
    const { audio } = await startBook();
    let rejectCompletion!: (error: Error) => void;
    const pendingCompletion = new Promise<PlaybackUpdateResponse>((_, reject) => {
      rejectCompletion = reject;
    });
    const update = vi.mocked(api.playback.update);
    const ordinaryUpdate = update.getMockImplementation()!;
    update.mockImplementation((payload) =>
      payload.completed ? pendingCompletion : ordinaryUpdate(payload)
    );

    await act(async () => {
      audio.ended = true;
      audio.paused = true;
      audio.currentTime = 100;
      audio.emit("ended");
    });
    await waitFor(() => expect(audio.src).toContain("/tracks/2/audio"));
    await ready(audio);
    await waitFor(() => expect(audio.paused).toBe(false));
    await act(async () => { rejectCompletion(new Error("Network unavailable")); });
    await waitFor(() => expect(screen.getByTestId("error")).toHaveTextContent("Could not confirm playback completion."));

  });

  it("recovers an unreceived completion request and keeps the predicted chapter playing", async () => {
    const { audio } = await startBook();
    let rejectFirst!: (error: Error) => void;
    const firstRequest = new Promise<PlaybackUpdateResponse>((_, reject) => { rejectFirst = reject; });
    const update = vi.mocked(api.playback.update);
    const ordinaryUpdate = update.getMockImplementation()!;
    let completions = 0;
    update.mockImplementation((payload) => {
      if (!payload.completed) return ordinaryUpdate(payload);
      completions += 1;
      return completions === 1 ? firstRequest : Promise.resolve({
        playback: { audiobookId: 10, trackId: 1, positionSeconds: 100, lastUpdated: stamp },
        nextTarget: { type: "audiobook", audiobookId: 10, trackId: 2 },
        nextTrackId: 2,
        nextEpisodeId: null,
      });
    });

    await act(async () => {
      audio.currentTime = 100; audio.ended = true; audio.paused = true; audio.emit("ended");
    });
    await waitFor(() => expect(audio.src).toContain("/tracks/2/audio"));
    await ready(audio);
    await waitFor(() => expect(audio.paused).toBe(false));
    await act(async () => { rejectFirst(new TypeError("Failed to fetch")); });

    await waitFor(() => expect(completions).toBe(2));
    expect(audio.src).toContain("/tracks/2/audio");
    expect(audio.paused).toBe(false);
    expect(screen.getByTestId("error")).toHaveTextContent("none");
  });

  it("does not complete twice when the server committed but Chrome lost the response", async () => {
    const { audio } = await startBook();
    let rejectFirst!: (error: Error) => void;
    const firstRequest = new Promise<PlaybackUpdateResponse>((_, reject) => { rejectFirst = reject; });
    const update = vi.mocked(api.playback.update);
    const ordinaryUpdate = update.getMockImplementation()!;
    let completions = 0;
    update.mockImplementation((payload) => {
      if (!payload.completed) return ordinaryUpdate(payload);
      completions += 1;
      return firstRequest;
    });

    await act(async () => {
      audio.currentTime = 100; audio.ended = true; audio.paused = true; audio.emit("ended");
    });
    await waitFor(() => expect(audio.src).toContain("/tracks/2/audio"));
    await ready(audio);
    await waitFor(() => expect(audio.paused).toBe(false));
    const bookReadsBeforeRecovery = vi.mocked(api.audiobooks.get).mock.calls.length;
    // The get mock reads tracks at call time, after the simulated server commit.
    tracks = tracks.map((item) => item.id === 1 ? { ...item, isListened: true } : item);
    queue = [{ ...book, trackId: 2, trackNumber: 2, audioUrl: "/api/audiobooks/10/tracks/2/audio" }];
    await act(async () => { rejectFirst(new TypeError("Response lost")); });

    await waitFor(() => expect(vi.mocked(api.audiobooks.get).mock.calls.length).toBeGreaterThan(bookReadsBeforeRecovery));
    expect(completions).toBe(1);
    expect(audio.src).toContain("/tracks/2/audio");
    expect(audio.paused).toBe(false);
    expect(screen.getByTestId("error")).toHaveTextContent("none");
  });

  it.each(["request lost", "response lost"] as const)(
    "keeps the next podcast episode after a completion %s",
    async (failure) => {
      let serverCompleted = false;
      queue = [podcastEpisode(11), podcastEpisode(12)];
      vi.mocked(api.playback.queue).mockImplementation(async () => ({
        queue: queue.map((item) => ({ ...item })),
        // This may still point at the finished episode after completion.
        activePlayback: { episodeId: 11, lastUpdated: stamp },
      }));
      vi.spyOn(api.episodes, "get").mockImplementation(async (id) => ({
        episode: podcastEpisode(id, id === 11 && serverCompleted),
      }));
      let rejectFirst!: (error: Error) => void;
      const firstRequest = new Promise<PlaybackUpdateResponse>((_, reject) => { rejectFirst = reject; });
      const update = vi.mocked(api.playback.update);
      const ordinaryUpdate = update.getMockImplementation()!;
      let completions = 0;
      update.mockImplementation((payload) => {
        if (!payload.completed) return ordinaryUpdate(payload);
        completions += 1;
        return completions === 1 ? firstRequest : Promise.resolve({
          playback: { episodeId: 11, positionSeconds: 100, lastUpdated: stamp },
          nextTarget: { type: "episode", episodeId: 12 },
          nextEpisodeId: 12,
        });
      });

      render(<PlaybackProvider><Harness /></PlaybackProvider>);
      await waitFor(() => expect(screen.getByRole("button", { name: "Book" })).toBeEnabled());
      await userEvent.setup().click(screen.getByRole("button", { name: "Book" }));
      const audio = FakeAudio.first;
      await waitFor(() => expect(audio.src).toContain("/episodes/11/audio"));
      await ready(audio);
      await waitFor(() => expect(audio.paused).toBe(false));
      await act(async () => {
        audio.currentTime = 100; audio.ended = true; audio.paused = true; audio.emit("ended");
      });
      await waitFor(() => expect(audio.src).toContain("/episodes/12/audio"));
      await ready(audio);
      await waitFor(() => expect(audio.paused).toBe(false));
      serverCompleted = failure === "response lost";
      await act(async () => { rejectFirst(new TypeError("Failed to fetch")); });
      await waitFor(() => expect(completions).toBe(failure === "request lost" ? 2 : 1));
      expect(audio.src).toContain("/episodes/12/audio");
      expect(audio.paused).toBe(false);
      expect(screen.getByTestId("error")).toHaveTextContent("none");
    }
  );

  it.each([false, true])(
    "reconciles completion of the last podcast episode when earlier items listened=%s",
    async (earlierListened) => {
      let serverCompleted = false;
      queue = [podcastEpisode(12, earlierListened), podcastEpisode(11)];
      vi.mocked(api.playback.queue).mockImplementation(async () => ({
        queue: queue.map((item) => ({ ...item })),
        activePlayback: { episodeId: 11, lastUpdated: stamp },
      }));
      vi.spyOn(api.episodes, "get").mockImplementation(async (id) => ({
        episode: podcastEpisode(id, id === 11 && serverCompleted),
      }));
      let rejectCompletion!: (error: Error) => void;
      const completion = new Promise<PlaybackUpdateResponse>((_, reject) => {
        rejectCompletion = reject;
      });
      const update = vi.mocked(api.playback.update);
      const ordinaryUpdate = update.getMockImplementation()!;
      update.mockImplementation((payload) =>
        payload.completed ? completion : ordinaryUpdate(payload)
      );

      render(<PlaybackProvider><Harness /></PlaybackProvider>);
      await userEvent.setup().click(await screen.findByRole("button", { name: "Second" }));
      const audio = FakeAudio.first;
      await waitFor(() => expect(audio.src).toContain("/episodes/11/audio"));
      await ready(audio);
      await waitFor(() => expect(audio.paused).toBe(false));
      const playsBeforeCompletion = audio.playImpl.mock.calls.length;
      await act(async () => {
        audio.currentTime = 100; audio.ended = true; audio.paused = true; audio.emit("ended");
      });
      serverCompleted = true;
      queue = [podcastEpisode(12, earlierListened), podcastEpisode(11, true)];
      await act(async () => { rejectCompletion(new TypeError("Response lost")); });

      if (earlierListened) {
        await waitFor(() => expect(screen.getByTestId("playing")).toHaveTextContent("false"));
        expect(audio.paused).toBe(true);
        expect(audio.playImpl).toHaveBeenCalledTimes(playsBeforeCompletion);
      } else {
        await waitFor(() => expect(audio.src).toContain("/episodes/12/audio"));
        await ready(audio);
        await waitFor(() => expect(audio.paused).toBe(false));
      }
      expect(update.mock.calls.filter(([payload]) => payload.completed)).toHaveLength(1);
      expect(screen.getByTestId("error")).toHaveTextContent("none");
    }
  );

  it("recovers MEDIA_ERROR_4 on the predicted chapter after completion succeeds", async () => {
    const { audio } = await startBook();
    await act(async () => {
      audio.currentTime = 100; audio.ended = true; audio.paused = true; audio.emit("ended");
    });
    await waitFor(() => expect(audio.src).toContain("/tracks/2/audio"));
    await ready(audio);
    await waitFor(() => expect(audio.paused).toBe(false));
    const loadsBeforeError = audio.loadImpl.mock.calls.length;
    const playsBeforeError = audio.playImpl.mock.calls.length;

    await act(async () => {
      audio.error = { code: 4 };
      audio.paused = true;
      audio.emit("error");
    });
    await waitFor(() => expect(audio.loadImpl.mock.calls.length).toBeGreaterThan(loadsBeforeError));
    audio.error = null;
    await ready(audio);
    await waitFor(() => expect(audio.playImpl.mock.calls.length).toBe(playsBeforeError + 1));
    expect(audio.src).toContain("/tracks/2/audio");
    expect(audio.paused).toBe(false);
    expect(screen.getByTestId("error")).toHaveTextContent("none");
    expect(vi.mocked(api.playback.update).mock.calls.filter(([payload]) => payload.completed)).toHaveLength(1);
  });

  it("recovers a confirmed media error before the new chapter has metadata", async () => {
    const { audio } = await startBook();
    const oldPlay = deferred<void>();
    audio.playImpl.mockImplementationOnce(() => oldPlay.promise);
    await act(async () => {
      audio.currentTime = 100; audio.ended = true; audio.paused = true; audio.emit("ended");
    });
    await waitFor(() => expect(screen.getByTestId("queue-track")).toHaveTextContent("2"));
    expect(audio.readyState).toBe(0);
    const loads = audio.loadImpl.mock.calls.length;
    await act(async () => { audio.error = { code: 4 }; audio.emit("error"); });
    expect(audio.loadImpl).toHaveBeenCalledTimes(loads + 1);
    audio.error = null;
    await ready(audio);
    expect(audio.paused).toBe(false);
    expect(screen.getByTestId("playing")).toHaveTextContent("true");
    expect(screen.getByTestId("error")).toHaveTextContent("none");
    await act(async () => { oldPlay.resolve(); });
    expect(audio.paused).toBe(false);
  });

  it("reloads a pending hidden-tab start once and ignores the superseded play result", async () => {
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    const { audio } = await startBook();
    let rejectOldPlay!: (error: Error) => void;
    audio.playImpl.mockImplementationOnce(() => new Promise<void>((_, reject) => { rejectOldPlay = reject; }));
    vi.useFakeTimers();
    await act(async () => {
      audio.currentTime = 100; audio.ended = true; audio.paused = true; audio.emit("ended");
    });
    const loads = audio.loadImpl.mock.calls.length;
    const plays = audio.playImpl.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(audio.loadImpl).toHaveBeenCalledTimes(loads + 1);
    await ready(audio);
    expect(audio.playImpl).toHaveBeenCalledTimes(plays + 1);
    expect(audio.paused).toBe(false);
    await act(async () => { rejectOldPlay(new DOMException("Old load aborted", "NotSupportedError")); });
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(audio.loadImpl).toHaveBeenCalledTimes(loads + 1);
    expect(audio.paused).toBe(false);
    expect(screen.getByTestId("error")).toHaveTextContent("none");
  });

  it("bounds a resumed chapter's metadata wait and preserves its saved position", async () => {
    tracks[1]!.positionSeconds = 47;
    const { audio } = await startBook();
    vi.useFakeTimers();
    const plays = audio.playImpl.mock.calls.length;
    await act(async () => {
      audio.currentTime = 100; audio.ended = true; audio.paused = true; audio.emit("ended");
    });
    expect(audio.playImpl).toHaveBeenCalledTimes(plays);
    const loads = audio.loadImpl.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(audio.loadImpl).toHaveBeenCalledTimes(loads + 1);
    await ready(audio);
    expect(audio.currentTime).toBe(47);
    expect(audio.paused).toBe(false);
    expect(screen.getByTestId("position")).toHaveTextContent("47");
  });

  it.each(["loading", "play"] as const)("stops if the reloaded source stalls during %s and blocks late playback", async (stage) => {
    const { audio } = await startBook();
    const oldPlay = deferred<void>();
    audio.playImpl.mockImplementation(() => oldPlay.promise);
    vi.useFakeTimers();
    await act(async () => {
      audio.currentTime = 100; audio.ended = true; audio.paused = true; audio.emit("ended");
    });
    const loads = audio.loadImpl.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    if (stage === "play") await ready(audio);
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(audio.loadImpl).toHaveBeenCalledTimes(loads + 1);
    expect(screen.getByTestId("playing")).toHaveTextContent("false");
    expect(screen.getByTestId("error")).toHaveTextContent("Timeout waiting for audio to become ready");
    const plays = audio.playImpl.mock.calls.length;
    await ready(audio);
    await act(async () => { audio.paused = false; audio.emit("playing"); oldPlay.resolve(); });
    expect(audio.paused).toBe(true);
    expect(audio.playImpl).toHaveBeenCalledTimes(plays);
  });

  it.each(["pause", "select", "unmount"] as const)("cancels the pending-start watchdog on %s", async (action) => {
    const { audio, unmount } = await startBook();
    const oldPlay = deferred<void>();
    audio.playImpl.mockImplementationOnce(() => oldPlay.promise);
    vi.useFakeTimers();
    await act(async () => {
      audio.currentTime = 100; audio.ended = true; audio.paused = true; audio.emit("ended");
    });
    await act(async () => {
      if (action === "unmount") unmount();
      else screen.getByRole("button", { name: action === "pause" ? "Toggle" : "Choose C" }).click();
    });
    if (action === "select") await ready(audio);
    const loads = audio.loadImpl.mock.calls.length;
    const plays = audio.playImpl.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); oldPlay.resolve(); });
    expect(audio.loadImpl).toHaveBeenCalledTimes(loads);
    expect(audio.playImpl).toHaveBeenCalledTimes(plays);
    if (action === "select") {
      expect(audio.src).toContain("/tracks/3/audio");
      expect(audio.currentTime).toBe(31);
      expect(audio.paused).toBe(false);
    } else expect(audio.paused).toBe(true);
  });

  it.each([
    ["metadata", "update"], ["metadata", "refresh"],
    ["play", "update"], ["play", "refresh"],
    ["reload", "update"], ["reload", "refresh"],
  ] as const)("cancels a chapter's %s recovery when its book is removed by %s", async (stage, removal) => {
    queue = [book, podcastEpisode(2)];
    if (stage !== "play") tracks[1]!.positionSeconds = 47;
    const { audio } = await startBook();
    const oldPlay = deferred<void>();
    if (stage === "play") audio.playImpl.mockImplementationOnce(() => oldPlay.promise);
    vi.useFakeTimers();
    await act(async () => {
      audio.currentTime = 100; audio.ended = true; audio.paused = true; audio.emit("ended");
    });
    expect(audio.src).toContain("/tracks/2/audio");
    if (stage === "reload") await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    const lateReady = audio.captureEvent("canplay");
    queue = [podcastEpisode(2)];
    await act(async () => {
      screen.getByRole("button", { name: removal === "update" ? "Remove book" : "Reload" }).click();
    });
    expect(screen.getByTestId("episode")).toHaveTextContent("2");
    // Retiring the old source can queue pause while the new source is still loading.
    await act(async () => { audio.emit("pause"); });
    const loads = audio.loadImpl.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(audio.loadImpl).toHaveBeenCalledTimes(loads);
    expect(audio.src).toContain("/episodes/2/audio");
    await ready(audio);
    expect(audio.paused).toBe(false);
    const plays = audio.playImpl.mock.calls.length;
    await act(async () => { lateReady(); oldPlay.resolve(); await vi.advanceTimersByTimeAsync(60_000); });
    expect(audio.playImpl).toHaveBeenCalledTimes(plays);
    expect(audio.src).toContain("/episodes/2/audio");
    expect(audio.paused).toBe(false);
    expect(screen.getByTestId("error")).toHaveTextContent("none");
  });

  it("retires the pending chapter when removing its book empties the queue", async () => {
    const { audio } = await startBook();
    const oldPlay = deferred<void>();
    audio.playImpl.mockImplementationOnce(() => oldPlay.promise);
    vi.useFakeTimers();
    await act(async () => {
      audio.currentTime = 100; audio.ended = true; audio.paused = true; audio.emit("ended");
    });
    const lateReady = audio.captureEvent("canplay");
    queue = [];
    await act(async () => { screen.getByRole("button", { name: "Remove book" }).click(); });
    const loads = audio.loadImpl.mock.calls.length;
    const plays = audio.playImpl.mock.calls.length;
    await act(async () => {
      audio.paused = false; oldPlay.resolve(); lateReady(); audio.emit("playing");
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(audio.src).toBe("");
    expect(audio.paused).toBe(true);
    expect(audio.loadImpl).toHaveBeenCalledTimes(loads);
    expect(audio.playImpl).toHaveBeenCalledTimes(plays);
    expect(screen.getByTestId("playing")).toHaveTextContent("false");
    expect(screen.getByTestId("error")).toHaveTextContent("none");
  });

  it("cancels recovery when a queue refresh selects another chapter of the same book", async () => {
    tracks[1]!.positionSeconds = 47;
    const { audio } = await startBook();
    vi.useFakeTimers();
    await act(async () => {
      audio.currentTime = 100; audio.ended = true; audio.paused = true; audio.emit("ended");
    });
    const lateReady = audio.captureEvent("canplay");
    queue = [{ ...book, trackId: 3, trackNumber: 3, audioUrl: "/api/audiobooks/10/tracks/3/audio",
      playback: { audiobookId: 10, trackId: 3, positionSeconds: 31, lastUpdated: stamp } }];
    await act(async () => { screen.getByRole("button", { name: "Reload" }).click(); });
    expect(audio.src).toContain("/tracks/3/audio");
    const loads = audio.loadImpl.mock.calls.length;
    await ready(audio);
    const plays = audio.playImpl.mock.calls.length;
    await act(async () => { lateReady(); await vi.advanceTimersByTimeAsync(60_000); });
    expect(audio.src).toContain("/tracks/3/audio");
    expect(audio.currentTime).toBe(31);
    expect(audio.paused).toBe(false);
    expect(audio.loadImpl).toHaveBeenCalledTimes(loads);
    expect(audio.playImpl).toHaveBeenCalledTimes(plays);
  });

  it("keeps recovery when a queue refresh retains the same pending chapter", async () => {
    tracks[1]!.positionSeconds = 47;
    const { audio } = await startBook();
    vi.useFakeTimers();
    await act(async () => {
      audio.currentTime = 100; audio.ended = true; audio.paused = true; audio.emit("ended");
    });
    queue = [{ ...book, trackId: 2, trackNumber: 2, audioUrl: "/api/audiobooks/10/tracks/2/audio" }];
    await act(async () => { screen.getByRole("button", { name: "Reload" }).click(); });
    const loads = audio.loadImpl.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(audio.loadImpl).toHaveBeenCalledTimes(loads + 1);
    await ready(audio);
    expect(audio.currentTime).toBe(47);
    expect(audio.paused).toBe(false);
    expect(screen.getByTestId("error")).toHaveTextContent("none");
  });

  it.each(["timeout-error", "error-timeout"] as const)("shares the single reload budget across %s", async (order) => {
    const { audio } = await startBook();
    const oldPlay = deferred<void>();
    audio.playImpl.mockImplementation(() => oldPlay.promise);
    vi.useFakeTimers();
    await act(async () => {
      audio.currentTime = 100; audio.ended = true; audio.paused = true; audio.emit("ended");
    });
    const loads = audio.loadImpl.mock.calls.length;
    await act(async () => {
      if (order === "timeout-error") await vi.advanceTimersByTimeAsync(30_000);
      else { audio.error = { code: 4 }; audio.emit("error"); }
    });
    expect(audio.loadImpl).toHaveBeenCalledTimes(loads + 1);
    await act(async () => {
      if (order === "timeout-error") { audio.error = { code: 4 }; audio.emit("error"); }
      else await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(audio.loadImpl).toHaveBeenCalledTimes(loads + 1);
    expect(screen.getByTestId("playing")).toHaveTextContent("false");
    expect(screen.getByTestId("error")).toHaveTextContent(order === "timeout-error"
      ? "Audio source is not supported." : "Timeout waiting for audio to become ready");
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); oldPlay.resolve(); });
    expect(audio.loadImpl).toHaveBeenCalledTimes(loads + 1);
    expect(audio.paused).toBe(true);
  });

  it("treats MediaSession Play as idempotent while a resumed chapter waits for metadata", async () => {
    tracks[1]!.positionSeconds = 47;
    const { audio } = await startBook();
    await act(async () => {
      audio.currentTime = 100; audio.ended = true; audio.paused = true; audio.emit("ended");
    });
    expect(audio.paused).toBe(true);
    expect(screen.getByTestId("playing")).toHaveTextContent("true");
    const session = navigator.mediaSession;
    const playHandler = vi.mocked(session.setActionHandler).mock.calls.find(([action]) => action === "play")![1]!;
    await act(async () => { playHandler({ action: "play" }); playHandler({ action: "play" }); });
    expect(screen.getByTestId("playing")).toHaveTextContent("true");
    await ready(audio);
    expect(audio.currentTime).toBe(47);
    expect(audio.paused).toBe(false);
  });

  it("does not resume after Pause while the failed chapter reloads", async () => {
    const { user, audio } = await startBook();
    await act(async () => {
      audio.currentTime = 100; audio.ended = true; audio.paused = true; audio.emit("ended");
    });
    await waitFor(() => expect(audio.src).toContain("/tracks/2/audio"));
    await ready(audio);
    await waitFor(() => expect(screen.getByTestId("playing")).toHaveTextContent("true"));
    await waitFor(() => expect(screen.getByTestId("queue-track")).toHaveTextContent("2"));
    await act(async () => {
      audio.error = { code: 4 }; audio.paused = true; audio.emit("error");
    });
    const playsBeforePause = audio.playImpl.mock.calls.length;
    await user.click(screen.getByRole("button", { name: "Toggle" }));
    audio.error = null;
    await ready(audio);
    expect(audio.playImpl).toHaveBeenCalledTimes(playsBeforePause);
    expect(screen.getByTestId("playing")).toHaveTextContent("false");
  });

  it("keeps the manually chosen chapter during the previous chapter's media recovery", async () => {
    const { user, audio } = await startBook();
    await act(async () => {
      audio.currentTime = 100; audio.ended = true; audio.paused = true; audio.emit("ended");
    });
    await waitFor(() => expect(audio.src).toContain("/tracks/2/audio"));
    await ready(audio);
    await waitFor(() => expect(screen.getByTestId("queue-track")).toHaveTextContent("2"));
    await act(async () => {
      audio.error = { code: 4 }; audio.paused = true; audio.emit("error");
    });
    const lateBReady = audio.captureEvent("canplay");
    await user.click(screen.getByRole("button", { name: "Choose C" }));
    await waitFor(() => expect(audio.src).toContain("/tracks/3/audio"));
    audio.error = null;
    await ready(audio);
    await waitFor(() => expect(audio.paused).toBe(false));
    expect(audio.currentTime).toBe(31);
    const playsAtC = audio.playImpl.mock.calls.length;
    const loadsAtC = audio.loadImpl.mock.calls.length;
    await act(async () => { lateBReady(); });
    expect(audio.src).toContain("/tracks/3/audio");
    expect(audio.currentTime).toBe(31);
    expect(audio.paused).toBe(false);
    expect(audio.playImpl).toHaveBeenCalledTimes(playsAtC);
    expect(audio.loadImpl).toHaveBeenCalledTimes(loadsAtC);
    expect(screen.getByTestId("error")).toHaveTextContent("none");
  });

  it("stops after one reload when the next chapter really has an unsupported source", async () => {
    const { audio } = await startBook();
    await act(async () => {
      audio.currentTime = 100; audio.ended = true; audio.paused = true; audio.emit("ended");
    });
    await waitFor(() => expect(audio.src).toContain("/tracks/2/audio"));
    await ready(audio);
    await waitFor(() => expect(screen.getByTestId("queue-track")).toHaveTextContent("2"));
    await act(async () => {
      audio.error = { code: 4 }; audio.paused = true; audio.emit("error");
    });
    const loadsAfterRetry = audio.loadImpl.mock.calls.length;
    await act(async () => { audio.error = { code: 4 }; audio.emit("error"); });
    expect(audio.loadImpl).toHaveBeenCalledTimes(loadsAfterRetry);
    expect(screen.getByTestId("playing")).toHaveTextContent("false");
    expect(screen.getByTestId("error")).toHaveTextContent("Audio source is not supported.");
  });

  it("resumes from the local position while the pause save is pending", async () => {
    const { user, audio } = await startBook();
    await waitFor(() => expect(screen.getByTestId("playing")).toHaveTextContent("true"));
    const pendingSave = deferred<PlaybackUpdateResponse>();
    const update = vi.mocked(api.playback.update).mockReturnValue(pendingSave.promise);
    const get = vi.mocked(api.playback.get);
    get.mockResolvedValue({
      playback: { audiobookId: 10, trackId: 1, positionSeconds: 42, lastUpdated: stamp },
    });
    const getCallsBeforePause = get.mock.calls.length;
    audio.currentTime = 42;

    await user.click(screen.getByRole("button", { name: "Toggle" }));
    await waitFor(() => expect(update).toHaveBeenCalledWith(expect.objectContaining({
      audiobookId: 10, trackId: 1, positionSeconds: 42, completed: false,
    })));
    await waitFor(() => expect(screen.getByTestId("position")).toHaveTextContent("42"));

    await user.click(screen.getByRole("button", { name: "Toggle" }));
    expect(get).toHaveBeenCalledTimes(getCallsBeforePause);
    await waitFor(() => expect(audio.paused).toBe(false));
    expect(audio.currentTime).toBe(42);
    expect(get).toHaveBeenCalledTimes(getCallsBeforePause);
    await act(async () => {
      pendingSave.resolve({
        playback: { audiobookId: 10, trackId: 1, positionSeconds: 42, lastUpdated: stamp },
        nextEpisodeId: null,
      });
    });
  });

  it("keeps pending playback saves scoped to their audiobook chapter", async () => {
    tracks[1] = track(2, { positionSeconds: 17 });
    const { user, audio } = await startBook();
    await waitFor(() => expect(screen.getByTestId("playing")).toHaveTextContent("true"));

    const pendingChapterOneSave = deferred<PlaybackUpdateResponse>();
    const update = vi.mocked(api.playback.update).mockImplementation(async (payload) => {
      if (payload.trackId === 1) return pendingChapterOneSave.promise;
      return {
        playback: { audiobookId: 10, trackId: payload.trackId, positionSeconds: payload.positionSeconds, lastUpdated: stamp },
        nextEpisodeId: null,
      };
    });
    const get = vi.mocked(api.playback.get);

    audio.currentTime = 42;
    await user.click(screen.getByRole("button", { name: "Toggle" }));
    await waitFor(() => expect(update).toHaveBeenCalledWith(expect.objectContaining({
      audiobookId: 10, trackId: 1, positionSeconds: 42, completed: false,
    })));

    await user.click(screen.getByRole("button", { name: "Choose B" }));
    await waitFor(() => expect(screen.getByTestId("source")).toHaveTextContent("2"));
    await ready(audio);
    await waitFor(() => expect(audio.paused).toBe(false));
    expect(audio.currentTime).toBe(17);

    const chapterTwoReadsBeforeResume = get.mock.calls.filter(
      ([target]) => typeof target !== "number" && "trackId" in target && target.trackId === 2
    ).length;
    await user.click(screen.getByRole("button", { name: "Toggle" }));
    await waitFor(() => expect(update).toHaveBeenCalledWith(expect.objectContaining({
      audiobookId: 10, trackId: 2, positionSeconds: 17, completed: false,
    })));
    await waitFor(() => expect(audio.paused).toBe(true));
    await act(async () => {});

    await user.click(screen.getByRole("button", { name: "Toggle" }));
    await waitFor(() => expect(get.mock.calls.filter(
      ([target]) => typeof target !== "number" && "trackId" in target && target.trackId === 2
    )).toHaveLength(chapterTwoReadsBeforeResume + 1));
    await waitFor(() => expect(audio.paused).toBe(false));
    expect(audio.currentTime).toBe(17);

    await act(async () => {
      pendingChapterOneSave.resolve({
        playback: { audiobookId: 10, trackId: 1, positionSeconds: 42, lastUpdated: stamp },
        nextEpisodeId: null,
      });
    });
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
      const loadsBeforeRecovery = audio.loadImpl.mock.calls.length;
      const playsBeforeRecovery = audio.playImpl.mock.calls.length;
      if (delayStage === "completion") {
        expect(screen.getByTestId("error")).not.toHaveTextContent("none");
        expect(screen.getByTestId("playing")).toHaveTextContent("false");
        await user.click(screen.getByRole("button", { name: "Toggle" }));
        await waitFor(() => expect(audio.loadImpl).toHaveBeenCalledTimes(loadsBeforeRecovery + 1));
      } else {
        expect(screen.getByTestId("error")).toHaveTextContent("none");
        expect(screen.getByTestId("playing")).toHaveTextContent("true");
      }
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
