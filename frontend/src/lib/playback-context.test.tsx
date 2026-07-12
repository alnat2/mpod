import { Profiler } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { api, type Episode, type Podcast, type PlaybackState } from "./api";
import {
  PlaybackProvider,
  usePlayback,
  usePlaybackDispatch,
} from "./playback-context";

type FakeMediaError = {
  code: number;
  message?: string;
};

class FakeAudio {
  static instances: FakeAudio[] = [];

  src = "";
  currentTime = 0;
  duration = 0;
  playbackRate = 1;
  defaultPlaybackRate = 1;
  paused = true;
  error: FakeMediaError | null = null;
  private listeners = new Map<string, Set<() => void>>();
  playImpl = vi.fn(async () => {
    this.paused = false;
  });
  pauseImpl = vi.fn(() => {
    this.paused = true;
  });

  constructor() {
    FakeAudio.instances.push(this);
  }

  addEventListener(type: string, listener: () => void) {
    const listeners = this.listeners.get(type) ?? new Set<() => void>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: () => void) {
    this.listeners.get(type)?.delete(listener);
  }

  async play() {
    return this.playImpl();
  }

  pause() {
    this.pauseImpl();
  }

  emit(type: string) {
    this.listeners.get(type)?.forEach((listener) => listener());
  }
}

const playlistItems = [
  {
    episodeId: 1,
    position: 1,
    episode: {
      id: 1,
      title: "First queued episode",
      podcastId: 11,
      isListened: false,
      downloaded: false,
    },
  },
  {
    episodeId: 2,
    position: 2,
    episode: {
      id: 2,
      title: "Second queued episode",
      podcastId: 22,
      isListened: false,
      downloaded: false,
    },
  },
];

const podcasts: Podcast[] = [
  {
    id: 11,
    title: "First Podcast",
    rssUrl: "https://example.com/first.xml",
    description: null,
    imageUrl: null,
    lastChecked: null,
    updateTime: null,
  },
  {
    id: 22,
    title: "Second Podcast",
    rssUrl: "https://example.com/second.xml",
    description: null,
    imageUrl: null,
    lastChecked: null,
    updateTime: null,
  },
];

const episodes = new Map<number, Episode>([
  [
    1,
    {
      id: 1,
      podcastId: 11,
      title: "First queued episode",
      description: "First notes",
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
      podcastId: 22,
      title: "Second queued episode",
      description: "Second notes",
      audioUrl: "https://example.com/2.mp3",
      duration: 2400,
      downloaded: false,
      isListened: false,
      publishedAt: "2026-05-11T10:00:00Z",
    },
  ],
  [
    999,
    {
      id: 999,
      podcastId: 11,
      title: "Not yet queued",
      description: "Future queue notes",
      audioUrl: "https://example.com/999.mp3",
      duration: 1200,
      downloaded: false,
      isListened: false,
      publishedAt: "2026-05-12T10:00:00Z",
    },
  ],
]);

const playback = new Map<number, PlaybackState | null>([
  [
    1,
    {
      episodeId: 1,
      positionSeconds: 15,
      lastUpdated: "2026-05-22T08:00:00Z",
    },
  ],
  [
    2,
    {
      episodeId: 2,
      positionSeconds: 42,
      lastUpdated: "2026-05-22T08:05:00Z",
    },
  ],
]);

