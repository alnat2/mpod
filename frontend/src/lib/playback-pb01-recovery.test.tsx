import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { api, type Episode } from "./api";
import { PlaybackProvider, usePlayback } from "./playback-context";

type FakeMediaError = {
  code: number;
  message?: string;
};

class RecoveryFakeAudio {
  static instances: RecoveryFakeAudio[] = [];

  static get first() {
    return RecoveryFakeAudio.instances[0];
  }

  src = "";
  currentSrc = "";
  currentTimeSets: number[] = [];
  private currentTimeValue = 0;

  get currentTime() {
    return this.currentTimeValue;
  }

  set currentTime(val: number) {
    this.currentTimeValue = val;
    this.currentTimeSets.push(val);
  }
  duration = 0;
  readyState = 1;
  playbackRate = 1;
  defaultPlaybackRate = 1;
  paused = true;
  ended = false;
  error: FakeMediaError | null = null;
  private listeners = new Map<string, Set<() => void>>();
  throwOnPlay = false;

  playImpl = vi.fn(async () => {
    if (this.throwOnPlay || this.error) {
      throw new DOMException(
        "The element has no supported sources.",
        "NotSupportedError"
      );
    }
    this.paused = false;
  });

  pauseImpl = vi.fn(() => {
    this.paused = true;
  });

  loadImpl = vi.fn(() => {
    this.error = null;
    this.currentTime = 0;
    this.paused = true;
  });

  constructor() {
    RecoveryFakeAudio.instances.push(this);
  }

  addEventListener(type: string, listener: () => void) {
    const listeners = this.listeners.get(type) ?? new Set<() => void>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: () => void) {
    this.listeners.get(type)?.delete(listener);
  }

  getListenerCount(type: string) {
    return this.listeners.get(type)?.size ?? 0;
  }

  async play() {
    this.ended = false;
    return this.playImpl();
  }

  pause() {
    this.pauseImpl();
  }

  load() {
    this.loadImpl();
  }

  emit(type: string) {
    this.listeners.get(type)?.forEach((listener) => listener());
  }
}

const episodes = new Map<number, Episode>([
  [
    1,
    {
      id: 1,
      podcastId: 11,
      title: "Episode 1",
      description: "Notes",
      audioUrl: "https://example.com/1.mp3",
      duration: 1800,
      downloaded: false,
      isListened: false,
      publishedAt: "2026-05-10T10:00:00Z",
    },
  ],
  [
    2,
    {
      id: 2,
      podcastId: 11,
      title: "Episode 2",
      description: "Notes 2",
      audioUrl: "https://example.com/2.mp3",
      duration: 1800,
      downloaded: false,
      isListened: false,
      publishedAt: "2026-05-11T10:00:00Z",
    },
  ],
]);

function Harness() {
  const { playEpisode, playToggle, playing, playbackError } = usePlayback();
  return (
    <div>
      <div data-testid="playing">{playing ? "yes" : "no"}</div>
      <div data-testid="playback-error">{playbackError ?? "none"}</div>
      <button type="button" onClick={() => playEpisode(1)}>
        Play Ep 1
      </button>
      <button type="button" onClick={() => playEpisode(2)}>
        Play Ep 2
      </button>
      <button type="button" onClick={playToggle}>
        Toggle Play
      </button>
    </div>
  );
}

