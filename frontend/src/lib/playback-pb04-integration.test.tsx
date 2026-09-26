import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { api, type AudiobookTrack, type PlaybackQueueResponse, type PlaybackUpdateResponse } from "./api";
import { PlaybackProvider, usePlayback } from "./playback-context";
import type { QueueEpisode } from "./playback-context-types";

const stamp = "2026-09-25T10:00:00Z";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

class FakeAudio {
  static instances: FakeAudio[] = [];
  static get first() {
    const audio = this.instances[0];
    if (!audio) throw new Error("Missing audio element");
    return audio;
  }

  src = "";
  get currentSrc() { return this.src; }
  currentTime = 0;
  duration = 100;
  readyState = 0;
  playbackRate = 1;
  defaultPlaybackRate = 1;
  paused = true;
  ended = false;
  error: MediaError | null = null;
  private listeners = new Map<string, Set<() => void>>();
  playImpl = vi.fn(async () => { this.paused = false; this.ended = false; this.emit("playing"); });
  loadImpl = vi.fn(() => { this.paused = true; this.ended = false; this.readyState = 0; this.currentTime = 0; });

  constructor() { FakeAudio.instances.push(this); }
  addEventListener(type: string, listener: () => void) {
    const listeners = this.listeners.get(type) ?? new Set<() => void>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }
  removeEventListener(type: string, listener: () => void) { this.listeners.get(type)?.delete(listener); }
  play() { return this.playImpl(); }
  pause() { this.paused = true; }
  load() { this.loadImpl(); }
  emit(type: string) { this.listeners.get(type)?.forEach((listener) => listener()); }
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
const podcast: QueueEpisode = {
  type: "episode", id: 20, title: "Podcast", podcastId: 20, podcastTitle: "Podcast",
  podcastImageUrl: null, description: null, audioUrl: "https://example.com/20.mp3",
  duration: 100, downloaded: false, isListened: false, publishedAt: null, playback: null,
};

function Harness() {
  const { queue, currentEpisode, playing, playQueueItem, reloadQueue } = usePlayback();
  return <>
    <div data-testid="source">{currentEpisode?.trackId ?? currentEpisode?.id ?? "none"}</div>
    <div data-testid="playing">{String(playing)}</div>
    <button onClick={() => playQueueItem(queue.find((item) => item.id === 10)!)}>Book</button>
    <button onClick={() => playQueueItem(queue.find((item) => item.id === 20)!)}>Podcast</button>
    <button onClick={() => void reloadQueue()}>Reload</button>
  </>;
}

describe("PB-04 completion reconciliation", () => {
  let tracks: AudiobookTrack[];
  let queue: QueueEpisode[];

  beforeEach(() => {
    vi.restoreAllMocks();
    FakeAudio.instances = [];
    vi.stubGlobal("Audio", FakeAudio);
    Object.defineProperty(navigator, "mediaSession", {
      configurable: true,
      value: { setActionHandler: vi.fn(), playbackState: "none" },
    });
    tracks = [track(1), track(2), track(3)];
    queue = [book, podcast];
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

  it("refreshes selected chapters after a queue reload and skips a removed chapter", async () => {
    const { user, audio } = await startBook();
    tracks = [track(1), track(2, { inPlaylist: false }), track(3, { positionSeconds: 36 })];
    await user.click(screen.getByRole("button", { name: "Reload" }));
    await waitFor(() => expect(api.audiobooks.get).toHaveBeenCalledTimes(2));
    vi.mocked(api.playback.update).mockImplementation(async (payload) => ({
      playback: { audiobookId: 10, trackId: payload.trackId, positionSeconds: payload.positionSeconds, lastUpdated: stamp },
      nextTarget: payload.completed ? { type: "audiobook", audiobookId: 10, trackId: 3 } : undefined,
      nextTrackId: payload.completed ? 3 : null,
      nextEpisodeId: null,
    }));

    await act(async () => { audio.currentTime = 100; audio.emit("ended"); });
    await waitFor(() => expect(audio.src).toContain("/tracks/3/audio"));
    await act(async () => { audio.readyState = 4; audio.emit("loadedmetadata"); audio.emit("canplay"); });
    expect(audio.currentTime).toBe(36);
    expect(audio.src).not.toContain("/tracks/2/audio");
  });

  it("waits for backend while a changed chapter selection is still reloading", async () => {
    const { user, audio } = await startBook();
    const pendingQueue = deferred<PlaybackQueueResponse>();
    const completion = deferred<PlaybackUpdateResponse>();
    vi.mocked(api.playback.queue).mockReturnValueOnce(pendingQueue.promise);
    vi.mocked(api.playback.update).mockReturnValueOnce(completion.promise);
    await user.click(screen.getByRole("button", { name: "Reload" }));

    await act(async () => { audio.currentTime = 100; audio.emit("ended"); });
    expect(audio.src).toContain("/tracks/1/audio");
    queue = [{ ...book, trackId: 3, trackNumber: 3, audioUrl: "/api/audiobooks/10/tracks/3/audio" }, podcast];
    await act(async () => { completion.resolve({
      playback: { audiobookId: 10, trackId: 1, positionSeconds: 100, lastUpdated: stamp },
      nextTarget: { type: "audiobook", audiobookId: 10, trackId: 3 },
      nextTrackId: 3, nextEpisodeId: null,
    }); });
    await waitFor(() => expect(audio.src).toContain("/tracks/3/audio"));
    await act(async () => { pendingQueue.resolve({
      queue: [book, podcast],
      activePlayback: { audiobookId: 10, trackId: 1, lastUpdated: stamp },
    }); });
    expect(audio.src).toContain("/tracks/3/audio");
  });

  it("uses the backend target when it disagrees with the cached prediction", async () => {
    const { audio } = await startBook();
    const completion = deferred<PlaybackUpdateResponse>();
    vi.mocked(api.playback.update).mockReturnValueOnce(completion.promise);

    await act(async () => { audio.currentTime = 100; audio.emit("ended"); });
    await waitFor(() => expect(audio.src).toContain("/tracks/2/audio"));
    const loadsBeforeDecision = audio.loadImpl.mock.calls.length;

    queue = [{ ...book, trackId: 3, trackNumber: 3, audioUrl: "/api/audiobooks/10/tracks/3/audio" }, podcast];
    await act(async () => { completion.resolve({
      playback: { audiobookId: 10, trackId: 1, positionSeconds: 100, lastUpdated: stamp },
      nextTarget: { type: "audiobook", audiobookId: 10, trackId: 3 },
      nextTrackId: 3, nextEpisodeId: null,
    }); });
    await waitFor(() => expect(audio.src).toContain("/tracks/3/audio"));
    expect(audio.loadImpl.mock.calls.length).toBe(loadsBeforeDecision + 1);
  });

  it("does not reload the same source when backend confirms the prediction", async () => {
    const { audio } = await startBook();
    const completion = deferred<PlaybackUpdateResponse>();
    vi.mocked(api.playback.update).mockReturnValueOnce(completion.promise);

    await act(async () => { audio.currentTime = 100; audio.emit("ended"); });
    await waitFor(() => expect(audio.src).toContain("/tracks/2/audio"));
    const loadCount = audio.loadImpl.mock.calls.length;
    queue = [{ ...book, trackId: 2, trackNumber: 2, audioUrl: "/api/audiobooks/10/tracks/2/audio" }, podcast];
    await act(async () => { completion.resolve({
      playback: { audiobookId: 10, trackId: 1, positionSeconds: 100, lastUpdated: stamp },
      nextTarget: { type: "audiobook", audiobookId: 10, trackId: 2 },
      nextTrackId: 2, nextEpisodeId: null,
    }); });
    expect(audio.src).toContain("/tracks/2/audio");
    expect(audio.loadImpl).toHaveBeenCalledTimes(loadCount);
  });

  it("waits for backend guidance when the chapter cache failed", async () => {
    vi.mocked(api.audiobooks.get).mockRejectedValue(new Error("offline"));
    const { audio } = await startBook();
    const completion = deferred<PlaybackUpdateResponse>();
    vi.mocked(api.playback.update).mockReturnValueOnce(completion.promise);

    await act(async () => { audio.currentTime = 100; audio.emit("ended"); });
    expect(audio.src).toContain("/tracks/1/audio");
    await act(async () => { completion.resolve({
      playback: { audiobookId: 10, trackId: 1, positionSeconds: 100, lastUpdated: stamp },
      nextTarget: { type: "audiobook", audiobookId: 10, trackId: 3 },
      nextTrackId: 3, nextEpisodeId: null,
    }); });
    await waitFor(() => expect(audio.src).toContain("/tracks/3/audio"));
  });

  it("ignores a late chapter-cache response after selection changes", async () => {
    const oldDetails = deferred<Awaited<ReturnType<typeof api.audiobooks.get>>>();
    vi.mocked(api.audiobooks.get)
      .mockReturnValueOnce(oldDetails.promise)
      .mockImplementation(async () => ({ audiobook: {
        id: 10, title: "Book", author: "Author", relPath: "book", hasCover: false,
        totalDuration: 300, trackCount: 3, listenedCount: 0, isListened: false,
        positionSeconds: 0, createdAt: stamp, updatedAt: stamp,
        tracks: [track(1), track(2, { inPlaylist: false }), track(3)],
      } }));
    const { user, audio } = await startBook();
    await user.click(screen.getByRole("button", { name: "Reload" }));
    await waitFor(() => expect(api.audiobooks.get).toHaveBeenCalledTimes(2));
    await act(async () => { oldDetails.resolve({ audiobook: {
      id: 10, title: "Book", author: "Author", relPath: "book", hasCover: false,
      totalDuration: 300, trackCount: 3, listenedCount: 0, isListened: false,
      positionSeconds: 0, createdAt: stamp, updatedAt: stamp,
      tracks: [track(1), track(2), track(3)],
    } }); });
    const completion = deferred<PlaybackUpdateResponse>();
    vi.mocked(api.playback.update).mockReturnValueOnce(completion.promise);

    await act(async () => { audio.currentTime = 100; audio.emit("ended"); });
    await waitFor(() => expect(audio.src).toContain("/tracks/3/audio"));
    expect(audio.src).not.toContain("/tracks/2/audio");
  });

  it("starts the backend fallback after the final selected chapter", async () => {
    tracks = [track(1), track(2, { inPlaylist: false }), track(3, { inPlaylist: false })];
    const { audio } = await startBook();
    vi.mocked(api.playback.update).mockImplementation(async (payload) => ({
      playback: { audiobookId: 10, trackId: payload.trackId, positionSeconds: payload.positionSeconds, lastUpdated: stamp },
      nextTarget: payload.completed ? { type: "episode", episodeId: 20 } : undefined,
      nextTrackId: null,
      nextEpisodeId: payload.completed ? 20 : null,
    }));
    queue = [podcast];

    await act(async () => { audio.currentTime = 100; audio.emit("ended"); });
    await waitFor(() => expect(audio.src).toContain("/api/episodes/20/audio"));
    expect(audio.src).not.toContain("/tracks/2/audio");
  });

  it("does not apply an old queue response after a manual choice", async () => {
    const { user, audio } = await startBook();
    const oldQueue = deferred<PlaybackQueueResponse>();
    vi.mocked(api.playback.queue).mockReturnValueOnce(oldQueue.promise);
    await user.click(screen.getByRole("button", { name: "Reload" }));
    await user.click(screen.getByRole("button", { name: "Podcast" }));
    await waitFor(() => expect(audio.src).toContain("/api/episodes/20/audio"));

    await act(async () => { oldQueue.resolve({
      queue: [book, podcast],
      activePlayback: { audiobookId: 10, trackId: 1, lastUpdated: stamp },
    }); });
    expect(audio.src).toContain("/api/episodes/20/audio");
    expect(screen.getByTestId("source")).toHaveTextContent("20");
  });
});
