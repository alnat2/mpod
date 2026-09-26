import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  api,
  type AudiobookTrack,
  type PlaybackQueueEpisode,
  type PlaybackQueueResponse,
  type PlaybackUpdateResponse,
} from "./api";
import { PlaybackProvider, usePlayback } from "./playback-context";
import { queueItemKey } from "./playback-queue";

class FakeAudio {
  static instances: FakeAudio[] = [];

  static get first(): FakeAudio | undefined {
    return FakeAudio.instances[0];
  }

  private srcValue = "";
  get src() {
    return this.srcValue;
  }
  set src(value: string) {
    this.srcValue = value;
    this.duration = 0;
  }
  get currentSrc() {
    return this.srcValue;
  }

  currentTime = 0;
  duration = 0;
  readyState = 0;
  playbackRate = 1;
  paused = true;
  ended = false;
  seeking = false;
  error: MediaError | null = null;

  private listeners = new Map<string, Set<() => void>>();
  playImpl = vi.fn(async () => {
    this.paused = false;
  });
  pauseImpl = vi.fn(() => {
    this.paused = true;
  });
  loadImpl = vi.fn(() => {
    this.currentTime = 0;
    this.paused = true;
  });

  constructor() {
    FakeAudio.instances.push(this);
  }

  addEventListener(type: string, listener: () => void) {
    const listeners = this.listeners.get(type) ?? new Set<() => void>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
    // Explicit control: no automatic listener invocation on registration
  }

  removeEventListener(type: string, listener: () => void) {
    this.listeners.get(type)?.delete(listener);
  }

  emit(type: string) {
    const listeners = this.listeners.get(type);
    if (!listeners) return;
    for (const listener of Array.from(listeners)) {
      listener();
    }
  }

  emitLoadedMetadata(duration = 100) {
    this.duration = duration;
    this.readyState = 1;
    this.emit("loadedmetadata");
    this.emit("durationchange");
  }

  emitCanPlay() {
    this.readyState = 4;
    this.emit("canplay");
  }

  async play() {
    this.ended = false;
    const res = await this.playImpl();
    this.emit("play");
    this.emit("playing");
    return res;
  }

  pause() {
    this.pauseImpl();
    this.emit("pause");
  }