function Harness() {
  const {
    currentEpisode,
    queue,
    loading,
    playing,
    playbackError,
    positionSeconds,
    durationSeconds,
    speedLabel,
    playToggle,
    playEpisode,
    clearPlaybackError,
    seekForward,
    seekBackward,
    seekTo,
    setSpeedLabel,
  } = usePlayback();

  return (
    <div>
      <div data-testid="loading">{loading ? "yes" : "no"}</div>
      <div data-testid="queue-size">{queue.length}</div>
      <div data-testid="current-title">{currentEpisode?.title ?? "none"}</div>
      <div data-testid="current-podcast">{currentEpisode?.podcastTitle ?? "none"}</div>
      <div data-testid="playing">{playing ? "yes" : "no"}</div>
      <div data-testid="position">{positionSeconds}</div>
      <div data-testid="duration">{durationSeconds}</div>
      <div data-testid="speed">{speedLabel}</div>
      <div data-testid="playback-error">{playbackError ?? "none"}</div>
      <button type="button" onClick={() => playEpisode(2)}>
        Play second
      </button>
      <button type="button" onClick={() => playEpisode(999)}>
        Play queued later
      </button>
      <button type="button" onClick={playToggle}>
        Toggle play
      </button>
      <button type="button" onClick={clearPlaybackError}>
        Clear error
      </button>
      <button type="button" onClick={seekForward}>
        Forward
      </button>
      <button type="button" onClick={seekBackward}>
        Backward
      </button>
      <button type="button" onClick={() => seekTo(333)}>
        Seek exact
      </button>
      <button type="button" onClick={() => setSpeedLabel("Speed 2x")}>
        Speed 2x
      </button>
    </div>
  );
}

function renderPlaybackProvider() {
  return render(
    <PlaybackProvider>
      <Harness />
    </PlaybackProvider>
  );
}

let dispatchHarnessProfilerCommits = 0;

function DispatchOnlyHarness() {
  usePlaybackDispatch();

  return <div data-testid="dispatch-render-count">ready</div>;
}

