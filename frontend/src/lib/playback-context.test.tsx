import { Profiler } from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
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

  static get first() {
    const audio = FakeAudio.instances[0];
    if (!audio) {
      throw new Error("Expected an audio instance");
    }
    return audio;
  }

  src = "";
  private currentTimeValue = 0;
  throwOnCurrentTimeSet = false;
  duration = 0;
  readyState = 1;
  playbackRate = 1;
  defaultPlaybackRate = 1;
  paused = true;
  error: FakeMediaError | null = null;
  private sourceReloading = false;
  private listeners = new Map<string, Set<() => void>>();
  playImpl = vi.fn(async () => {
    this.paused = false;
  });
  pauseImpl = vi.fn(() => {
    this.paused = true;
  });
  loadImpl = vi.fn(() => {
    this.currentTimeValue = 0;
    this.readyState = 0;
  });

  constructor() {
    FakeAudio.instances.push(this);
  }

  get currentTime() {
    return this.currentTimeValue;
  }

  set currentTime(value: number) {
    if (this.throwOnCurrentTimeSet) {
      throw new DOMException("Seek is not ready", "NotSupportedError");
    }
    this.currentTimeValue = value;
  }

  addEventListener(type: string, listener: () => void) {
    const listeners = this.listeners.get(type) ?? new Set<() => void>();
    listeners.add(listener);
    this.listeners.set(type, listeners);

    if (
      this.readyState >= 1 &&
      (type === "loadedmetadata" || type === "canplay")
    ) {
      queueMicrotask(() => {
        if (!this.sourceReloading) {
          listener();
        }
      });
    }
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

  load() {
    this.sourceReloading = true;
    this.loadImpl();
  }

  emit(type: string) {
    if (type === "loadedmetadata" || type === "canplay") {
      this.sourceReloading = false;
    }
    this.listeners.get(type)?.forEach((listener) => listener());
  }
}

class FakeMediaSession {
  playbackState: MediaSessionPlaybackState = "none";
  handlers = new Map<
    MediaSessionAction,
    MediaSessionActionHandler | null
  >();

  setActionHandler = vi.fn(
    (
      action: MediaSessionAction,
      handler: MediaSessionActionHandler | null
    ) => {
      this.handlers.set(action, handler);
    }
  );

  invoke(action: MediaSessionAction) {
    this.handlers.get(action)?.({ action } as MediaSessionActionDetails);
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
    3,
    {
      id: 3,
      podcastId: 22,
      title: "Third queued episode",
      description: "Third notes",
      audioUrl: "https://example.com/3.mp3",
      duration: 2700,
      downloaded: false,
      isListened: false,
      publishedAt: "2026-05-12T10:00:00Z",
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

let activePlaybackEpisodeId: number | null = null;
let mediaSession: FakeMediaSession;

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
      <button type="button" onClick={() => playEpisode(3)}>
        Play third
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });

