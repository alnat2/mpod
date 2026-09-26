import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api, type AudiobookTrack, type PlaybackState } from "./api";
import { PlaybackProvider, usePlayback } from "./playback-context";
import type { QueueEpisode } from "./playback-context-types";

// FakeAudio implementation
class FakeAudio {
  static instances: FakeAudio[] = [];
  static get first() {
    const audio = FakeAudio.instances[0];
    if (!audio) throw new Error("Expected an audio instance");
    return audio;
  }
  
  src = "";
  get currentSrc() { return this.src; }
  duration = 0;
  readyState = 1;
  playbackRate = 1;
  defaultPlaybackRate = 1;
  paused = true;
  ended = false;
  error: MediaError | null = null;
  private listeners = new Map<string, Set<() => void>>();
  
  playImpl = vi.fn(async () => {
    this.paused = false;
  });
  pauseImpl = vi.fn(() => { this.paused = true; });
  loadImpl = vi.fn(() => { this.paused = true; this.readyState = 0; });

  constructor() { FakeAudio.instances.push(this); }
  
  currentTime = 0;

  addEventListener(
    type: string,
    listener: () => void,
    options?: AddEventListenerOptions | boolean
  ) {
    const signal = typeof options === "object" ? options.signal : undefined;
    if (signal?.aborted) return;
    const listeners = this.listeners.get(type) ?? new Set<() => void>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
    signal?.addEventListener("abort", () => listeners.delete(listener), { once: true });
  }

  removeEventListener(type: string, listener: () => void) {
    this.listeners.get(type)?.delete(listener);
  }

  listenerCount(type: string) {
    return this.listeners.get(type)?.size ?? 0;
  }

  listenersFor(type: string) {
    return [...(this.listeners.get(type) ?? [])];
  }

  async play() {
    this.ended = false;
    return this.playImpl();
  }

  pause() { this.pauseImpl(); }

  load() {
    this.loadImpl();
  }

  emit(type: string) {
    this.listeners.get(type)?.forEach((l) => l());
  }
}

class FakeMediaSession {
  playbackState = "none";
  handlers = new Map<MediaSessionAction, MediaSessionActionHandler | null>();
  setActionHandler = vi.fn((action: MediaSessionAction, handler: MediaSessionActionHandler | null) => {
    this.handlers.set(action, handler);
  });

  invoke(action: MediaSessionAction) {
    this.handlers.get(action)?.({ action } as MediaSessionActionDetails);
  }
}

function Harness() {
  const { currentEpisode, playing, playbackError, playAudiobookTrack, playQueueItem, playToggle, queue } = usePlayback();
  return (
    <div>
      <div data-testid="queue-size">{queue.length}</div>
      <div data-testid="episode">{currentEpisode?.trackId ?? currentEpisode?.id}</div>
      <div data-testid="playing">{playing ? "true" : "false"}</div>
      <div data-testid="error">{playbackError || "none"}</div>
      <button onClick={() => playQueueItem(queue[0]!)}>Play Book</button>
      <button onClick={() => playAudiobookTrack(1, bookTracks[0]!)}>Play Book Track 1</button>
      <button onClick={() => playAudiobookTrack(1, bookTracks[1]!)}>Play Book Track 2</button>
      <button onClick={playToggle}>Toggle Play</button>
    </div>
  );
}

const bookTracks: AudiobookTrack[] = [
  { id: 1, audiobookId: 1, title: "Chapter 1", relPath: "01.mp3", filePath: "/books/01.mp3", trackNumber: 1, duration: 1800, isListened: false, positionSeconds: 0 },
  { id: 2, audiobookId: 1, title: "Chapter 2", relPath: "02.mp3", filePath: "/books/02.mp3", trackNumber: 2, duration: 1800, isListened: false, positionSeconds: 0 },
];