  load() {
    this.loadImpl();
    // Explicit control: no automatic event emission on load
  }
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const bookTracks: AudiobookTrack[] = [
  {
    id: 1,
    audiobookId: 101,
    title: "Chapter 1",
    relPath: "01.mp3",
    filePath: "/abooks/book/01.mp3",
    trackNumber: 1,
    duration: 100,
    isListened: false,
    positionSeconds: 0,
  },
  {
    id: 2,
    audiobookId: 101,
    title: "Chapter 2",
    relPath: "02.mp3",
    filePath: "/abooks/book/02.mp3",
    trackNumber: 2,
    duration: 200,
    isListened: false,
    positionSeconds: 0,
  },
  {
    id: 3,
    audiobookId: 101,
    title: "Chapter 3",
    relPath: "03.mp3",
    filePath: "/abooks/book/03.mp3",
    trackNumber: 3,
    duration: 300,
    isListened: false,
    positionSeconds: 0,
  },
  {
    id: 5,
    audiobookId: 101,
    title: "Chapter 5",
    relPath: "05.mp3",
    filePath: "/abooks/book/05.mp3",
    trackNumber: 5,
    duration: 500,
    isListened: false,
    positionSeconds: 0,
  },
];

const initialAudiobookItem: PlaybackQueueEpisode = {
  id: 101,
  podcastId: 0,
  title: "Jack Reacher 24",
  description: null,
  showNotes: null,
  audioUrl: "/api/audiobooks/101/tracks/1/audio",
  duration: 100,
  downloaded: true,
  isListened: false,
  publishedAt: null,
  type: "audiobook",
  audiobookId: 101,
  trackId: 1,
  trackNumber: 1,
  trackCount: 4,
  totalTrackCount: 4,
  hasChapters: true,
  author: "Lee Child",
  podcastTitle: "Lee Child",
  playback: {
    audiobookId: 101,
    trackId: 1,
    positionSeconds: 0,
    lastUpdated: "2026-09-24T10:00:00Z",
  },
};

const podcastEpisodeC: PlaybackQueueEpisode = {
  id: 99,
  podcastId: 10,
  title: "Podcast Episode C",
  description: "Test description",
  showNotes: null,
  audioUrl: "/api/episodes/99/audio",
  duration: 900,
  downloaded: true,
  isListened: false,
  publishedAt: "2026-09-24T09:00:00Z",
  type: "episode",
  podcastTitle: "Tech News Daily",
  playback: {
    episodeId: 99,
    positionSeconds: 0,
    lastUpdated: "2026-09-24T10:00:00Z",
  },
};

const otherAudiobookItemC: PlaybackQueueEpisode = {
  id: 202,
  podcastId: 0,
  title: "The Martian",
  description: null,
  showNotes: null,
  audioUrl: "/api/audiobooks/202/tracks/1/audio",
  duration: 1500,
  downloaded: true,
  isListened: false,
  publishedAt: null,
  type: "audiobook",
  audiobookId: 202,
  trackId: 1,
  trackNumber: 1,
  trackCount: 1,
  totalTrackCount: 1,
  hasChapters: true,
  author: "Andy Weir",
  podcastTitle: "Andy Weir",
  playback: {
    audiobookId: 202,
    trackId: 1,
    positionSeconds: 0,
    lastUpdated: "2026-09-24T10:00:00Z",
  },
};

function TestHarness() {
  const {
    currentEpisode,
    queue,
    loading,
    playing,
    playToggle,
    playEpisode,
    playAudiobookTrack,
  } = usePlayback();

  return (
    <div>
      <div data-testid="loading">{loading ? "yes" : "no"}</div>
      <div data-testid="current-track">{currentEpisode?.trackId ?? "none"}</div>
      <div data-testid="current-key">{currentEpisode ? queueItemKey(currentEpisode) : "none"}</div>
      <div data-testid="current-src">{currentEpisode?.audioUrl ?? "none"}</div>
      <div data-testid="playing">{playing ? "yes" : "no"}</div>
      <div data-testid="queue-count">{queue.length}</div>
      <div data-testid="queue-keys">{queue.map((item) => queueItemKey(item)).join(",")}</div>
      <button type="button" onClick={playToggle}>
        Toggle Play
      </button>
      <button
        type="button"
        onClick={() => {
          const track5 = bookTracks.find((t) => t.id === 5);
          if (track5) {
            void playAudiobookTrack(101, track5);
          }
        }}
      >
        Play Chapter 5
      </button>
      <button
        type="button"
        onClick={() => {
          playEpisode(99);
        }}
      >
        Play Episode C
      </button>
      <button
        type="button"
        onClick={() => {
          const track1 = {
            id: 1,
            audiobookId: 202,
            title: "Track 1",
            relPath: "01.mp3",
            filePath: "/abooks/martian/01.mp3",
            trackNumber: 1,
            duration: 1500,
            isListened: false,
            positionSeconds: 0,
          };
          void playAudiobookTrack(202, track1);
        }}
      >
        Play Other Book C
      </button>
    </div>
  );
}

describe("PB-02: Completion lock and selected track protection", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    FakeAudio.instances = [];
    vi.stubGlobal("Audio", FakeAudio);

    Object.defineProperty(navigator, "mediaSession", {
      configurable: true,
      value: { setActionHandler: vi.fn(), playbackState: "none" },
    });

    vi.spyOn(api.playlist, "list").mockResolvedValue({ items: [] });
    vi.spyOn(api.podcasts, "list").mockResolvedValue({ podcasts: [] });
    vi.spyOn(api.playback, "queue").mockResolvedValue({
      queue: [initialAudiobookItem],
      activePlayback: {
        audiobookId: 101,
        trackId: 1,
        lastUpdated: "2026-09-24T10:00:00Z",
      },
    });
    vi.spyOn(api.audiobooks, "get").mockImplementation(async (id: number) => {
      if (id === 202) {
        return {
          audiobook: {
            id: 202,
            title: "The Martian",
            author: "Andy Weir",
            relPath: "martian",
            hasCover: false,
            totalDuration: 1500,
            trackCount: 1,
            listenedCount: 0,
            isListened: false,
            positionSeconds: 0,
            createdAt: "2026-09-24T10:00:00Z",
            updatedAt: "2026-09-24T10:00:00Z",
            tracks: [
              {
                id: 1,
                audiobookId: 202,
                title: "Track 1",
                relPath: "01.mp3",
                filePath: "/abooks/martian/01.mp3",
                trackNumber: 1,
                duration: 1500,
                isListened: false,
                positionSeconds: 0,
              },
            ],
          },
        };
      }
      return {
        audiobook: {
          id: 101,
          title: "Jack Reacher 24",
          author: "Lee Child",
          relPath: "book",
          hasCover: false,
          totalDuration: 1100,
          trackCount: 4,
          listenedCount: 0,
          isListened: false,
          positionSeconds: 0,
          createdAt: "2026-09-24T10:00:00Z",
          updatedAt: "2026-09-24T10:00:00Z",
          tracks: bookTracks,
        },
      };
    });
    vi.spyOn(api.playback, "setActive").mockResolvedValue({
      activePlayback: {
        audiobookId: 101,
        trackId: 1,
        lastUpdated: "2026-09-24T10:00:00Z",
      },
    });
    vi.spyOn(api.playback, "get").mockResolvedValue({ playback: null });
    vi.spyOn(api.settings, "get").mockResolvedValue({
      settings: {
        dailyRefreshTime: "03:00",
        playbackSpeed: "Speed 1x",
        proxyEnabled: false,
        proxyConfigured: false,
        appBuild: "test",
      },
    });
  });

  it("1. Completion A pending; B of same book starts. Pause then Resume B calls play for B without waiting for A", async () => {
    const completionADeferred = deferred<PlaybackUpdateResponse>();
    const updateSpy = vi
      .spyOn(api.playback, "update")
      .mockImplementation(async (payload) => {
        if (payload.completed && payload.trackId === 1) {
          return completionADeferred.promise;
        }
        return {
          playback: {
            audiobookId: 101,
            trackId: payload.trackId ?? 1,
            positionSeconds: payload.positionSeconds,
            lastUpdated: new Date().toISOString(),
          },
          nextEpisodeId: null,
        };
      });

    render(
      <PlaybackProvider>
        <TestHarness />
      </PlaybackProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("loading")).toHaveTextContent("no");
    });

    const user = userEvent.setup();
    const playToggleBtn = screen.getByRole("button", { name: "Toggle Play" });

    // Start Chapter 1 (A)
    await user.click(playToggleBtn);
    const audio = FakeAudio.first!;
    expect(audio.src).toContain("/api/audiobooks/101/tracks/1/audio");

    // Metadata loads and Chapter 1 plays
    await act(async () => {
      audio.emitLoadedMetadata(100);
      audio.emitCanPlay();
    });

    await waitFor(() => {
      expect(screen.getByTestId("playing")).toHaveTextContent("yes");
      expect(audio.paused).toBe(false);
    });

    // Chapter 1 (A) ends: trigger ended
    await act(async () => {
      audio.emit("ended");
    });

    // Auto-advance synchronously starts Chapter 2 (B) of the same book
    await waitFor(() => {
      expect(audio.src).toContain("/api/audiobooks/101/tracks/2/audio");
      expect(screen.getByTestId("current-track")).toHaveTextContent("2");
    });

    // Provide metadata for Chapter 2
    await act(async () => {
      audio.emitLoadedMetadata(200);
      audio.emitCanPlay();
    });

    // Verify completion A was sent and is pending
    const completionACall = updateSpy.mock.calls.find(
      (call) => call[0].completed === true && call[0].trackId === 1
    );
    expect(completionACall).toBeDefined();

    // Chapter 2 is playing
    await waitFor(() => {
      expect(audio.paused).toBe(false);
    });

    // Record play calls before pause
    const playCallsBefore = audio.playImpl.mock.calls.length;

    // User Pauses Chapter 2
    await user.click(playToggleBtn);
    expect(audio.pauseImpl).toHaveBeenCalled();
    expect(audio.paused).toBe(true);

    // User Resumes Chapter 2 while completion A is STILL pending
    await user.click(playToggleBtn);

    // Chapter 2 MUST have called playImpl again and resumed
    expect(audio.playImpl.mock.calls.length).toBeGreaterThan(playCallsBefore);
    expect(audio.paused).toBe(false);
  });

  it("2. Completion A responded, queue request for A is pending. Pause/Resume B works", async () => {
    const queueRequestDeferred = deferred<PlaybackQueueResponse>();
    let queueCallsCount = 0;

    vi.spyOn(api.playback, "queue").mockImplementation(async () => {
      queueCallsCount++;
      if (queueCallsCount === 1) {
        return {
          queue: [initialAudiobookItem],
          activePlayback: {
            audiobookId: 101,
            trackId: 1,
            lastUpdated: "2026-09-24T10:00:00Z",
          },
        };
      }
      return queueRequestDeferred.promise;
    });

    vi.spyOn(api.playback, "update").mockResolvedValue({
      playback: {
        audiobookId: 101,
        trackId: 1,
        positionSeconds: 100,
        lastUpdated: new Date().toISOString(),
      },
      nextTrackId: 2,
      nextEpisodeId: null,
    });

    render(
      <PlaybackProvider>
        <TestHarness />
      </PlaybackProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("loading")).toHaveTextContent("no");
    });

    const user = userEvent.setup();
    const playToggleBtn = screen.getByRole("button", { name: "Toggle Play" });

    // Start Chapter 1 (A)
    await user.click(playToggleBtn);
    const audio = FakeAudio.first!;
    await act(async () => {
      audio.emitLoadedMetadata(100);
      audio.emitCanPlay();
    });

    await waitFor(() => {
      expect(audio.paused).toBe(false);
    });

    // Chapter 1 (A) ends
    await act(async () => {
      audio.emit("ended");
    });

    // Auto-advance to Chapter 2 (B)
    await waitFor(() => {
      expect(audio.src).toContain("/api/audiobooks/101/tracks/2/audio");
      expect(screen.getByTestId("current-track")).toHaveTextContent("2");
    });

    await act(async () => {
      audio.emitLoadedMetadata(200);
      audio.emitCanPlay();
    });

    // Wait until completion A resolves and triggers loadQueue
    await waitFor(() => {
      expect(queueCallsCount).toBeGreaterThanOrEqual(2);
    });

    // queueRequestDeferred is STILL pending!
    // User pauses B
    const playCallsBefore = audio.playImpl.mock.calls.length;
    await user.click(playToggleBtn);
    expect(audio.paused).toBe(true);

    // User resumes B
    await user.click(playToggleBtn);
    expect(audio.playImpl.mock.calls.length).toBeGreaterThan(playCallsBefore);
    expect(audio.paused).toBe(false);
  });

  it("3. Completion B started before finally A. Finally A does not wipe B's lock; duplicate completion B is not sent", async () => {
    // Scenario:
    //   - A (ch1) ends → B (ch2, last chapter of 2-track book) auto-starts
    //   - B ends → completionGenerationRef = gen_B, playing=false (no auto-advance: last chapter)
    //   - A's completion resolves + queue A resolves → A's finally runs
    //   - ASSERT: B's lock still held → playToggle blocked specifically by lock B (gen_B)
    //   - ASSERT: second ended event on same src is discarded → no duplicate completion B
    //   - SENSITIVITY: if finally A erroneously set completionGenerationRef = null,
    //     playToggle would NOT be blocked and the assertions below would fail.

    // Use a 2-track book so Chapter 2 (B) is the last — no synchronous auto-advance after B ends.
    const twoTrackBookTracks: AudiobookTrack[] = [
      {
        id: 1,
        audiobookId: 101,
        title: "Chapter 1",
        relPath: "01.mp3",
        filePath: "/abooks/book/01.mp3",
        trackNumber: 1,
        duration: 100,
        isListened: false,
        positionSeconds: 0,
      },
      {
        id: 2,
        audiobookId: 101,
        title: "Chapter 2",
        relPath: "02.mp3",
        filePath: "/abooks/book/02.mp3",
        trackNumber: 2,
        duration: 200,
        isListened: false,
        positionSeconds: 0,
      },
    ];

    const completionADeferred = deferred<PlaybackUpdateResponse>();
    const queueADeferred = deferred<PlaybackQueueResponse>();
    const completionBDeferred = deferred<PlaybackUpdateResponse>();
    let queueCallsCount = 0;

    // Override audiobooks mock with 2-track book for this test only
    vi.spyOn(api.audiobooks, "get").mockImplementation(async (id: number) => ({
      audiobook: {
        id,
        title: "Jack Reacher 2-Track",
        author: "Lee Child",
        relPath: "book",
        hasCover: false,
        totalDuration: 300,
        trackCount: 2,
        listenedCount: 0,
        isListened: false,
        positionSeconds: 0,
        createdAt: "2026-09-24T10:00:00Z",
        updatedAt: "2026-09-24T10:00:00Z",
        tracks: twoTrackBookTracks,
      },
    }));

    vi.spyOn(api.playback, "queue").mockImplementation(async () => {
      queueCallsCount++;
      if (queueCallsCount === 1) {
        return {
          queue: [initialAudiobookItem],
          activePlayback: {
            audiobookId: 101,
            trackId: 1,
            lastUpdated: "2026-09-24T10:00:00Z",
          },
        };
      }
      return queueADeferred.promise;
    });

    const updateSpy = vi
      .spyOn(api.playback, "update")
      .mockImplementation(async (payload) => {
        if (payload.completed && payload.trackId === 1) {
          return completionADeferred.promise;
        }
        if (payload.completed && payload.trackId === 2) {
          return completionBDeferred.promise;
        }
        return {
          playback: {
            audiobookId: 101,
            trackId: payload.trackId ?? 1,
            positionSeconds: payload.positionSeconds,
            lastUpdated: new Date().toISOString(),
          },
          nextEpisodeId: null,
        };
      });

    render(
      <PlaybackProvider>
        <TestHarness />
      </PlaybackProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("loading")).toHaveTextContent("no");
    });

    const user = userEvent.setup();
    const playToggleBtn = screen.getByRole("button", { name: "Toggle Play" });

    // Start Chapter 1 (A)
    await user.click(playToggleBtn);
    const audio = FakeAudio.first!;
    await act(async () => {
      audio.emitLoadedMetadata(100);
      audio.emitCanPlay();
    });

    await waitFor(() => {
      expect(screen.getByTestId("playing")).toHaveTextContent("yes");
    });

    // Chapter 1 (A) ends → synchronous auto-advance to Chapter 2 (B)
    await act(async () => {
      audio.emit("ended");
    });

    // Chapter 2 (B) starts — completion A is sent but still pending
    await waitFor(() => {
      expect(audio.src).toContain("/api/audiobooks/101/tracks/2/audio");
      expect(screen.getByTestId("current-track")).toHaveTextContent("2");
    });

    const completionACalls = updateSpy.mock.calls.filter(
      (c) => c[0].completed === true && c[0].trackId === 1
    );
    expect(completionACalls.length).toBe(1); // completion A sent

    await act(async () => {
      audio.emitLoadedMetadata(200);
      audio.emitCanPlay();
    });

    await waitFor(() => {
      expect(audio.paused).toBe(false); // B is playing
    });

    // Chapter 2 (B) ends — it's the LAST chapter, so no synchronous auto-advance.
    // completionGenerationRef is set to gen_B; playing = false.
    await act(async () => {
      audio.emit("ended");
    });

    // Verify: completion B was sent exactly once
    const completionBCallsAfterEnded = updateSpy.mock.calls.filter(
      (c) => c[0].completed === true && c[0].trackId === 2
    );
    expect(completionBCallsAfterEnded.length).toBe(1);

    // Verify: B's lock is held — Resume (playToggle) MUST be blocked right now
    // because gen_B === sourceGenerationRef.current
    {
      const playCallsBefore = audio.playImpl.mock.calls.length;
      await user.click(playToggleBtn);
      // SENSITIVITY: if finally A had already run and erroneously cleared B's lock,
      // playToggle would reach audio.play() → playImpl would increase → assertion fails.
      expect(audio.playImpl.mock.calls.length).toBe(playCallsBefore);
      expect(
        screen.getByTestId("playing")
      ).toHaveTextContent("no");
    }

    // Now resolve completion A and its stale queue request → A's finally runs.
    await act(async () => {
      completionADeferred.resolve({
        playback: {
          audiobookId: 101,
          trackId: 1,
          positionSeconds: 100,
          lastUpdated: new Date().toISOString(),
        },
        nextTrackId: 2,
        nextEpisodeId: null,
      });
    });

    await waitFor(() => {
      expect(queueCallsCount).toBeGreaterThanOrEqual(2);
    });

    await act(async () => {
      queueADeferred.resolve({
        queue: [initialAudiobookItem],
        activePlayback: {
          audiobookId: 101,
          trackId: 2,
          lastUpdated: new Date().toISOString(),
        },
      });
    });

    // At this point A's finally has executed.
    // The critical assertion: B's lock is STILL held after finally A.
    // gen_A ≠ gen_B so finally A's guard `completionGenerationRef.current === completionGeneration_A`
    // is FALSE → it must NOT clear completionGenerationRef.

    // Verify: playToggle is still blocked by B's lock (not by A's, not by stale state)
    {
      const playCallsBefore = audio.playImpl.mock.calls.length;
      await user.click(playToggleBtn);
      // SENSITIVITY: if finally A had cleared B's lock, playToggle would proceed to
      // audio.play() here → this assertion would fail, catching the regression.
      expect(audio.playImpl.mock.calls.length).toBe(playCallsBefore);
      expect(
        screen.getByTestId("playing")
      ).toHaveTextContent("no");
    }

    // Verify: an additional ended event on the same (now paused/ended) source
    // does NOT produce a second completion B request.
    await act(async () => {
      audio.emit("ended");
    });
    const completionBCallsAfterFinallyA = updateSpy.mock.calls.filter(
      (c) => c[0].completed === true && c[0].trackId === 2
    );
    expect(completionBCallsAfterFinallyA.length).toBe(1); // still exactly 1

    // Resolve completion B → B's lock is released
    await act(async () => {
      completionBDeferred.resolve({
        playback: {
          audiobookId: 101,
          trackId: 2,
          positionSeconds: 200,
          lastUpdated: new Date().toISOString(),
        },
        nextEpisodeId: null,
        nextTrackId: null,
      });
    });

    // After lock release: completionGenerationRef should be null.
    // playToggle should now be allowed (lock is cleared, user can replay).
    await waitFor(() => {
      // The lock has been released; no new completion B should be sent
      const finalCompletionBCalls = updateSpy.mock.calls.filter(
        (c) => c[0].completed === true && c[0].trackId === 2
      );
      expect(finalCompletionBCalls.length).toBe(1);
    });
  });

  it("4. Repeated timeupdate/pause/ended of same completed source emit only one completion. Ended event of active B is not a duplicate of A", async () => {
    const updateSpy = vi.spyOn(api.playback, "update").mockResolvedValue({
      playback: {
        audiobookId: 101,
        trackId: 1,
        positionSeconds: 100,
        lastUpdated: new Date().toISOString(),
      },
      nextTrackId: 2,
      nextEpisodeId: null,
    });

    render(
      <PlaybackProvider>
        <TestHarness />
      </PlaybackProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("loading")).toHaveTextContent("no");
    });

    const user = userEvent.setup();
    const playToggleBtn = screen.getByRole("button", { name: "Toggle Play" });

    // Start Chapter 1 (A)
    await user.click(playToggleBtn);
    const audio = FakeAudio.first!;
    await act(async () => {
      audio.emitLoadedMetadata(100);
      audio.emitCanPlay();
    });

    await waitFor(() => {
      expect(screen.getByTestId("playing")).toHaveTextContent("yes");
    });

    // Chapter 1 (A) finishes
    await act(async () => {
      audio.emit("ended");
      audio.emit("timeupdate");
      audio.emit("pause");
    });

    const completionsForA = updateSpy.mock.calls.filter(
      (c) => c[0].completed === true && c[0].trackId === 1
    );
    expect(completionsForA.length).toBe(1);

    // Auto-advance moved to Chapter 2 (B)
    await waitFor(() => {
      expect(audio.src).toContain("/api/audiobooks/101/tracks/2/audio");
      expect(screen.getByTestId("current-track")).toHaveTextContent("2");
    });

    await act(async () => {
      audio.emitLoadedMetadata(200);
      audio.emitCanPlay();
    });

    await waitFor(() => {
      expect(screen.getByTestId("playing")).toHaveTextContent("yes");
      expect(audio.paused).toBe(false);
    });

    // When Chapter 2 (B) naturally ends, its ended event MUST trigger completion for B
    await act(async () => {
      audio.emit("ended");
      audio.emit("timeupdate");
    });

    const completionsForB = updateSpy.mock.calls.filter(
      (c) => c[0].completed === true && c[0].trackId === 2
    );
    expect(completionsForB.length).toBe(1);

    const totalCompletions = updateSpy.mock.calls.filter(
      (c) => c[0].completed === true
    );
    expect(totalCompletions.length).toBe(2);
  });

  it("5. Without chapter cache, A completes and server indicates B: trackId, queue, and audio.src point to B with aligned position", async () => {
    // Clear chapter cache in audiobooks.get so synchronous auto-advance cannot happen
    vi.spyOn(api.audiobooks, "get").mockResolvedValue({
      audiobook: {
        id: 101,
        title: "Jack Reacher 24",
        author: "Lee Child",
        relPath: "book",
        hasCover: false,
        totalDuration: 1100,
        trackCount: 4,
        listenedCount: 0,
        isListened: false,
        positionSeconds: 0,
        createdAt: "2026-09-24T10:00:00Z",
        updatedAt: "2026-09-24T10:00:00Z",
        tracks: [], // Empty cache
      },
    });

    const completionDeferred = deferred<PlaybackUpdateResponse>();
    vi.spyOn(api.playback, "update").mockImplementation(async (payload) => {
      if (payload.completed) {
        return completionDeferred.promise;
      }
      return {
        playback: {
          audiobookId: 101,
          trackId: payload.trackId ?? 1,
          positionSeconds: payload.positionSeconds,
          lastUpdated: new Date().toISOString(),
        },
        nextEpisodeId: null,
      };
    });

    render(
      <PlaybackProvider>
        <TestHarness />
      </PlaybackProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("loading")).toHaveTextContent("no");
    });

    const user = userEvent.setup();
    const playToggleBtn = screen.getByRole("button", { name: "Toggle Play" });

    // Start Chapter 1 (A)
    await user.click(playToggleBtn);
    const audio = FakeAudio.first!;
    await act(async () => {
      audio.emitLoadedMetadata(100);
      audio.emitCanPlay();
    });

    // Chapter 1 (A) ends
    await act(async () => {
      audio.emit("ended");
    });

    // Because chapter cache is empty, playback awaits server response
    // Server now responds with nextTarget pointing to Chapter 2 (B)
    await act(async () => {
      completionDeferred.resolve({
        playback: {
          audiobookId: 101,
          trackId: 1,
          positionSeconds: 100,
          lastUpdated: new Date().toISOString(),
        },
        nextTarget: {
          type: "audiobook",
          audiobookId: 101,
          trackId: 2,
        },
        nextTrackId: 2,
        nextEpisodeId: null,
      });
    });

    // Transition to Chapter 2 occurs:
    await waitFor(() => {
      expect(screen.getByTestId("current-track")).toHaveTextContent("2");
      expect(audio.src).toContain("/api/audiobooks/101/tracks/2/audio");
    });

    await act(async () => {
      audio.emitLoadedMetadata(200);
      audio.emitCanPlay();
    });

    // UI and state are fully aligned on B:
    expect(screen.getByTestId("current-track")).toHaveTextContent("2");
    expect(audio.src).toContain("/api/audiobooks/101/tracks/2/audio");
    expect(audio.currentTime).toBe(0);
    expect(audio.paused).toBe(false);
  });

  it("6. During async fallback/loadQueue, user chooses C: late response without next target does not stop C or apply B", async () => {
    // Empty chapter cache forces async completion path
    vi.spyOn(api.audiobooks, "get").mockResolvedValue({
      audiobook: {
        id: 101,
        title: "Jack Reacher 24",
        author: "Lee Child",
        relPath: "book",
        hasCover: false,
        totalDuration: 1100,
        trackCount: 4,
        listenedCount: 0,
        isListened: false,
        positionSeconds: 0,
        createdAt: "2026-09-24T10:00:00Z",
        updatedAt: "2026-09-24T10:00:00Z",
        tracks: [],
      },
    });

    const completionDeferred = deferred<PlaybackUpdateResponse>();
    const queueDeferred = deferred<PlaybackQueueResponse>();
    let queueCallsCount = 0;

    vi.spyOn(api.playback, "queue").mockImplementation(async () => {
      queueCallsCount++;
      if (queueCallsCount === 1) {
        return {
          queue: [initialAudiobookItem, podcastEpisodeC],
          activePlayback: {
            audiobookId: 101,
            trackId: 1,
            lastUpdated: "2026-09-24T10:00:00Z",
          },
        };
      }
      return queueDeferred.promise;
    });

    vi.spyOn(api.playback, "update").mockImplementation(async (payload) => {
      if (payload.completed) {
        return completionDeferred.promise;
      }
      return {
        playback: {
          audiobookId: payload.audiobookId,
          episodeId: payload.episodeId,
          trackId: payload.trackId,
          positionSeconds: payload.positionSeconds,
          lastUpdated: new Date().toISOString(),
        },
        nextEpisodeId: null,
      };
    });

    render(
      <PlaybackProvider>
        <TestHarness />
      </PlaybackProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("loading")).toHaveTextContent("no");
    });

    const user = userEvent.setup();
    const playToggleBtn = screen.getByRole("button", { name: "Toggle Play" });

    // Start Chapter 1 (A)
    await user.click(playToggleBtn);
    const audio = FakeAudio.first!;
    await act(async () => {
      audio.emitLoadedMetadata(100);
      audio.emitCanPlay();
    });

    // Chapter 1 ends
    await act(async () => {
      audio.emit("ended");
    });

    // Completion request arrives with NO next target (e.g. final item)
    await act(async () => {
      completionDeferred.resolve({
        playback: {
          audiobookId: 101,
          trackId: 1,
          positionSeconds: 100,
          lastUpdated: new Date().toISOString(),
        },
        nextTarget: null,
        nextEpisodeId: null,
      });
    });

    // Wait until loadQueue is called in startAfterCompletion
    await waitFor(() => {
      expect(queueCallsCount).toBeGreaterThanOrEqual(2);
    });

    // While loadQueue is pending, user selects Episode C!
    const playEpisodeCBtn = screen.getByRole("button", { name: "Play Episode C" });
    await user.click(playEpisodeCBtn);

    // Episode C is loading/playing
    await waitFor(() => {
      expect(audio.src).toContain("/api/episodes/99/audio");
    });
    await act(async () => {
      audio.emitLoadedMetadata(900);
      audio.emitCanPlay();
    });

    await waitFor(() => {
      expect(screen.getByTestId("current-key")).toHaveTextContent("episode:99");
      expect(audio.paused).toBe(false);
      expect(screen.getByTestId("playing")).toHaveTextContent("yes");
    });

    // Now A's pending loadQueue response resolves
    await act(async () => {
      queueDeferred.resolve({
        queue: [initialAudiobookItem, podcastEpisodeC],
        activePlayback: null,
      });
    });

    // Episode C MUST NOT be stopped (playing=false branch must be skipped)
    // and C's source must not be switched
    expect(screen.getByTestId("current-key")).toHaveTextContent("episode:99");
    expect(audio.src).toContain("/api/episodes/99/audio");
    expect(audio.paused).toBe(false);
    expect(screen.getByTestId("playing")).toHaveTextContent("yes");
  });

  it("7. Stale queue response after manual choice: 7a same book, 7b other book/podcast, 7c missing from snapshot", async () => {
    // We will test 7c: User chose Episode C which was NOT in the server's snapshot response!
    const completionDeferred = deferred<PlaybackUpdateResponse>();
    const queueDeferred = deferred<PlaybackQueueResponse>();
    let queueCallsCount = 0;

    vi.spyOn(api.playback, "queue").mockImplementation(async () => {
      queueCallsCount++;
      if (queueCallsCount === 1) {
        return {
          queue: [initialAudiobookItem, podcastEpisodeC],
          activePlayback: {
            audiobookId: 101,
            trackId: 1,
            lastUpdated: "2026-09-24T10:00:00Z",
          },
        };
      }
      return queueDeferred.promise;
    });

    vi.spyOn(api.playback, "update").mockImplementation(async (payload) => {
      if (payload.completed && payload.trackId === 1) {
        return completionDeferred.promise;
      }
      return {
        playback: {
          audiobookId: payload.audiobookId,
          episodeId: payload.episodeId,
          trackId: payload.trackId,
          positionSeconds: payload.positionSeconds,
          lastUpdated: new Date().toISOString(),
        },
        nextEpisodeId: null,
      };
    });

    render(
      <PlaybackProvider>
        <TestHarness />
      </PlaybackProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("loading")).toHaveTextContent("no");
    });

    const user = userEvent.setup();
    const playToggleBtn = screen.getByRole("button", { name: "Toggle Play" });

    // Start Chapter 1
    await user.click(playToggleBtn);
    const audio = FakeAudio.first!;
    await act(async () => {
      audio.emitLoadedMetadata(100);
      audio.emitCanPlay();
    });

    // Chapter 1 completes
    await act(async () => {
      audio.emit("ended");
    });

    // Chapter 2 starts auto-advance
    await waitFor(() => {
      expect(screen.getByTestId("current-track")).toHaveTextContent("2");
    });

    // Completion 1 resolves, triggering loadQueue
    await act(async () => {
      completionDeferred.resolve({
        playback: {
          audiobookId: 101,
          trackId: 1,
          positionSeconds: 100,
          lastUpdated: new Date().toISOString(),
        },
        nextTrackId: 2,
        nextEpisodeId: null,
      });
    });

    await waitFor(() => {
      expect(queueCallsCount).toBeGreaterThanOrEqual(2);
    });

    // While loadQueue is in flight, user manually switches to Episode C!
    const playEpisodeCBtn = screen.getByRole("button", { name: "Play Episode C" });
    await user.click(playEpisodeCBtn);

    await waitFor(() => {
      expect(audio.src).toContain("/api/episodes/99/audio");
    });
    await act(async () => {
      audio.emitLoadedMetadata(900);
      audio.emitCanPlay();
    });

    expect(screen.getByTestId("current-key")).toHaveTextContent("episode:99");
    expect(audio.paused).toBe(false);

    // Now the stale queue response returns from the server!
    // AND IT DOES NOT CONTAIN EPISODE C! (only book 101)
    await act(async () => {
      queueDeferred.resolve({
        queue: [initialAudiobookItem], // NO episode 99 here!
        activePlayback: {
          audiobookId: 101,
          trackId: 2,
          lastUpdated: new Date().toISOString(),
        },
      });
    });

    // Stale response must NOT remove Episode C from local queue,
    // must NOT change audio.src back to book 101, and must NOT stop Episode C!
    expect(screen.getByTestId("current-key")).toHaveTextContent("episode:99");
    expect(audio.src).toContain("/api/episodes/99/audio");
    expect(audio.paused).toBe(false);
    expect(screen.getByTestId("playing")).toHaveTextContent("yes");
  });

  it("7a. User chooses another chapter of same book (Chapter 5) while queue request is in flight: stale response does not revert Chapter 5", async () => {
    const completionDeferred = deferred<PlaybackUpdateResponse>();
    const queueDeferred = deferred<PlaybackQueueResponse>();
    let queueCallsCount = 0;

    vi.spyOn(api.playback, "queue").mockImplementation(async () => {
      queueCallsCount++;
      if (queueCallsCount === 1) {
        return {
          queue: [initialAudiobookItem],
          activePlayback: {
            audiobookId: 101,
            trackId: 1,
            lastUpdated: "2026-09-24T10:00:00Z",
          },
        };
      }
      return queueDeferred.promise;
    });

    vi.spyOn(api.playback, "update").mockImplementation(async (payload) => {
      if (payload.completed && payload.trackId === 1) {
        return completionDeferred.promise;
      }
      return {
        playback: {
          audiobookId: payload.audiobookId,
          trackId: payload.trackId,
          positionSeconds: payload.positionSeconds,
          lastUpdated: new Date().toISOString(),
        },
        nextEpisodeId: null,
      };
    });

    render(
      <PlaybackProvider>
        <TestHarness />
      </PlaybackProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("loading")).toHaveTextContent("no");
    });

    const user = userEvent.setup();
    const playToggleBtn = screen.getByRole("button", { name: "Toggle Play" });

    // Start Chapter 1
    await user.click(playToggleBtn);
    const audio = FakeAudio.first!;
    await act(async () => {
      audio.emitLoadedMetadata(100);
      audio.emitCanPlay();
    });

    // Chapter 1 completes
    await act(async () => {
      audio.emit("ended");
    });

    // Auto-advance moves to Chapter 2
    await waitFor(() => {
      expect(screen.getByTestId("current-track")).toHaveTextContent("2");
    });

    // Resolve completion 1
    await act(async () => {
      completionDeferred.resolve({
        playback: {
          audiobookId: 101,
          trackId: 1,
          positionSeconds: 100,
          lastUpdated: new Date().toISOString(),
        },
        nextTrackId: 2,
        nextEpisodeId: null,
      });
    });

    await waitFor(() => {
      expect(queueCallsCount).toBeGreaterThanOrEqual(2);
    });

    // While loadQueue is in flight, user manually chooses Chapter 5!
    const playChapter5Btn = screen.getByRole("button", { name: "Play Chapter 5" });
    await user.click(playChapter5Btn);

    await waitFor(() => {
      expect(audio.src).toContain("/api/audiobooks/101/tracks/5/audio");
    });
    await act(async () => {
      audio.emitLoadedMetadata(500);
      audio.emitCanPlay();
    });

    expect(screen.getByTestId("current-track")).toHaveTextContent("5");

    // Stale response arrives pointing to Chapter 2
    await act(async () => {
      queueDeferred.resolve({
        queue: [initialAudiobookItem],
        activePlayback: {
          audiobookId: 101,
          trackId: 2,
          lastUpdated: new Date().toISOString(),
        },
      });
    });

    // Stale response must NOT revert Chapter 5 to Chapter 2!
    expect(screen.getByTestId("current-track")).toHaveTextContent("5");
    expect(audio.src).toContain("/api/audiobooks/101/tracks/5/audio");
    expect(audio.paused).toBe(false);
  });

  it("7b. User chooses another audiobook (The Martian) while queue request is in flight: stale response does not revert to book 101", async () => {
    const completionDeferred = deferred<PlaybackUpdateResponse>();
    const queueDeferred = deferred<PlaybackQueueResponse>();
    let queueCallsCount = 0;

    vi.spyOn(api.playback, "queue").mockImplementation(async () => {
      queueCallsCount++;
      if (queueCallsCount === 1) {
        return {
          queue: [initialAudiobookItem, otherAudiobookItemC],
          activePlayback: {
            audiobookId: 101,
            trackId: 1,
            lastUpdated: "2026-09-24T10:00:00Z",
          },
        };
      }
      return queueDeferred.promise;
    });

    vi.spyOn(api.playback, "update").mockImplementation(async (payload) => {
      if (payload.completed && payload.trackId === 1) {
        return completionDeferred.promise;
      }
      return {
        playback: {
          audiobookId: payload.audiobookId,
          trackId: payload.trackId,
          positionSeconds: payload.positionSeconds,
          lastUpdated: new Date().toISOString(),
        },
        nextEpisodeId: null,
      };
    });

    render(
      <PlaybackProvider>
        <TestHarness />
      </PlaybackProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("loading")).toHaveTextContent("no");
    });

    const user = userEvent.setup();
    const playToggleBtn = screen.getByRole("button", { name: "Toggle Play" });

    // Start Chapter 1
    await user.click(playToggleBtn);
    const audio = FakeAudio.first!;
    await act(async () => {
      audio.emitLoadedMetadata(100);
      audio.emitCanPlay();
    });

    // Chapter 1 completes
    await act(async () => {
      audio.emit("ended");
    });

    await waitFor(() => {
      expect(screen.getByTestId("current-track")).toHaveTextContent("2");
    });

    await act(async () => {
      completionDeferred.resolve({
        playback: {
          audiobookId: 101,
          trackId: 1,
          positionSeconds: 100,
          lastUpdated: new Date().toISOString(),
        },
        nextTrackId: 2,
        nextEpisodeId: null,
      });
    });

    await waitFor(() => {
      expect(queueCallsCount).toBeGreaterThanOrEqual(2);
    });

    // While loadQueue is in flight, user switches to The Martian (audiobook 202)
    const playMartianBtn = screen.getByRole("button", { name: "Play Other Book C" });
    await user.click(playMartianBtn);

    await waitFor(() => {
      expect(audio.src).toContain("/api/audiobooks/202/tracks/1/audio");
    });
    await act(async () => {
      audio.emitLoadedMetadata(1500);
      audio.emitCanPlay();
    });

    expect(screen.getByTestId("current-key")).toHaveTextContent("audiobook:202");

    // Stale response arrives from book 101
    await act(async () => {
      queueDeferred.resolve({
        queue: [initialAudiobookItem, otherAudiobookItemC],
        activePlayback: {
          audiobookId: 101,
          trackId: 2,
          lastUpdated: new Date().toISOString(),
        },
      });
    });

    // Martian must stay active
    expect(screen.getByTestId("current-key")).toHaveTextContent("audiobook:202");
    expect(audio.src).toContain("/api/audiobooks/202/tracks/1/audio");
    expect(audio.paused).toBe(false);
  });
});