  return { promise, resolve };
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
    mediaSession = new FakeMediaSession();
    Object.defineProperty(navigator, "mediaSession", {
      configurable: true,
      value: mediaSession,
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
    activePlaybackEpisodeId = null;

    vi.spyOn(api.playlist, "list").mockResolvedValue({ items: playlistItems });
    vi.spyOn(api.podcasts, "list").mockResolvedValue({ podcasts });
    vi.spyOn(api.episodes, "get").mockImplementation(async (episodeId) => ({
      episode: episodes.get(episodeId)!,
    }));
    vi.spyOn(api.playback, "get").mockImplementation(async (episodeId) => ({
      playback: playback.get(episodeId) ?? null,
    }));
    vi.spyOn(api.playback, "queue").mockImplementation(async () => ({
      queue: playlistItems.map((item) => {
        const episode = episodes.get(item.episodeId)!;
        const podcast = podcasts.find(
          (candidate) => candidate.id === episode.podcastId
        )!;
        return {
          ...episode,
          podcastTitle: podcast.title,
          podcastImageUrl: null,
          playback: playback.get(episode.id) ?? null,
        };
      }),
      activePlayback:
        activePlaybackEpisodeId === null
          ? null
          : {
              episodeId: activePlaybackEpisodeId,
              lastUpdated: "2026-05-22T09:05:00Z",
            },
    }));
    vi.spyOn(api.playback, "update").mockImplementation(async (payload) => ({
      playback: {
        episodeId: payload.episodeId,
        positionSeconds: payload.positionSeconds,
        lastUpdated: "2026-05-22T09:00:00Z",
      },
      nextEpisodeId: null,
    }));
    vi.spyOn(api.playback, "setActive").mockImplementation(async (episodeId) => {
      activePlaybackEpisodeId = episodeId;
      return {
        activePlayback: {
          episodeId,
          lastUpdated: "2026-05-22T09:05:00Z",
        },
      };
    });
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

  it("does not let an older queue response replace a newer one", async () => {
    renderPlaybackProvider();
    await waitFor(() => {
      expect(screen.getByTestId("loading")).toHaveTextContent("no");
    });

    const queue = playlistItems.map((item) => {
      const episode = episodes.get(item.episodeId)!;
      const podcast = podcasts.find(
        (candidate) => candidate.id === episode.podcastId
      )!;
      return {
        ...episode,
        podcastTitle: podcast.title,
        podcastImageUrl: null,
        playback: playback.get(episode.id) ?? null,
      };
    });
    const olderRequest = deferred<
      Awaited<ReturnType<typeof api.playback.queue>>
    >();
    const newerRequest = deferred<
      Awaited<ReturnType<typeof api.playback.queue>>
    >();
    const queueSpy = vi.mocked(api.playback.queue);
    queueSpy
      .mockReturnValueOnce(olderRequest.promise)
      .mockReturnValueOnce(newerRequest.promise);

    window.dispatchEvent(new Event("focus"));
    window.dispatchEvent(new Event("focus"));
    await waitFor(() => expect(queueSpy).toHaveBeenCalledTimes(3));

    await act(async () => {
      newerRequest.resolve({
        queue: queue.map((episode, index) =>
          index === 0 ? { ...episode, title: "Newest queue" } : episode
        ),
        activePlayback: null,
      });
    });
    expect(screen.getByTestId("current-title")).toHaveTextContent(
      "Newest queue"
    );

    await act(async () => {
      olderRequest.resolve({
        queue: queue.map((episode, index) =>
          index === 0 ? { ...episode, title: "Stale queue" } : episode
        ),
        activePlayback: null,
      });
    });
    expect(screen.getByTestId("current-title")).toHaveTextContent(
      "Newest queue"
    );
  });

  it("uses backend active playback from the queue without autoplay", async () => {
    vi.spyOn(api.playback, "queue").mockResolvedValueOnce({
      queue: playlistItems.map((item) => {
        const episode = episodes.get(item.episodeId)!;
        const podcast = podcasts.find(
          (candidate) => candidate.id === episode.podcastId
        )!;
        return {
          ...episode,
          podcastTitle: podcast.title,
          podcastImageUrl: null,
          playback: playback.get(episode.id) ?? null,
        };
      }),
      activePlayback: {
        episodeId: 2,
        lastUpdated: "2026-05-22T09:05:00Z",
      },
    });

    renderPlaybackProvider();

    await waitFor(() => {
      expect(screen.getByTestId("loading")).toHaveTextContent("no");
    });

    await waitFor(() => {
      expect(screen.getByTestId("current-title")).toHaveTextContent(
        "Second queued episode"
      );
      expect(screen.getByTestId("position")).toHaveTextContent("42");
    });
    expect(screen.getByTestId("playing")).toHaveTextContent("no");

    const audio = FakeAudio.first;
    expect(audio.src).toBe("");
  });

  it("loads the queue through one aggregated API request", async () => {
    const queueSpy = vi.spyOn(api.playback, "queue");
    const playlistSpy = vi.spyOn(api.playlist, "list");
    const podcastSpy = vi.spyOn(api.podcasts, "list");
    const episodeSpy = vi.spyOn(api.episodes, "get");

    renderPlaybackProvider();

    await waitFor(() => {
      expect(screen.getByTestId("loading")).toHaveTextContent("no");
    });

    expect(queueSpy).toHaveBeenCalledTimes(1);
    expect(playlistSpy).not.toHaveBeenCalled();
    expect(podcastSpy).not.toHaveBeenCalled();
    expect(episodeSpy).not.toHaveBeenCalled();
  });

  it("switches to the clicked queued episode and primes audio from its saved position", async () => {
    const user = userEvent.setup();
    const setActiveSpy = vi.spyOn(api.playback, "setActive");
    renderPlaybackProvider();

    await waitFor(() => {
      expect(screen.getByTestId("loading")).toHaveTextContent("no");
    });

    await user.click(screen.getByRole("button", { name: "Play second" }));

    const audio = FakeAudio.first;
    expect(audio).toBeDefined();
    expect(audio.src).toContain("/api/episodes/2/audio");
    expect(audio.currentTime).toBe(42);
    expect(audio.playImpl).toHaveBeenCalled();
    expect(setActiveSpy).toHaveBeenCalledWith(2);
    expect(screen.getByTestId("current-title")).toHaveTextContent("Second queued episode");
  });

  it("waits for metadata before seeking and playing a new source", async () => {
    const user = userEvent.setup();
    renderPlaybackProvider();

    await waitFor(() => {
      expect(screen.getByTestId("loading")).toHaveTextContent("no");
    });

    const audio = FakeAudio.first;
    audio.readyState = 0;
    await user.click(screen.getByRole("button", { name: "Play second" }));

    expect(audio.src).toContain("/api/episodes/2/audio");
    expect(audio.currentTime).toBe(0);
    expect(audio.playImpl).not.toHaveBeenCalled();

    audio.readyState = 1;
    audio.emit("loadedmetadata");

    await waitFor(() => {
      expect(audio.currentTime).toBe(42);
      expect(audio.playImpl).toHaveBeenCalledTimes(1);
    });
  });

  it("can prime playback for an episode that is not yet in the loaded queue", async () => {
    const user = userEvent.setup();
    renderPlaybackProvider();

    await waitFor(() => {
      expect(screen.getByTestId("loading")).toHaveTextContent("no");
    });

    await user.click(screen.getByRole("button", { name: "Play queued later" }));

    const audio = FakeAudio.first;
    expect(audio.src).toContain("/api/episodes/999/audio");
    expect(screen.getByTestId("playing")).toHaveTextContent("yes");
  });

  it("waits for metadata in the direct episode play path", async () => {
    const user = userEvent.setup();
    renderPlaybackProvider();

    await waitFor(() => {
      expect(screen.getByTestId("loading")).toHaveTextContent("no");
    });

    const audio = FakeAudio.first;
    audio.readyState = 0;
    await user.click(screen.getByRole("button", { name: "Play queued later" }));

    expect(audio.src).toContain("/api/episodes/999/audio");
    expect(audio.playImpl).not.toHaveBeenCalled();

    audio.readyState = 1;
    audio.emit("canplay");

    await waitFor(() => {
      expect(screen.getByTestId("playing")).toHaveTextContent("yes");
      expect(audio.playImpl).toHaveBeenCalledTimes(1);
    });
  });

  it("continues playback when a saved-position write is not supported", async () => {
    const user = userEvent.setup();
    renderPlaybackProvider();

    await waitFor(() => {
      expect(screen.getByTestId("loading")).toHaveTextContent("no");
    });

    const audio = FakeAudio.first;
    audio.throwOnCurrentTimeSet = true;
    await user.click(screen.getByRole("button", { name: "Play second" }));

    await waitFor(() => {
      expect(screen.getByTestId("playing")).toHaveTextContent("yes");
      expect(audio.playImpl).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByTestId("position")).toHaveTextContent("0");
  });

  it("surfaces user-initiated play failures and clears them on demand", async () => {
    const user = userEvent.setup();
    renderPlaybackProvider();

    await waitFor(() => {
      expect(screen.getByTestId("loading")).toHaveTextContent("no");
    });

    const audio = FakeAudio.first;
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

    const audio = FakeAudio.first;
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

    const audio = FakeAudio.first;
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

    const audio = FakeAudio.first;
    audio.currentTime = 120;

    await user.click(screen.getByRole("button", { name: "Forward" }));
    expect(audio.currentTime).toBe(150);

    await user.click(screen.getByRole("button", { name: "Backward" }));
    expect(audio.currentTime).toBe(135);

    await user.click(screen.getByRole("button", { name: "Seek exact" }));
    expect(audio.currentTime).toBe(333);

    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        episodeId: 1,
        completed: false,
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

    const audio = FakeAudio.first;
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
        completed: false,
      })
    );
  });