describe("PB-01 Recovery", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    RecoveryFakeAudio.instances = [];
    vi.stubGlobal("Audio", RecoveryFakeAudio);
    vi.stubGlobal("MediaError", {
      MEDIA_ERR_ABORTED: 1,
      MEDIA_ERR_NETWORK: 2,
      MEDIA_ERR_DECODE: 3,
      MEDIA_ERR_SRC_NOT_SUPPORTED: 4,
    });

    vi.spyOn(api.playlist, "list").mockResolvedValue({ items: [] });
    vi.spyOn(api.podcasts, "list").mockResolvedValue({ podcasts: [] });
    vi.spyOn(api.episodes, "get").mockImplementation(async (id) => ({
      episode: episodes.get(id)!,
    }));
    vi.spyOn(api.playback, "get").mockResolvedValue({ playback: null });
    vi.spyOn(api.playback, "queue").mockResolvedValue({
      queue: [
        { ...episodes.get(1)!, type: "episode", podcastTitle: "Podcast", podcastImageUrl: null, playback: null },
        { ...episodes.get(2)!, type: "episode", podcastTitle: "Podcast", podcastImageUrl: null, playback: null },
        { 
          id: 3, 
          podcastId: 0,
          title: "Book", 
          audioUrl: "",
          duration: 3600, 
          downloaded: false,
          isListened: false,
          publishedAt: null,
          type: "audiobook", 
          audiobookId: 3,
          podcastTitle: "Book", 
          playback: { positionSeconds: 120, lastUpdated: "", episodeId: 3 } 
        }
      ] as import("./api").PlaybackQueueEpisode[],
      activePlayback: null,
    });
    vi.spyOn(api.playback, "update").mockResolvedValue({
      playback: { episodeId: 1, positionSeconds: 0, lastUpdated: "" },
      nextEpisodeId: null,
    });
    vi.spyOn(api.playback, "setActive").mockResolvedValue({
      activePlayback: { episodeId: 1, lastUpdated: "" },
    });
    vi.spyOn(api.audiobooks, "get").mockResolvedValue({
      audiobook: { id: 3, title: "Book", author: "", relPath: "", hasCover: false, totalDuration: 3600, trackCount: 1, listenedCount: 0, isListened: false, positionSeconds: 120, createdAt: "", updatedAt: "" } as import("./api").Audiobook,
    });
    vi.spyOn(api.settings, "get").mockResolvedValue({
      settings: {
        dailyRefreshTime: "03:00",
        playbackSpeed: "Speed 1.0x",
        proxyEnabled: false,
        proxyConfigured: false,
        appBuild: "test",
      },
    });
  });

  it("reloads same source on explicit play when audio.error is set and HAVE_NOTHING", async () => {
    const user = userEvent.setup();
    render(
      <PlaybackProvider>
        <Harness />
      </PlaybackProvider>
    );

    await user.click(screen.getByRole("button", { name: "Play Ep 1" }));
    const audio = RecoveryFakeAudio.first!;
    expect(audio.loadImpl).toHaveBeenCalledTimes(1);

    audio.readyState = 1;
    await act(async () => {
      audio.emit("loadedmetadata");
      audio.emit("canplay");
    });
    expect(audio.playImpl).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("playing")).toHaveTextContent("yes");

    // Simulate error
    audio.loadImpl.mockClear();
    audio.playImpl.mockClear();
    await act(async () => {
      audio.error = { code: 2 };
      audio.readyState = 0; // HAVE_NOTHING
      audio.emit("error");
    });
    expect(screen.getByTestId("playing")).toHaveTextContent("no");
    expect(screen.getByTestId("playback-error")).toHaveTextContent("Network error");

    // Explicit play to recover
    await user.click(screen.getByRole("button", { name: "Toggle Play" }));
    await waitFor(() => {
      expect(audio.loadImpl).toHaveBeenCalledTimes(1);
    });

    // Provide events for the new load
    audio.readyState = 1;
    await act(async () => {
      audio.emit("loadedmetadata");
      audio.emit("canplay");
    });
    expect(audio.playImpl).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("playing")).toHaveTextContent("yes");
  });

  it("reloads same source on explicit play when audio.error is set but HAS_METADATA", async () => {
    const user = userEvent.setup();
    render(
      <PlaybackProvider>
        <Harness />
      </PlaybackProvider>
    );

    await user.click(screen.getByRole("button", { name: "Play Ep 1" }));
    const audio = RecoveryFakeAudio.first!;

    audio.readyState = 4;
    await act(async () => {
      audio.emit("loadedmetadata");
      audio.emit("canplay");
    });

    audio.loadImpl.mockClear();
    audio.playImpl.mockClear();
    await act(async () => {
      audio.error = { code: 4 }; // e.g. decode error
      audio.emit("error");
    });

    await user.click(screen.getByRole("button", { name: "Toggle Play" }));
    // Must call load() to clear error instead of trying to play directly
    await waitFor(() => {
      expect(audio.loadImpl).toHaveBeenCalledTimes(1);
    });
    
    await act(async () => {
      audio.emit("loadedmetadata");
      audio.emit("canplay");
    });
    expect(audio.playImpl).toHaveBeenCalledTimes(1);
  });

  it("resumes healthy paused source without reloading", async () => {
    const user = userEvent.setup();
    render(
      <PlaybackProvider>
        <Harness />
      </PlaybackProvider>
    );

    await user.click(screen.getByRole("button", { name: "Play Ep 1" }));
    const audio = RecoveryFakeAudio.first!;

    audio.readyState = 4;
    await act(async () => {
      audio.emit("loadedmetadata");
      audio.emit("canplay");
    });
    expect(audio.playImpl).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "Toggle Play" })); // Pause
    await waitFor(() => {
      expect(audio.pauseImpl).toHaveBeenCalled();
    });

    audio.loadImpl.mockClear();
    audio.playImpl.mockClear();

    await user.click(screen.getByRole("button", { name: "Toggle Play" })); // Resume
    await waitFor(() => {
      expect(audio.playImpl).toHaveBeenCalledTimes(1);
    });
    expect(audio.loadImpl).not.toHaveBeenCalled();
  });

  it("ignores delayed recovery events if track was changed", async () => {
    const user = userEvent.setup();
    render(
      <PlaybackProvider>
        <Harness />
      </PlaybackProvider>
    );

    await user.click(screen.getByRole("button", { name: "Play Ep 1" }));
    const audio = RecoveryFakeAudio.first!;
    audio.readyState = 1;
    await act(async () => {
      audio.emit("loadedmetadata");
      audio.emit("canplay");
    });
    audio.loadImpl.mockClear();
    audio.playImpl.mockClear();

    await act(async () => {
      audio.error = { code: 2 };
      audio.emit("error");
    });

    let resolveRefresh: (value: { playback: import("./api").PlaybackState | null }) => void;
    vi.spyOn(api.playback, "get").mockReturnValueOnce(new Promise((resolve) => {
      resolveRefresh = resolve;
    }));

    // Start recovery
    await user.click(screen.getByRole("button", { name: "Toggle Play" }));
    
    // Switch to Ep 2 before recovery's async fetch finishes
    await user.click(screen.getByRole("button", { name: "Play Ep 2" }));
    expect(audio.loadImpl).toHaveBeenCalledTimes(1); // 1 for Ep 2
    
    // Complete the first recovery fetch
    await act(async () => {
      resolveRefresh({ playback: null });
    });
    
    // load should still be 1 (the delayed recovery should abort)
    expect(audio.loadImpl).toHaveBeenCalledTimes(1);
  });

  it("ignores delayed recovery events if audiobook track was changed", async () => {
    const user = userEvent.setup();
    function AudiobookHarness() {
      const { playToggle, playAudiobookTrack } = usePlayback();
      return (
        <div>
          <button type="button" onClick={() => playAudiobookTrack(3, { id: 1, audiobookId: 3, trackNumber: 1, title: "", relPath: "", filePath: "", duration: 1800, positionSeconds: 120, isListened: false } as import("./api").AudiobookTrack)}>Play Track 1</button>
          <button type="button" onClick={() => playAudiobookTrack(3, { id: 2, audiobookId: 3, trackNumber: 2, title: "", relPath: "", filePath: "", duration: 1800, positionSeconds: 0, isListened: false } as import("./api").AudiobookTrack)}>Play Track 2</button>
          <button type="button" onClick={playToggle}>Toggle Play</button>
        </div>
      );
    }
    render(
      <PlaybackProvider>
        <AudiobookHarness />
      </PlaybackProvider>
    );

    await user.click(screen.getByRole("button", { name: "Play Track 1" }));
    const audio = RecoveryFakeAudio.first!;
    audio.readyState = 1;
    await act(async () => {
      audio.emit("loadedmetadata");
      audio.emit("canplay");
    });
    audio.loadImpl.mockClear();
    audio.playImpl.mockClear();

    await act(async () => {
      audio.error = { code: 2 };
      audio.emit("error");
    });

    let resolveRefresh: (value: { playback: import("./api").PlaybackState | null }) => void;
    vi.spyOn(api.playback, "get").mockReturnValueOnce(new Promise((resolve) => {
      // Simulate pending refresh A
      resolveRefresh = resolve;
    }));

    // Start recovery
    await user.click(screen.getByRole("button", { name: "Toggle Play" }));
    
    // Switch to Track 2 before recovery's async fetch finishes
    await user.click(screen.getByRole("button", { name: "Play Track 2" }));
    expect(audio.loadImpl).toHaveBeenCalledTimes(1); // 1 for Track 2
    
    const previousPosition = audio.currentTime;
    
    // Complete the first recovery fetch with a non-empty delayed playback A
    await act(async () => {
      resolveRefresh!({ playback: { positionSeconds: 500, lastUpdated: new Date().toISOString(), episodeId: 3, trackId: 1 } });
    });
    
    // load should still be 1 (the delayed recovery should abort)
    expect(audio.loadImpl).toHaveBeenCalledTimes(1);
    // position should not be overwritten by Track A's delayed position
    expect(audio.currentTime).toBe(previousPosition);
  });

  it("ignores stale refresh response on A -> B -> A transition within same book", async () => {
    const user = userEvent.setup();
    function AudiobookHarness() {
      const { playToggle, playAudiobookTrack } = usePlayback();
      return (
        <div>
          <button
            type="button"
            onClick={() =>
              playAudiobookTrack(3, {
                id: 1,
                audiobookId: 3,
                trackNumber: 1,
                title: "Track 1",
                relPath: "",
                filePath: "",
                duration: 1800,
                positionSeconds: 120,
                isListened: false,
              } as import("./api").AudiobookTrack)
            }
          >
            Play Track 1
          </button>
          <button
            type="button"
            onClick={() =>
              playAudiobookTrack(3, {
                id: 2,
                audiobookId: 3,
                trackNumber: 2,
                title: "Track 2",
                relPath: "",
                filePath: "",
                duration: 1800,
                positionSeconds: 0,
                isListened: false,
              } as import("./api").AudiobookTrack)
            }
          >
            Play Track 2
          </button>
          <button type="button" onClick={playToggle}>
            Toggle Play
          </button>
        </div>
      );
    }

    render(
      <PlaybackProvider>
        <AudiobookHarness />
      </PlaybackProvider>
    );

    // Initial play Track 1
    await user.click(screen.getByRole("button", { name: "Play Track 1" }));
    const audio = RecoveryFakeAudio.first!;
    audio.readyState = 1;
    await act(async () => {
      audio.emit("loadedmetadata");
      audio.emit("canplay");
    });
    expect(audio.currentTime).toBe(120);

    // Simulate error on Track 1
    await act(async () => {
      audio.error = { code: 2 };
      audio.emit("error");
    });

    // Mock delayed response for the first recovery of Track 1
    let resolveFirstRecoveryRefresh:
      | ((value: { playback: import("./api").PlaybackState | null }) => void)
      | null = null;
    vi.spyOn(api.playback, "get").mockImplementation(
      async (params: { episodeId?: number; audiobookId?: number; trackId?: number }) => {
      if (params.trackId === 1 && !resolveFirstRecoveryRefresh) {
        return new Promise((resolve) => {
          resolveFirstRecoveryRefresh = resolve;
        });
      }
      if (params.trackId === 1) {
        return {
          playback: {
            audiobookId: 3,
            trackId: 1,
            positionSeconds: 120,
            lastUpdated: new Date().toISOString(),
          },
        };
      }
      return {
        playback: {
          audiobookId: 3,
          trackId: 2,
          positionSeconds: 0,
          lastUpdated: new Date().toISOString(),
        },
      };
    });

    // User triggers recovery on Track 1 (this starts the delayed get)
    await user.click(screen.getByRole("button", { name: "Toggle Play" }));

    // User switches to Track 2
    await user.click(screen.getByRole("button", { name: "Play Track 2" }));
    audio.readyState = 1;
    await act(async () => {
      audio.emit("loadedmetadata");
      audio.emit("canplay");
    });
    expect(audio.src).toContain("/tracks/2/audio");

    // User switches back to Track 1 (new operation for Track 1)
    await user.click(screen.getByRole("button", { name: "Play Track 1" }));
    await waitFor(() => {
      expect(audio.src).toContain("/tracks/1/audio");
    });
    audio.readyState = 1;
    await act(async () => {
      audio.emit("loadedmetadata");
      audio.emit("canplay");
    });
    expect(audio.currentTime).toBe(120);

    // Now, resolve the FIRST recovery with stale position 500s
    await act(async () => {
      resolveFirstRecoveryRefresh!({
        playback: {
          audiobookId: 3,
          trackId: 1,
          positionSeconds: 500,
          lastUpdated: new Date().toISOString(),
        },
      });
    });

    // The stale refresh should NOT overwrite currentTime to 500
    expect(audio.currentTime).toBe(120);
  });


  it("persists error state if recovery fails again", async () => {
    const user = userEvent.setup();
    render(
      <PlaybackProvider>
        <Harness />
      </PlaybackProvider>
    );

    await user.click(screen.getByRole("button", { name: "Play Ep 1" }));
    const audio = RecoveryFakeAudio.first!;
    audio.readyState = 1;
    await act(async () => {
      audio.emit("loadedmetadata");
      audio.emit("canplay");
    });

    await act(async () => {
      audio.error = { code: 2 };
      audio.emit("error");
    });

    await user.click(screen.getByRole("button", { name: "Toggle Play" }));
    
    await act(async () => {
      audio.error = { code: 4 };
      audio.emit("error");
    });
    
    expect(screen.getByTestId("playing")).toHaveTextContent("no");
    expect(screen.getByTestId("playback-error")).toHaveTextContent("Audio source is not supported.");
  });

  it("cancels pending media handlers and prevents play on unmount", async () => {
    const user = userEvent.setup();
    const { unmount } = render(
      <PlaybackProvider>
        <Harness />
      </PlaybackProvider>
    );

    // Initial play Ep 1
    await user.click(screen.getByRole("button", { name: "Play Ep 1" }));
    const audio = RecoveryFakeAudio.first!;
    audio.readyState = 1;
    await act(async () => {
      audio.emit("loadedmetadata");
      audio.emit("canplay");
    });
    expect(audio.playImpl).toHaveBeenCalledTimes(1);

    // Error occurs
    await act(async () => {
      audio.error = { code: 2 };
      audio.emit("error");
    });

    audio.loadImpl.mockClear();
    audio.playImpl.mockClear();

    // Start recovery, which registers prime listeners (loadedmetadata, canplay, error)
    await user.click(screen.getByRole("button", { name: "Toggle Play" }));
    await waitFor(() => {
      expect(audio.loadImpl).toHaveBeenCalledTimes(1);
    });

    // Unmount while media events are still pending
    unmount();

    // Now deliver canplay event to the unmounted audio element
    await act(async () => {
      audio.emit("loadedmetadata");
      audio.emit("canplay");
    });

    // On unmount, prime handlers must be cancelled and play must NOT be called
    expect(audio.playImpl).not.toHaveBeenCalled();
    // Prime listeners must be cleaned up
    expect(audio.getListenerCount("canplay")).toBe(0);
    expect(audio.getListenerCount("loadedmetadata")).toBe(0);
  });

  it("cancels pending media handlers on track change so returning to same track does not trigger stale handler", async () => {
    const user = userEvent.setup();
    function AudiobookHarness() {
      const { playToggle, playAudiobookTrack } = usePlayback();
      return (
        <div>
          <button
            type="button"
            onClick={() =>
              playAudiobookTrack(3, {
                id: 1,
                audiobookId: 3,
                trackNumber: 1,
                title: "Track 1",
                relPath: "",
                filePath: "",
                duration: 1800,
                positionSeconds: 120,
                isListened: false,
              } as import("./api").AudiobookTrack)
            }
          >
            Play Track 1
          </button>
          <button
            type="button"
            onClick={() =>
              playAudiobookTrack(3, {
                id: 2,
                audiobookId: 3,
                trackNumber: 2,
                title: "Track 2",
                relPath: "",
                filePath: "",
                duration: 1800,
                positionSeconds: 0,
                isListened: false,
              } as import("./api").AudiobookTrack)
            }
          >
            Play Track 2
          </button>
          <button type="button" onClick={playToggle}>
            Toggle Play
          </button>
        </div>
      );
    }

    render(
      <PlaybackProvider>
        <AudiobookHarness />
      </PlaybackProvider>
    );

    // Initial play Track 1
    await user.click(screen.getByRole("button", { name: "Play Track 1" }));
    const audio = RecoveryFakeAudio.first!;
    audio.readyState = 1;
    await act(async () => {
      audio.emit("loadedmetadata");
      audio.emit("canplay");
    });
    expect(audio.currentTime).toBe(120);

    // Error occurs
    await act(async () => {
      audio.error = { code: 2 };
      audio.emit("error");
    });

    // Start recovery on Track 1 (registers prime listeners with position 120)
    await user.click(screen.getByRole("button", { name: "Toggle Play" }));
    await waitFor(() => {
      expect(audio.loadImpl).toHaveBeenCalledTimes(2);
    });

    // Do NOT emit canplay for Track 1 recovery yet! Switch to Track 2 immediately.
    await user.click(screen.getByRole("button", { name: "Play Track 2" }));
    audio.readyState = 1;
    await act(async () => {
      audio.emit("loadedmetadata");
      audio.emit("canplay");
    });
    expect(audio.src).toContain("/tracks/2/audio");

    // Now switch back to Track 1 with position 50
    vi.spyOn(api.playback, "get").mockResolvedValueOnce({
      playback: {
        audiobookId: 3,
        trackId: 1,
        positionSeconds: 50,
        lastUpdated: new Date().toISOString(),
      },
    });

    await user.click(screen.getByRole("button", { name: "Play Track 1" }));
    await waitFor(() => {
      expect(audio.src).toContain("/tracks/1/audio");
    });
    audio.playImpl.mockClear();
    audio.currentTimeSets = [];
    audio.readyState = 1;
    await act(async () => {
      audio.emit("loadedmetadata");
      audio.emit("canplay");
    });

    // Verify position is the newly selected 50, and that stale 120 was never applied
    expect(audio.currentTime).toBe(50);
    expect(audio.currentTimeSets).toEqual([50]);
    expect(audio.playImpl).toHaveBeenCalledTimes(1);
    // At most 1 active prime listener should exist for canplay, not accumulated zombie listeners
    expect(audio.getListenerCount("canplay")).toBe(0);
  });

  it("recovers audiobook with saved position and playback speed", async () => {
    const user = userEvent.setup();
    
    vi.spyOn(api.settings, "get").mockResolvedValue({
      settings: {
        dailyRefreshTime: "03:00",
        playbackSpeed: "Speed 1.0x",
        audiobookPlaybackSpeed: "Speed 1.5x",
        proxyEnabled: false,
        proxyConfigured: false,
        appBuild: "test",
      },
    });

    function AudiobookHarness() {
      const { playToggle, playAudiobookTrack, playing, playbackError } = usePlayback();
      return (
        <div>
          <div data-testid="playing">{playing ? "yes" : "no"}</div>
          <div data-testid="playback-error">{playbackError ?? "none"}</div>
          <button
            type="button"
            onClick={() =>
              playAudiobookTrack(3, {
                id: 1,
                audiobookId: 3,
                trackNumber: 1,
                title: "Chapter 1",
                relPath: "",
                filePath: "",
                duration: 1800,
                positionSeconds: 120,
                isListened: false,
              } as import("./api").AudiobookTrack)
            }
          >
            Play Book
          </button>
          <button type="button" onClick={playToggle}>
            Toggle Play
          </button>
        </div>
      );
    }

    render(
      <PlaybackProvider>
        <AudiobookHarness />
      </PlaybackProvider>
    );

    await act(async () => {}); // flush settings fetch

    await user.click(screen.getByRole("button", { name: "Play Book" }));
    const audio = RecoveryFakeAudio.first!;
    
    audio.readyState = 1;
    await act(async () => {
      audio.emit("loadedmetadata");
      audio.emit("canplay");
    });
    
    await waitFor(() => {
      expect(audio.currentTime).toBe(120);
      expect(audio.playbackRate).toBe(1.5);
      expect(screen.getByTestId("playing")).toHaveTextContent("yes");
      expect(screen.getByTestId("playback-error")).toHaveTextContent("none");
      expect(audio.src).toContain("/api/audiobooks/3/tracks/1/audio");
    });

    // Error occurs
    await act(async () => {
      audio.error = { code: 2 };
      audio.emit("error");
    });

    expect(screen.getByTestId("playing")).toHaveTextContent("no");
    expect(screen.getByTestId("playback-error")).toHaveTextContent("Network error");
    expect(audio.paused).toBe(true);

    // Reset counters and currentTime directly before recovery to prove recovery itself succeeded
    audio.loadImpl.mockClear();
    audio.playImpl.mockClear();
    audio.currentTime = 0;

    // Explicit Toggle Play to recover
    await user.click(screen.getByRole("button", { name: "Toggle Play" }));
    
    // Recovery must initiate load()
    await waitFor(() => {
      expect(audio.loadImpl).toHaveBeenCalledTimes(1);
    });

    // Deliver ready events
    audio.readyState = 1;
    await act(async () => {
      audio.emit("loadedmetadata");
      audio.emit("canplay");
    });

    // After ready events: play called, paused false, error cleared, playing yes, position and speed restored
    await waitFor(() => {
      expect(audio.playImpl).toHaveBeenCalledTimes(1);
      expect(audio.paused).toBe(false);
      expect(audio.currentTime).toBe(120);
      expect(audio.playbackRate).toBe(1.5);
      expect(screen.getByTestId("playing")).toHaveTextContent("yes");
      expect(screen.getByTestId("playback-error")).toHaveTextContent("none");
      expect(audio.src).toContain("/api/audiobooks/3/tracks/1/audio");
    });
  });

  it("preserves effect priming across durationchange and queue updates before loadedmetadata", async () => {
    const user = userEvent.setup();

    vi.spyOn(api.playback, "queue").mockResolvedValue({
      queue: [
        { ...episodes.get(1)!, type: "episode", podcastTitle: "Podcast", podcastImageUrl: null, playback: null },
        {
          ...episodes.get(2)!,
          type: "episode",
          podcastTitle: "Podcast",
          podcastImageUrl: null,
          playback: { episodeId: 2, positionSeconds: 75, lastUpdated: "" },
        },
      ] as import("./api").PlaybackQueueEpisode[],
      activePlayback: null,
    });

    function EffectPrimingHarness() {
      const { playToggle, updateQueue, playing, positionSeconds } = usePlayback();
      return (
        <div>
          <div data-testid="playing">{playing ? "yes" : "no"}</div>
          <div data-testid="position">{positionSeconds}</div>
          <button type="button" onClick={playToggle}>
            Toggle Play
          </button>
          <button
            type="button"
            onClick={() => {
              // Reorder queue so Episode 2 becomes first active item
              updateQueue((prev) => [prev[1]!, prev[0]!, ...prev.slice(2)]);
            }}
          >
            Move Ep 2 to First
          </button>
          <button
            type="button"
            onClick={() => {
              // Touch current episode object without changing src
              updateQueue((prev) =>
                prev.map((item, idx) =>
                  idx === 0 ? { ...item, title: item.title + " (updated)" } : item
                )
              );
            }}
          >
            Touch Current Episode
          </button>
        </div>
      );
    }

    render(
      <PlaybackProvider>
        <EffectPrimingHarness />
      </PlaybackProvider>
    );

    // Initial state: play Ep 1 to set playing=true and sourcePrimedRef=true
    await user.click(screen.getByRole("button", { name: "Toggle Play" }));
    const audio = RecoveryFakeAudio.first!;
    audio.readyState = 1;
    await act(async () => {
      audio.emit("loadedmetadata");
      audio.emit("canplay");
    });

    await waitFor(() => {
      expect(screen.getByTestId("playing")).toHaveTextContent("yes");
      expect(audio.src).toContain("/api/episodes/1/audio");
    });

    // Reset mocks before switching to Ep 2 to measure effects specifically on Ep 2
    audio.playImpl.mockClear();
    audio.loadImpl.mockClear();
    audio.currentTime = 0;
    audio.currentTimeSets = [];
    audio.readyState = 0;

    // Switch active item to Ep 2 via queue reorder (triggers effect-based priming because playing=true)
    await user.click(screen.getByRole("button", { name: "Move Ep 2 to First" }));

    // Verify effect started loading Ep 2
    await waitFor(() => {
      expect(audio.src).toContain("/api/episodes/2/audio");
      expect(audio.loadImpl).toHaveBeenCalledTimes(1);
    });

    // 1. Durationchange arrives BEFORE loadedmetadata
    audio.duration = 2400;
    await act(async () => {
      audio.emit("durationchange");
    });

    // 2. Queue updates object of current item without changing src
    await user.click(screen.getByRole("button", { name: "Touch Current Episode" }));

    // Verify no repeat load() was called
    expect(audio.loadImpl).toHaveBeenCalledTimes(1);

    // 3. Now browser finishes preparing audio and delivers ready events
    audio.readyState = 1;
    await act(async () => {
      audio.emit("loadedmetadata");
      audio.emit("canplay");
    });

    // Verify successful play, position restoration, and no duplicate load
    await waitFor(() => {
      expect(audio.playImpl).toHaveBeenCalledTimes(1);
      expect(audio.paused).toBe(false);
      expect(audio.currentTime).toBe(75);
      expect(screen.getByTestId("playing")).toHaveTextContent("yes");
    });
    expect(audio.loadImpl).toHaveBeenCalledTimes(1);
  });
});