describe("PB-03 Auto-advance retry", () => {
  afterEach(() => vi.useRealTimers());

  beforeEach(() => {
    vi.restoreAllMocks();
    FakeAudio.instances = [];
    vi.stubGlobal("Audio", FakeAudio);
    vi.stubGlobal("MediaError", { MEDIA_ERR_ABORTED: 1, MEDIA_ERR_NETWORK: 2, MEDIA_ERR_DECODE: 3, MEDIA_ERR_SRC_NOT_SUPPORTED: 4 });
    Object.defineProperty(navigator, "mediaSession", { configurable: true, value: new FakeMediaSession() });
    
    vi.spyOn(api.settings, "get").mockResolvedValue({
      settings: { dailyRefreshTime: "03:00", playbackSpeed: "Speed 1.3x", audiobookPlaybackSpeed: "Speed 1x", proxyEnabled: false, proxyConfigured: false, appBuild: "test" }
    });

    let activePlayback: PlaybackState = {
      audiobookId: 1,
      trackId: 1,
      positionSeconds: 0,
      lastUpdated: new Date().toISOString()
    };
    
    const queueData: QueueEpisode[] = [
      { type: "audiobook", id: 1, audiobookId: 1, title: "Book", audioUrl: "/api/audiobooks/1/tracks/1/audio", duration: 1800, publishedAt: null, isListened: false, downloaded: false, trackId: 1, trackNumber: 1, podcastId: 0, podcastTitle: "Book", playback: null },
    ];

    vi.spyOn(api.playback, "queue").mockImplementation(async () => {
      const currentQueue = queueData.map((item) => ({ ...item }));
      currentQueue[0] = { ...currentQueue[0]!, trackId: activePlayback.trackId };
      return {
        queue: currentQueue,
        activePlayback
      };
    });
    vi.spyOn(api.playlist, "list").mockResolvedValue({ items: [] });
    vi.spyOn(api.podcasts, "list").mockResolvedValue({ podcasts: [] });
    vi.spyOn(api.audiobooks, "get").mockResolvedValue({
      audiobook: { id: 1, title: "Book", author: "Author", relPath: "book", hasCover: false, totalDuration: 3600, trackCount: 2, listenedCount: 0, isListened: false, positionSeconds: 0, createdAt: "2026-09-25T00:00:00Z", updatedAt: "2026-09-25T00:00:00Z", tracks: bookTracks },
    });
    
    vi.spyOn(api.playback, "get").mockImplementation(async () => ({ playback: activePlayback }));
    vi.spyOn(api.playback, "update").mockImplementation(async (payload) => ({
      playback: { audiobookId: payload.audiobookId, trackId: payload.trackId, positionSeconds: payload.positionSeconds, lastUpdated: new Date().toISOString() },
      nextTarget: payload.completed && payload.trackId === 1 ? { type: "audiobook", audiobookId: 1, trackId: 2 } : null,
      nextTrackId: payload.completed && payload.trackId === 1 ? 2 : null,
      nextEpisodeId: null,
    }));
    vi.spyOn(api.playback, "setActive").mockImplementation(async (args) => {
      if (typeof args === "number") {
        return { activePlayback: { episodeId: args, lastUpdated: new Date().toISOString() } };
      }
      activePlayback = { audiobookId: args.audiobookId, trackId: args.trackId, positionSeconds: 0, lastUpdated: new Date().toISOString() };
      return { activePlayback };
    });
  });

  const setupAndPlayEp1 = async () => {
    const { unmount } = render(<PlaybackProvider><Harness /></PlaybackProvider>);
    const user = userEvent.setup();
    await user.click(screen.getByText("Play Book"));
    await waitFor(() => expect(screen.getByTestId("episode")).toHaveTextContent("1"));
    
    const audio = FakeAudio.first;
    audio.readyState = 0;
    
    // Allow initial play to complete by emitting events
    await act(async () => {
      audio.readyState = 4;
      audio.emit("loadedmetadata");
      audio.emit("canplay");
    });
    
    await act(async () => { audio.emit("playing"); });
    expect(audio.paused).toBe(false);
    return { user, audio, unmount };
  };

  function createDeferred<T = void>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }

  it("rejects до metadata: retries playback when canplay is fired later", async () => {
    const { audio } = await setupAndPlayEp1();
    
    const attempt1 = createDeferred();
    const attempt2 = createDeferred();
    let playCount = 0;
    
    audio.playImpl = vi.fn(async () => {
      playCount++;
      await (playCount === 1 ? attempt1.promise : attempt2.promise);
      audio.paused = false;
    });
    
    await act(async () => { audio.emit("ended"); });
    await waitFor(() => expect(screen.getByTestId("episode")).toHaveTextContent("2"));
    
    expect(playCount).toBe(1);
    
    // Simulate source switch resets readyState
    audio.readyState = 0;
    await act(async () => { attempt1.reject(new DOMException("NotSupportedError", "NotSupportedError")); });
    
    await act(async () => {
      audio.readyState = 4;
      audio.emit("loadedmetadata");
      audio.emit("canplay");
    });
    
    await waitFor(() => expect(playCount).toBe(2));
    await act(async () => { attempt2.resolve(); });
    
    await waitFor(() => expect(screen.getByTestId("playing")).toHaveTextContent("true"));
    expect(audio.src).toContain("/tracks/2/audio");
    expect(audio.paused).toBe(false);
  });

  it("rejects после metadata: retries playback when canplay is fired", async () => {
    const { audio } = await setupAndPlayEp1();
    
    const attempt1 = createDeferred();
    const attempt2 = createDeferred();
    let playCount = 0;
    
    audio.playImpl = vi.fn(async () => {
      playCount++;
      await (playCount === 1 ? attempt1.promise : attempt2.promise);
      audio.paused = false;
    });
    
    await act(async () => { audio.emit("ended"); });
    await waitFor(() => expect(screen.getByTestId("episode")).toHaveTextContent("2"));
    
    expect(playCount).toBe(1);
    
    audio.readyState = 1;
    await act(async () => { audio.emit("loadedmetadata"); });
    
    await act(async () => { attempt1.reject(new DOMException("NotSupportedError", "NotSupportedError")); });
    
    audio.readyState = 4;
    await act(async () => { audio.emit("canplay"); });
    
    await waitFor(() => expect(playCount).toBe(2));
    await act(async () => { attempt2.resolve(); });
    
    await waitFor(() => expect(screen.getByTestId("playing")).toHaveTextContent("true"));
    expect(audio.src).toContain("/tracks/2/audio");
    expect(audio.paused).toBe(false);
  });

  it("rejects после canplay (готовность достигнута): retries immediately", async () => {
    const { audio } = await setupAndPlayEp1();
    
    const attempt1 = createDeferred();
    const attempt2 = createDeferred();
    let playCount = 0;
    
    audio.playImpl = vi.fn(async () => {
      playCount++;
      await (playCount === 1 ? attempt1.promise : attempt2.promise);
      audio.paused = false;
    });
    
    await act(async () => { audio.emit("ended"); });
    await waitFor(() => expect(screen.getByTestId("episode")).toHaveTextContent("2"));
    
    expect(playCount).toBe(1);
    
    // BOTH loadedmetadata AND canplay arrive during pending play()
    audio.readyState = 4;
    await act(async () => { audio.emit("loadedmetadata"); });
    await act(async () => { audio.emit("canplay"); });
    
    // NotSupportedError happens LATER
    await act(async () => { attempt1.reject(new DOMException("NotSupportedError", "NotSupportedError")); });
    
    // It should immediately retry because readyState >= 3
    await waitFor(() => expect(playCount).toBe(2));
    await act(async () => { attempt2.resolve(); });
    
    await waitFor(() => expect(screen.getByTestId("playing")).toHaveTextContent("true"));
    expect(audio.src).toContain("/tracks/2/audio");
    expect(audio.paused).toBe(false);
  });

  it("error без дальнейшего canplay: shows permanent error if not NotSupportedError", async () => {
    const { audio } = await setupAndPlayEp1();
    
    const attempt1 = createDeferred();
    audio.playImpl = vi.fn(() => attempt1.promise);
    
    await act(async () => { audio.emit("ended"); });
    await waitFor(() => expect(screen.getByTestId("episode")).toHaveTextContent("2"));
    
    audio.readyState = 0;
    await act(async () => { attempt1.reject(new DOMException("NotAllowedError", "NotAllowedError")); });
    
    await waitFor(() => expect(screen.getByTestId("error")).toHaveTextContent("NotAllowedError"));
    expect(screen.getByTestId("playing")).toHaveTextContent("false");
  });

  it("постоянный отказ с ограниченным числом попыток: fails after MAX_PLAY_ATTEMPTS", async () => {
    const { audio } = await setupAndPlayEp1();
    
    let playCount = 0;
    audio.playImpl = vi.fn(async () => {
      playCount++;
      throw new DOMException("NotSupportedError", "NotSupportedError");
    });
    
    await act(async () => { audio.emit("ended"); });
    await waitFor(() => expect(screen.getByTestId("episode")).toHaveTextContent("2"));
    
    audio.readyState = 0;
    await act(async () => { audio.emit("canplay"); });
    await act(async () => { audio.emit("canplay"); });
    await act(async () => { audio.emit("canplay"); });
    
    await waitFor(() => expect(screen.getByTestId("error")).toHaveTextContent("NotSupportedError: NotSupportedError"));
    expect(screen.getByTestId("playing")).toHaveTextContent("false");
    expect(playCount).toBe(3);
  });

  it("Pause во время загрузки: pauses immediately if intent changed", async () => {
    const { user, audio } = await setupAndPlayEp1();
    
    const attempt1 = createDeferred();
    let playCount = 0;
    let pauseCount = 0;
    
    audio.playImpl = vi.fn(async () => {
      playCount++;
      await attempt1.promise;
      audio.paused = false;
    });
    audio.pauseImpl = vi.fn(() => {
      pauseCount++;
      audio.paused = true;
    });
    
    await act(async () => { audio.emit("ended"); });
    await waitFor(() => expect(screen.getByTestId("episode")).toHaveTextContent("2"));
    
    expect(playCount).toBe(1); // Auto-advance triggered tryPlay
    audio.readyState = 0;
    
    // User clicks Pause while attempt1 is pending
    await user.click(screen.getByText("Toggle Play"));
    
    // Check that playing state is updated immediately
    expect(screen.getByTestId("playing")).toHaveTextContent("false");
    
    // The browser can emit playing before the pending play promise settles.
    await act(async () => { audio.emit("playing"); });
    await act(async () => { attempt1.resolve(); });
    
    // Wait for the onPlaying effect to run
    await waitFor(() => {
      expect(pauseCount).toBeGreaterThan(0);
      expect(audio.paused).toBe(true);
      expect(screen.getByTestId("playing")).toHaveTextContent("false");
    });
    
    // No new play attempts should be made
    expect(playCount).toBe(1);
  });

  it("MediaSession Pause during a pending Play prevents late playback", async () => {
    const { audio } = await setupAndPlayEp1();
    const pendingPlay = createDeferred();
    audio.playImpl = vi.fn(async () => {
      await pendingPlay.promise;
      audio.paused = false;
    });

    await act(async () => { audio.emit("ended"); });
    await waitFor(() => expect(audio.src).toContain("/tracks/2/audio"));
    expect(audio.playImpl).toHaveBeenCalledTimes(1);

    await act(async () => {
      (navigator.mediaSession as unknown as FakeMediaSession).invoke("pause");
      audio.readyState = 4;
      audio.emit("loadedmetadata");
      audio.emit("canplay");
    });
    await act(async () => { pendingPlay.resolve(); });

    expect(audio.playImpl).toHaveBeenCalledTimes(1);
    expect(audio.paused).toBe(true);
    expect(screen.getByTestId("playing")).toHaveTextContent("false");
  });

  it("поздний reject после переключения источника: ignores error from previous generation", async () => {
    const { user, audio } = await setupAndPlayEp1();
    
    const attempt1 = createDeferred();
    const attempt2 = createDeferred();
    let playCount = 0;
    
    audio.playImpl = vi.fn(async () => {
      playCount++;
      await (playCount === 1 ? attempt1.promise : attempt2.promise);
      audio.paused = false;
    });
    
    // Switch to track 2. This creates generation 2.
    await user.click(screen.getByText("Play Book Track 2"));
    
    audio.readyState = 4;
    await act(async () => {
      audio.emit("loadedmetadata");
      audio.emit("canplay");
    });
    
    // Track 2 play attempt is pending
    await waitFor(() => expect(playCount).toBe(1));
    expect(audio.src).toContain("/tracks/2/audio");
    
    // Switch back to track 1 while track 2 is pending
    await user.click(screen.getByText("Play Book Track 1"));
    
    audio.readyState = 4;
    await act(async () => {
      audio.emit("loadedmetadata");
      audio.emit("canplay");
    });
    
    // Track 1 play attempt is pending (generation 3)
    await waitFor(() => expect(playCount).toBe(2));
    expect(audio.src).toContain("/tracks/1/audio");
    
    // Old attempt (from Track 2) rejects
    await act(async () => {
      attempt1.reject(new DOMException("NotSupportedError", "NotSupportedError"));
    });
    
    // Should NOT trigger retry or error because it's from old generation
    expect(playCount).toBe(2);
    expect(screen.getByTestId("error")).toHaveTextContent("none");
  });

  it("отменяет retryListener и показывает ошибку при timeout", async () => {
    const { audio } = await setupAndPlayEp1();
    
    const attempt1 = createDeferred();
    audio.playImpl = vi.fn(async () => {
      await attempt1.promise;
    });
    
    // Wait for the track transition
    await act(async () => { audio.emit("ended"); });
    await waitFor(() => expect(screen.getByTestId("episode")).toHaveTextContent("2"));
    
    audio.readyState = 1;
    await act(async () => { audio.emit("loadedmetadata"); });
    vi.useFakeTimers();
    
    await act(async () => { attempt1.reject(new DOMException("NotSupportedError", "NotSupportedError")); });
    expect(audio.listenerCount("canplay")).toBe(1);
    const [retryListener] = audio.listenersFor("canplay");
    
    // Timeout happens without canplay
    await act(async () => { vi.advanceTimersByTime(5000); });
    
    vi.useRealTimers();
    
    await waitFor(() => {
      expect(screen.getByTestId("error")).toHaveTextContent("Timeout waiting for audio to become ready");
      expect(screen.getByTestId("playing")).toHaveTextContent("false");
    });
    expect(audio.listenersFor("canplay")).not.toContain(retryListener);
    const playCalls = audio.playImpl.mock.calls.length;
    await act(async () => { audio.readyState = 4; audio.emit("canplay"); });
    expect(audio.playImpl).toHaveBeenCalledTimes(playCalls);
  });

  it("does not call play twice when readiness follows a successful start", async () => {
    const { audio } = await setupAndPlayEp1();
    const before = audio.playImpl.mock.calls.length;

    await act(async () => { audio.emit("ended"); });
    await waitFor(() => expect(audio.src).toContain("/tracks/2/audio"));
    await waitFor(() => expect(audio.playImpl).toHaveBeenCalledTimes(before + 1));

    await act(async () => {
      audio.readyState = 4;
      audio.emit("loadedmetadata");
      audio.emit("canplay");
    });

    expect(audio.playImpl).toHaveBeenCalledTimes(before + 1);
    expect(audio.paused).toBe(false);
    expect(screen.getByTestId("error")).toHaveTextContent("none");
  });

  it("reports a media error before readiness without waiting for another canplay", async () => {
    const { audio } = await setupAndPlayEp1();
    const pendingPlay = createDeferred();
    audio.playImpl = vi.fn(() => pendingPlay.promise);

    await act(async () => { audio.emit("ended"); });
    await waitFor(() => expect(audio.src).toContain("/tracks/2/audio"));
    expect(audio.playImpl).toHaveBeenCalledTimes(1);

    audio.error = { code: MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED, message: "unsupported" } as MediaError;
    await act(async () => { audio.emit("error"); });
    expect(screen.getByTestId("error")).toHaveTextContent("Audio source is not supported.");
    expect(screen.getByTestId("playing")).toHaveTextContent("false");

    await act(async () => { pendingPlay.reject(new DOMException("unsupported", "NotSupportedError")); });
    expect(audio.playImpl).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("error")).toHaveTextContent("Audio source is not supported.");
  });

  it("keeps a passive media error quiet before the user starts playback", async () => {
    render(<PlaybackProvider><Harness /></PlaybackProvider>);
    await waitFor(() => expect(screen.getByTestId("queue-size")).toHaveTextContent("1"));
    const audio = FakeAudio.first;
    audio.error = { code: MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED, message: "unsupported" } as MediaError;

    await act(async () => { audio.emit("error"); });
    expect(screen.getByTestId("error")).toHaveTextContent("none");
    expect(audio.playImpl).not.toHaveBeenCalled();
  });

  it("removes a pending retry when the user selects another chapter", async () => {
    const { user, audio } = await setupAndPlayEp1();
    const firstPlay = createDeferred();
    const nextPlay = createDeferred();
    let calls = 0;
    audio.playImpl = vi.fn(async () => {
      calls += 1;
      await (calls === 1 ? firstPlay.promise : nextPlay.promise);
      audio.paused = false;
    });

    await act(async () => { audio.emit("ended"); });
    await waitFor(() => expect(audio.src).toContain("/tracks/2/audio"));
    expect(calls).toBe(1);
    audio.readyState = 1;
    await act(async () => { audio.emit("loadedmetadata"); });
    await act(async () => { firstPlay.reject(new DOMException("unsupported", "NotSupportedError")); });
    const [oldRetry] = audio.listenersFor("canplay");
    expect(oldRetry).toBeDefined();

    await user.click(screen.getByText("Play Book Track 1"));
    await waitFor(() => expect(audio.src).toContain("/tracks/1/audio"));
    expect(audio.listenersFor("canplay")).not.toContain(oldRetry);

    await act(async () => { audio.readyState = 4; audio.emit("loadedmetadata"); audio.emit("canplay"); });
    await waitFor(() => expect(calls).toBe(2));
    await act(async () => { nextPlay.resolve(); });
    expect(audio.src).toContain("/tracks/1/audio");
    expect(audio.paused).toBe(false);
    expect(screen.getByTestId("error")).toHaveTextContent("none");
  });

  it("removes a pending retry on unmount", async () => {
    const { audio, unmount } = await setupAndPlayEp1();
    const pendingPlay = createDeferred();
    audio.playImpl = vi.fn(() => pendingPlay.promise);

    await act(async () => { audio.emit("ended"); });
    await waitFor(() => expect(audio.src).toContain("/tracks/2/audio"));
    audio.readyState = 1;
    await act(async () => { audio.emit("loadedmetadata"); });
    await act(async () => { pendingPlay.reject(new DOMException("unsupported", "NotSupportedError")); });
    expect(audio.listenerCount("canplay")).toBe(1);

    unmount();
    expect(audio.listenerCount("canplay")).toBe(0);
    await act(async () => { audio.readyState = 4; audio.emit("canplay"); });
    expect(audio.playImpl).toHaveBeenCalledTimes(1);
  });
});