  it("reloads a newly downloaded source at the current position before resuming", async () => {
    const user = userEvent.setup();
    const downloadedEpisodeRequest = deferred<{ episode: Episode }>();
    const episodeSpy = vi.mocked(api.episodes.get);
    episodeSpy.mockReturnValueOnce(downloadedEpisodeRequest.promise);
    const updateSpy = vi.mocked(api.playback.update);

    renderPlaybackProvider();

    await waitFor(() => {
      expect(screen.getByTestId("loading")).toHaveTextContent("no");
    });

    await user.click(screen.getByRole("button", { name: "Toggle play" }));

    const audio = FakeAudio.first;
    await waitFor(() => {
      expect(screen.getByTestId("playing")).toHaveTextContent("yes");
      expect(episodeSpy).toHaveBeenCalledTimes(1);
    });

    const originalSource = audio.src;
    audio.currentTime = 237;
    audio.pauseImpl.mockClear();
    audio.playImpl.mockClear();

    await act(async () => {
      downloadedEpisodeRequest.resolve({
        episode: { ...episodes.get(1)!, downloaded: true },
      });
    });

    await waitFor(() => {
      expect(audio.pauseImpl).toHaveBeenCalledTimes(1);
      expect(audio.loadImpl).toHaveBeenCalledTimes(1);
    });
    expect(audio.src).toBe(originalSource);
    expect(screen.getByTestId("playing")).toHaveTextContent("yes");
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        episodeId: 1,
        positionSeconds: 237,
        completed: false,
      })
    );
    expect(audio.playImpl).not.toHaveBeenCalled();

    act(() => {
      audio.readyState = 1;
      audio.emit("loadedmetadata");
    });
    expect(audio.currentTime).toBe(237);
    expect(audio.playImpl).not.toHaveBeenCalled();

    act(() => {
      audio.readyState = 3;
      audio.emit("canplay");
    });

    await waitFor(() => {
      expect(audio.playImpl).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByTestId("position")).toHaveTextContent("237");
  });

  it("keeps system media controls and player state in sync after pausing", async () => {
    const user = userEvent.setup();
    const updateSpy = vi.spyOn(api.playback, "update");
    renderPlaybackProvider();

    await waitFor(() => {
      expect(screen.getByTestId("loading")).toHaveTextContent("no");
    });

    await user.click(screen.getByRole("button", { name: "Toggle play" }));

    const audio = FakeAudio.first;
    await waitFor(() => {
      expect(screen.getByTestId("playing")).toHaveTextContent("yes");
      expect(mediaSession.playbackState).toBe("playing");
    });

    audio.currentTime = 222;
    mediaSession.invoke("pause");
    audio.emit("pause");

    await waitFor(() => {
      expect(screen.getByTestId("playing")).toHaveTextContent("no");
      expect(mediaSession.playbackState).toBe("paused");
    });
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        episodeId: 1,
        positionSeconds: 222,
        completed: false,
      })
    );

    mediaSession.invoke("play");
    audio.emit("playing");

    await waitFor(() => {
      expect(screen.getByTestId("playing")).toHaveTextContent("yes");
      expect(mediaSession.playbackState).toBe("playing");
    });
    expect(audio.playImpl).toHaveBeenCalledTimes(2);
  });

  it("does not re-register Media Session action handlers on timeupdate", async () => {
    const user = userEvent.setup();
    renderPlaybackProvider();

    await waitFor(() => {
      expect(screen.getByTestId("loading")).toHaveTextContent("no");
    });

    await user.click(screen.getByRole("button", { name: "Toggle play" }));

    const audio = FakeAudio.first;
    await waitFor(() => {
      expect(screen.getByTestId("playing")).toHaveTextContent("yes");
    });

    mediaSession.setActionHandler.mockClear();

    for (let i = 1; i <= 3; i++) {
      audio.currentTime = i;
      audio.emit("timeupdate");

      await waitFor(() => {
        expect(screen.getByTestId("position")).toHaveTextContent(String(i));
      });
    }

    const playPauseCalls = mediaSession.setActionHandler.mock.calls.filter(
      (call) => call[0] === "play" || call[0] === "pause"
    );
    expect(playPauseCalls).toHaveLength(0);
  });

  it("syncs system media controls when browser events are delayed in the background", async () => {
    const user = userEvent.setup();
    const updateSpy = vi.spyOn(api.playback, "update");
    renderPlaybackProvider();

    await waitFor(() => {
      expect(screen.getByTestId("loading")).toHaveTextContent("no");
    });

    await user.click(screen.getByRole("button", { name: "Toggle play" }));
    const audio = FakeAudio.first;
    await waitFor(() => {
      expect(screen.getByTestId("playing")).toHaveTextContent("yes");
    });

    audio.currentTime = 222;
    mediaSession.invoke("pause");

    await waitFor(() => {
      expect(screen.getByTestId("playing")).toHaveTextContent("no");
      expect(mediaSession.playbackState).toBe("paused");
    });
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        episodeId: 1,
        positionSeconds: 222,
        completed: false,
      })
    );

    audio.playImpl.mockClear();
    mediaSession.invoke("play");

    await waitFor(() => {
      expect(screen.getByTestId("playing")).toHaveTextContent("yes");
      expect(mediaSession.playbackState).toBe("playing");
    });
    expect(audio.playImpl).toHaveBeenCalledTimes(1);
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

    const audio = FakeAudio.first;
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

  it("reloads the queue and active episode when an iOS-restored page is shown", async () => {
    renderPlaybackProvider();

    await waitFor(() => {
      expect(screen.getByTestId("loading")).toHaveTextContent("no");
    });

    const thirdEpisode = episodes.get(3)!;
    vi.mocked(api.playback.queue).mockResolvedValueOnce({
      queue: [
        ...playlistItems.map((item) => {
          const episode = episodes.get(item.episodeId)!;
          const podcast = podcasts.find(
            (candidate) => candidate.id === episode.podcastId
          )!;
          return {
            ...episode,
            podcastTitle: podcast.title,
            podcastImageUrl: null,
            playback: playback.get(episode.id) ?? null,
          };
        }),
        {
          ...thirdEpisode,
          podcastTitle: "Second Podcast",
          podcastImageUrl: null,
          playback: null,
        },
      ],
      activePlayback: {
        episodeId: thirdEpisode.id,
        lastUpdated: "2026-05-22T10:00:00Z",
      },
    });
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });

    window.dispatchEvent(
      Object.assign(new Event("pageshow"), { persisted: true })
    );

    await waitFor(() => {
      expect(screen.getByTestId("queue-size")).toHaveTextContent("3");
      expect(screen.getByTestId("current-title")).toHaveTextContent(
        "Third queued episode"
      );
    });
    expect(screen.getByTestId("playing")).toHaveTextContent("no");
  });

  it("does not replace an episode that is actively playing during visibility sync", async () => {
    const user = userEvent.setup();
    const queueSpy = vi.mocked(api.playback.queue);
    renderPlaybackProvider();

    await waitFor(() => {
      expect(screen.getByTestId("loading")).toHaveTextContent("no");
    });
    await user.click(screen.getByRole("button", { name: "Toggle play" }));
    await waitFor(() => {
      expect(screen.getByTestId("playing")).toHaveTextContent("yes");
    });

    activePlaybackEpisodeId = 2;
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    document.dispatchEvent(new Event("visibilitychange"));

    expect(queueSpy).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("current-title")).toHaveTextContent(
      "First queued episode"
    );
    expect(screen.getByTestId("playing")).toHaveTextContent("yes");
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

    const audio = FakeAudio.first;
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

    const audio = FakeAudio.first;
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

    const audio = FakeAudio.first;
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

    const audio = FakeAudio.first;
    audio.currentTime = 2400;
    audio.emit("ended");

    await waitFor(() => {
      expect(screen.getByTestId("current-title")).toHaveTextContent(
        "First queued episode"
      );
    });

    expect(audio.src).toContain("/api/episodes/1/audio");
    expect(audio.currentTime).toBe(15);
    await waitFor(() => {
      expect(screen.getByTestId("playing")).toHaveTextContent("yes");
    });
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        episodeId: 2,
        completed: true,
      })
    );
  });

  it("does not replay a finished final episode while backend fallback is pending", async () => {
    const user = userEvent.setup();
    const completion = deferred<Awaited<ReturnType<typeof api.playback.update>>>();
    const firstEpisode = episodes.get(1)!;
    const secondEpisode = episodes.get(2)!;
    const queueSpy = vi.mocked(api.playback.queue);
    queueSpy
      .mockResolvedValueOnce({
        queue: [
          {
            ...secondEpisode,
            podcastTitle: "Second Podcast",
            podcastImageUrl: null,
            playback: playback.get(2) ?? null,
          },
        ],
        activePlayback: {
          episodeId: 2,
          lastUpdated: "2026-05-22T09:05:00Z",
        },
      })
      .mockResolvedValueOnce({
        queue: [
          {
            ...firstEpisode,
            podcastTitle: "First Podcast",
            podcastImageUrl: null,
            playback: playback.get(1) ?? null,
          },
        ],
        activePlayback: null,
      });
    vi.mocked(api.playback.update).mockReturnValueOnce(completion.promise);

    renderPlaybackProvider();

    await waitFor(() => {
      expect(screen.getByTestId("current-title")).toHaveTextContent(
        "Second queued episode"
      );
    });
    await user.click(screen.getByRole("button", { name: "Toggle play" }));

    const audio = FakeAudio.first;
    audio.currentTime = 2400;
    audio.emit("ended");

    await waitFor(() => {
      expect(api.playback.update).toHaveBeenCalledWith(
        expect.objectContaining({ episodeId: 2, completed: true })
      );
      expect(screen.getByTestId("playing")).toHaveTextContent("no");
    });

    const playbackGetSpy = vi.mocked(api.playback.get);
    playbackGetSpy.mockClear();
    await user.click(screen.getByRole("button", { name: "Toggle play" }));
    expect(playbackGetSpy).not.toHaveBeenCalled();

    await act(async () => {
      completion.resolve({
        playback: {
          episodeId: 2,
          positionSeconds: 2400,
          lastUpdated: "2026-05-22T09:10:00Z",
        },
        nextEpisodeId: 1,
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId("current-title")).toHaveTextContent(
        "First queued episode"
      );
      expect(screen.getByTestId("playing")).toHaveTextContent("yes");
    });
  });

  it("starts a backend fallback from the refreshed queue when the loaded queue is stale", async () => {
    const user = userEvent.setup();
    const firstEpisode = episodes.get(1)!;
    const secondEpisode = episodes.get(2)!;
    const queueSpy = vi.mocked(api.playback.queue);
    queueSpy
      .mockResolvedValueOnce({
        queue: [
          {
            ...secondEpisode,
            podcastTitle: "Second Podcast",
            podcastImageUrl: null,
            playback: playback.get(2) ?? null,
          },
        ],
        activePlayback: {
          episodeId: 2,
          lastUpdated: "2026-05-22T09:05:00Z",
        },
      })
      .mockResolvedValueOnce({
        queue: [
          {
            ...firstEpisode,
            podcastTitle: "First Podcast",
            podcastImageUrl: null,
            playback: playback.get(1) ?? null,
          },
        ],
        activePlayback: null,
      });
    vi.mocked(api.playback.update).mockImplementation(async (payload) => ({
      playback: {
        episodeId: payload.episodeId,
        positionSeconds: payload.positionSeconds,
        lastUpdated: "2026-05-22T09:10:00Z",
      },
      nextEpisodeId:
        payload.episodeId === 2 && payload.completed ? 1 : null,
    }));

    renderPlaybackProvider();

    await waitFor(() => {
      expect(screen.getByTestId("current-title")).toHaveTextContent(
        "Second queued episode"
      );
    });
    await user.click(screen.getByRole("button", { name: "Toggle play" }));

    const audio = FakeAudio.first;
    audio.currentTime = 2400;
    audio.emit("ended");

    await waitFor(() => {
      expect(screen.getByTestId("current-title")).toHaveTextContent(
        "First queued episode"
      );
      expect(screen.getByTestId("playing")).toHaveTextContent("yes");
    });
    expect(queueSpy).toHaveBeenCalledTimes(2);
    expect(audio.src).toContain("/api/episodes/1/audio");
    expect(audio.currentTime).toBe(15);
  });

  it("uses the topmost backend-selected fallback instead of the nearest previous item", async () => {
    const user = userEvent.setup();
    const threeItemPlaylist = [
      ...playlistItems,
      {
        episodeId: 3,
        position: 3,
        episode: {
          id: 3,
          title: "Third queued episode",
          podcastId: 22,
          isListened: false,
          downloaded: false,
        },
      },
    ];

    vi.spyOn(api.playback, "queue").mockImplementation(async () => ({
      queue: threeItemPlaylist.map((item) => {
        const episode = episodes.get(item.episodeId)!;
        const podcast = podcasts.find(
          (candidate) => candidate.id === episode.podcastId
        )!;
        return {
          ...episode,
          podcastTitle: podcast.title,
          podcastImageUrl: null,
          playback: playback.get(episode.id) ?? null,
        };
      }),
      activePlayback: null,
    }));
    vi.spyOn(api.playback, "update").mockImplementation(async (payload) => ({
      playback: {
        episodeId: payload.episodeId,
        positionSeconds: payload.positionSeconds,
        lastUpdated: "2026-05-22T09:00:00Z",
      },
      nextEpisodeId:
        payload.episodeId === 3 && payload.completed ? 1 : null,
    }));

    renderPlaybackProvider();

    await waitFor(() => {
      expect(screen.getByTestId("queue-size")).toHaveTextContent("3");
    });

    await user.click(screen.getByRole("button", { name: "Play third" }));

    const audio = FakeAudio.first;
    audio.currentTime = 2700;
    audio.emit("ended");

    await waitFor(() => {
      expect(screen.getByTestId("current-title")).toHaveTextContent(
        "First queued episode"
      );
    });

    expect(audio.src).toContain("/api/episodes/1/audio");
    expect(audio.src).not.toContain("/api/episodes/2/audio");
    expect(audio.currentTime).toBe(15);
  });

  it("starts a backend-selected fallback at zero without playback state", async () => {
    const user = userEvent.setup();
    playback.set(1, null);
    vi.spyOn(api.playback, "update").mockImplementation(async (payload) => ({
      playback: {
        episodeId: payload.episodeId,
        positionSeconds: payload.positionSeconds,
        lastUpdated: "2026-05-22T09:00:00Z",
      },
      nextEpisodeId:
        payload.episodeId === 2 && payload.completed ? 1 : null,
    }));

    renderPlaybackProvider();

    await waitFor(() => {
      expect(screen.getByTestId("loading")).toHaveTextContent("no");
    });

    await user.click(screen.getByRole("button", { name: "Play second" }));

    const audio = FakeAudio.first;
    audio.currentTime = 2400;
    audio.emit("ended");

    await waitFor(() => {
      expect(screen.getByTestId("current-title")).toHaveTextContent(
        "First queued episode"
      );
    });

    expect(audio.src).toContain("/api/episodes/1/audio");
    expect(audio.currentTime).toBe(0);
    await waitFor(() => {
      expect(screen.getByTestId("playing")).toHaveTextContent("yes");
    });
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

    const audio = FakeAudio.first;
    const commitsBeforeTimeUpdate = dispatchHarnessProfilerCommits;

    audio.currentTime = 123;
    audio.emit("timeupdate");

    expect(dispatchHarnessProfilerCommits).toBe(commitsBeforeTimeUpdate);
  });
});