describe("PlaybackProvider", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    FakeAudio.instances = [];
    dispatchHarnessProfilerCommits = 0;
    vi.stubGlobal("Audio", FakeAudio);
    vi.stubGlobal("MediaError", {
      MEDIA_ERR_ABORTED: 1,
      MEDIA_ERR_NETWORK: 2,
      MEDIA_ERR_DECODE: 3,
      MEDIA_ERR_SRC_NOT_SUPPORTED: 4,
    });
    episodes.set(1, {
      ...episodes.get(1)!,
      duration: 1800,
    });
    playback.set(1, {
      episodeId: 1,
      positionSeconds: 15,
      lastUpdated: "2026-05-22T08:00:00Z",
    });
    playback.set(2, {
      episodeId: 2,
      positionSeconds: 42,
      lastUpdated: "2026-05-22T08:05:00Z",
    });

    vi.spyOn(api.playlist, "list").mockResolvedValue({ items: playlistItems });
    vi.spyOn(api.podcasts, "list").mockResolvedValue({ podcasts });
    vi.spyOn(api.episodes, "get").mockImplementation(async (episodeId) => ({
      episode: episodes.get(episodeId)!,
    }));
    vi.spyOn(api.playback, "get").mockImplementation(async (episodeId) => ({
      playback: playback.get(episodeId) ?? null,
    }));
    vi.spyOn(api.playback, "update").mockImplementation(async (payload) => ({
      playback: {
        episodeId: payload.episodeId,
        positionSeconds: payload.positionSeconds,
        lastUpdated: "2026-05-22T09:00:00Z",
      },
      nextEpisodeId: null,
    }));
    vi.spyOn(api.settings, "get").mockResolvedValue({
      settings: {
        dailyRefreshTime: "03:00",
        playbackSpeed: "Speed 1.3x",
        proxyEnabled: false,
        proxyConfigured: false,
        appBuild: "test-build",
      },
    });
    vi.spyOn(api.settings, "update").mockImplementation(async (payload) => ({
      settings: {
        dailyRefreshTime: "03:00",
        playbackSpeed: payload.playbackSpeed ?? "Speed 1.3x",
        proxyEnabled: false,
        proxyConfigured: false,
        appBuild: "test-build",
      },
    }));
  });

  it("loads queue data and exposes the first queue item as the default current episode", async () => {
    renderPlaybackProvider();

    await waitFor(() => {
      expect(screen.getByTestId("loading")).toHaveTextContent("no");
    });

    expect(screen.getByTestId("queue-size")).toHaveTextContent("2");
    expect(screen.getByTestId("current-title")).toHaveTextContent("First queued episode");
    expect(screen.getByTestId("current-podcast")).toHaveTextContent("First Podcast");
    expect(screen.getByTestId("speed")).toHaveTextContent("Speed 1.3x");
  });

  it("switches to the clicked queued episode and primes audio from its saved position", async () => {
    const user = userEvent.setup();
    renderPlaybackProvider();

    await waitFor(() => {
      expect(screen.getByTestId("loading")).toHaveTextContent("no");
    });

    await user.click(screen.getByRole("button", { name: "Play second" }));

    const audio = FakeAudio.instances[0];
    expect(audio).toBeDefined();
    expect(audio.src).toContain("/api/episodes/2/audio");
    expect(audio.currentTime).toBe(42);
    expect(audio.playImpl).toHaveBeenCalled();
    expect(screen.getByTestId("current-title")).toHaveTextContent("Second queued episode");
  });

  it("can prime playback for an episode that is not yet in the loaded queue", async () => {
    const user = userEvent.setup();
    renderPlaybackProvider();

    await waitFor(() => {
      expect(screen.getByTestId("loading")).toHaveTextContent("no");
    });

    await user.click(screen.getByRole("button", { name: "Play queued later" }));

    const audio = FakeAudio.instances[0];
    expect(audio.src).toContain("/api/episodes/999/audio");
    expect(screen.getByTestId("playing")).toHaveTextContent("yes");
  });

  it("surfaces user-initiated play failures and clears them on demand", async () => {
    const user = userEvent.setup();
    renderPlaybackProvider();

    await waitFor(() => {
      expect(screen.getByTestId("loading")).toHaveTextContent("no");
    });

    const audio = FakeAudio.instances[0];
    audio.playImpl.mockRejectedValueOnce(new Error("Playback was blocked"));

    await user.click(screen.getByRole("button", { name: "Toggle play" }));

    await waitFor(() => {
      expect(screen.getByTestId("playback-error")).toHaveTextContent(
        "Playback was blocked"
      );
    });

    await user.click(screen.getByRole("button", { name: "Clear error" }));
    expect(screen.getByTestId("playback-error")).toHaveTextContent("none");
  });

  it("ignores passive media element errors before the user starts playback", async () => {
    renderPlaybackProvider();

    await waitFor(() => {
      expect(screen.getByTestId("loading")).toHaveTextContent("no");
    });

    const audio = FakeAudio.instances[0];
    audio.error = { code: 4 };
    audio.emit("error");

    expect(screen.getByTestId("playback-error")).toHaveTextContent("none");
    expect(screen.getByTestId("playing")).toHaveTextContent("no");
  });

  it("surfaces media element errors after the user starts playback", async () => {
    const user = userEvent.setup();
    renderPlaybackProvider();

    await waitFor(() => {
      expect(screen.getByTestId("loading")).toHaveTextContent("no");
    });

    const audio = FakeAudio.instances[0];
    await user.click(screen.getByRole("button", { name: "Toggle play" }));

    audio.error = { code: 4 };
    audio.emit("error");

    await waitFor(() => {
      expect(screen.getByTestId("playback-error")).toHaveTextContent(
        "Audio source is not supported."
      );
    });
    expect(screen.getByTestId("playing")).toHaveTextContent("no");
  });

  it("updates playback position and sends seek syncs to the backend", async () => {
    const user = userEvent.setup();
    const updateSpy = vi.spyOn(api.playback, "update");
    renderPlaybackProvider();

    await waitFor(() => {
      expect(screen.getByTestId("loading")).toHaveTextContent("no");
    });

    const audio = FakeAudio.instances[0];
    audio.currentTime = 120;

    await user.click(screen.getByRole("button", { name: "Forward" }));
    expect(audio.currentTime).toBe(135);

    await user.click(screen.getByRole("button", { name: "Backward" }));
    expect(audio.currentTime).toBe(125);

    await user.click(screen.getByRole("button", { name: "Seek exact" }));
    expect(audio.currentTime).toBe(333);

    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        episodeId: 1,
        didSeek: true,
      })
    );
  });

  it("saves the current playback position immediately when pausing", async () => {
    const user = userEvent.setup();
    const updateSpy = vi.spyOn(api.playback, "update");
    renderPlaybackProvider();

    await waitFor(() => {
      expect(screen.getByTestId("loading")).toHaveTextContent("no");
    });

    await user.click(screen.getByRole("button", { name: "Toggle play" }));

    const audio = FakeAudio.instances[0];
    await waitFor(() => {
      expect(screen.getByTestId("playing")).toHaveTextContent("yes");
    });
    audio.currentTime = 222;

    await user.click(screen.getByRole("button", { name: "Toggle play" }));

    expect(screen.getByTestId("playing")).toHaveTextContent("no");
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        episodeId: 1,
        positionSeconds: 222,
      })
    );
  });

  it("refreshes stale backend playback before resuming a paused episode", async () => {
    const user = userEvent.setup();
    renderPlaybackProvider();

    await waitFor(() => {
      expect(screen.getByTestId("loading")).toHaveTextContent("no");
    });

    playback.set(1, {
      episodeId: 1,
      positionSeconds: 333,
      lastUpdated: "2026-05-22T09:30:00Z",
    });

    await user.click(screen.getByRole("button", { name: "Toggle play" }));

    const audio = FakeAudio.instances[0];
    await waitFor(() => {
      expect(audio.currentTime).toBe(333);
    });
    expect(screen.getByTestId("position")).toHaveTextContent("333");
  });

  it("refreshes stale backend playback when a paused tab becomes visible", async () => {
    renderPlaybackProvider();

    await waitFor(() => {
      expect(screen.getByTestId("loading")).toHaveTextContent("no");
    });

    playback.set(1, {
      episodeId: 1,
      positionSeconds: 444,
      lastUpdated: "2026-05-22T09:45:00Z",
    });
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });

    document.dispatchEvent(new Event("visibilitychange"));

    await waitFor(() => {
      expect(screen.getByTestId("position")).toHaveTextContent("444");
    });
  });

  it("uses audio metadata duration when feed metadata is missing", async () => {
    episodes.set(1, {
      ...episodes.get(1)!,
      duration: null,
    });

    renderPlaybackProvider();

    await waitFor(() => {
      expect(screen.getByTestId("loading")).toHaveTextContent("no");
    });

    expect(screen.getByTestId("duration")).toHaveTextContent("0");

    const audio = FakeAudio.instances[0];
    audio.duration = 1500;
    audio.emit("loadedmetadata");

    await waitFor(() => {
      expect(screen.getByTestId("duration")).toHaveTextContent("1500");
    });
  });

  it("applies playback speed changes to the audio element", async () => {
    const user = userEvent.setup();
    const updateSettingsSpy = vi.spyOn(api.settings, "update");
    renderPlaybackProvider();

    await waitFor(() => {
      expect(screen.getByTestId("loading")).toHaveTextContent("no");
    });

    const audio = FakeAudio.instances[0];
    expect(audio.playbackRate).toBe(1.3);

    await user.click(screen.getByRole("button", { name: "Toggle play" }));
    await waitFor(() => {
      expect(screen.getByTestId("playing")).toHaveTextContent("yes");
    });

    audio.currentTime = 120;
    audio.emit("timeupdate");
    await waitFor(() => {
      expect(screen.getByTestId("position")).toHaveTextContent("120");
    });

    await user.click(screen.getByRole("button", { name: "Speed 2x" }));

    expect(screen.getByTestId("speed")).toHaveTextContent("Speed 2x");
    expect(FakeAudio.instances).toHaveLength(1);
    expect(audio.currentTime).toBe(120);
    expect(audio.playbackRate).toBe(2);
    expect(screen.getByTestId("position")).toHaveTextContent("120");
    expect(updateSettingsSpy).toHaveBeenCalledWith({ playbackSpeed: "Speed 2x" });
  });

  it("restores playback speed from backend settings on load", async () => {
    vi.spyOn(api.settings, "get").mockResolvedValueOnce({
      settings: {
        dailyRefreshTime: "03:00",
        playbackSpeed: "Speed 2x",
        proxyEnabled: false,
        proxyConfigured: false,
        appBuild: "test-build",
      },
    });

    renderPlaybackProvider();

    await waitFor(() => {
      expect(screen.getByTestId("loading")).toHaveTextContent("no");
    });

    await waitFor(() => {
      expect(screen.getByTestId("speed")).toHaveTextContent("Speed 2x");
    });

    expect(screen.getByTestId("speed")).toHaveTextContent("Speed 2x");
  });

  it("refreshes playback speed from backend settings when a tab becomes visible", async () => {
    const settingsGetSpy = vi.spyOn(api.settings, "get");
    renderPlaybackProvider();

    await waitFor(() => {
      expect(screen.getByTestId("speed")).toHaveTextContent("Speed 1.3x");
    });

    settingsGetSpy.mockResolvedValueOnce({
      settings: {
        dailyRefreshTime: "03:00",
        playbackSpeed: "Speed 2x",
        proxyEnabled: false,
        proxyConfigured: false,
        appBuild: "test-build",
      },
    });
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });

    document.dispatchEvent(new Event("visibilitychange"));

    await waitFor(() => {
      expect(screen.getByTestId("speed")).toHaveTextContent("Speed 2x");
    });
  });

  it("auto-advances to the next queue item when the current episode ends", async () => {
    const updateSpy = vi.spyOn(api.playback, "update");
    renderPlaybackProvider();

    await waitFor(() => {
      expect(screen.getByTestId("loading")).toHaveTextContent("no");
    });

    const audio = FakeAudio.instances[0];
    audio.currentTime = 1800;
    audio.emit("ended");

    await waitFor(() => {
      expect(screen.getByTestId("current-title")).toHaveTextContent(
        "Second queued episode"
      );
    });

    expect(audio.src).toContain("/api/episodes/2/audio");
    expect(audio.currentTime).toBe(42);
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        episodeId: 1,
        completed: true,
      })
    );
  });

  it("uses backend-selected fallback playback after the last queue item ends", async () => {
    const user = userEvent.setup();
    const updateSpy = vi.spyOn(api.playback, "update").mockImplementation(
      async (payload) => ({
        playback: {
          episodeId: payload.episodeId,
          positionSeconds: payload.positionSeconds,
          lastUpdated: "2026-05-22T09:00:00Z",
        },
        nextEpisodeId:
          payload.episodeId === 2 && payload.completed ? 1 : null,
      })
    );

    renderPlaybackProvider();

    await waitFor(() => {
      expect(screen.getByTestId("loading")).toHaveTextContent("no");
    });

    await user.click(screen.getByRole("button", { name: "Play second" }));

    const audio = FakeAudio.instances[0];
    audio.currentTime = 2400;
    audio.emit("ended");

    await waitFor(() => {
      expect(screen.getByTestId("current-title")).toHaveTextContent(
        "First queued episode"
      );
    });

    expect(audio.src).toContain("/api/episodes/1/audio");
    expect(audio.currentTime).toBe(15);
    expect(screen.getByTestId("playing")).toHaveTextContent("yes");
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        episodeId: 2,
        completed: true,
      })
    );
  });

  it("does not rerender dispatch-only consumers on audio time updates", async () => {
    render(
      <PlaybackProvider>
        <Profiler
          id="dispatch-only"
          onRender={() => {
            dispatchHarnessProfilerCommits += 1;
          }}
        >
          <DispatchOnlyHarness />
        </Profiler>
      </PlaybackProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("dispatch-render-count")).toHaveTextContent("ready");
    });

    const audio = FakeAudio.instances[0];
    const commitsBeforeTimeUpdate = dispatchHarnessProfilerCommits;

    audio.currentTime = 123;
    audio.emit("timeupdate");

    expect(dispatchHarnessProfilerCommits).toBe(commitsBeforeTimeUpdate);
  });
});
