import { Profiler } from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  api,
  type Episode,
  type PlaybackQueueEpisode,
  type Podcast,
  type PlaybackState,
} from "./api";
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
  onCurrentTimeSet: ((value: number) => void) | null = null;
  throwOnCurrentTimeSet = false;
  duration = 0;
  readyState = 1;
  playbackRate = 1;
  defaultPlaybackRate = 1;
  paused = true;
  ended = false;
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
    this.onCurrentTimeSet?.(value);
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
    this.ended = false;
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
    playQueueItem,
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
      <button
        type="button"
        onClick={() => {
          const item = queue.find((candidate) => candidate.id === 1);
          if (item) {
            playQueueItem(item);
          } else {
            playEpisode(1);
          }
        }}
      >
        Play first
      </button>
      <button
        type="button"
        onClick={() => {
          const item = queue.find((candidate) => candidate.id === 2);
          if (item) {
            playQueueItem(item);
          } else {
            playEpisode(2);
          }
        }}
      >
        Play second
      </button>
      <button
        type="button"
        onClick={() => {
          const item = queue.find((candidate) => candidate.id === 3);
          if (item) {
            playQueueItem(item);
          } else {
            playEpisode(3);
          }
        }}
      >
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
    vi.spyOn(api.playback, "get").mockImplementation(async (target) => ({
      playback:
        playback.get(
          "episodeId" in target ? target.episodeId : target.audiobookId
        ) ?? null,
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
        episodeId: payload.episodeId ?? 1,
        positionSeconds: payload.positionSeconds,
        lastUpdated: "2026-05-22T09:00:00Z",
      },
      nextEpisodeId: null,
    }));
    vi.spyOn(api.playback, "setActive").mockImplementation(async (target) => {
      const epId = typeof target === "number" ? target : (target.episodeId ?? 1);
      activePlaybackEpisodeId = epId;
      return {
        activePlayback: {
          episodeId: epId,
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

  it("selects an active audiobook when an episode has the same numeric id", async () => {
    vi.spyOn(api.playback, "queue").mockResolvedValueOnce({
      queue: [
        {
          id: 1,
          type: "episode",
          podcastId: 1,
          title: "Episode with id 1",
          podcastTitle: "Podcast",
          audioUrl: "/api/episodes/1/audio",
          duration: 100,
          downloaded: false,
          isListened: false,
          publishedAt: null,
          playback: null,
        },
        {
          id: 1,
          type: "audiobook",
          podcastId: 0,
          audiobookId: 1,
          trackId: 10,
          title: "Audiobook with id 1",
          podcastTitle: "Author",
          audioUrl: "/api/audiobooks/1/tracks/10/audio",
          duration: 200,
          downloaded: true,
          isListened: false,
          publishedAt: null,
          playback: null,
        },
      ],
      activePlayback: {
        audiobookId: 1,
        trackId: 10,
        lastUpdated: "2026-05-22T09:05:00Z",
      },
    });

    renderPlaybackProvider();

    await waitFor(() => {
      expect(screen.getByTestId("current-title")).toHaveTextContent(
        "Audiobook with id 1"
      );
    });
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

  it("maintains separate playback speeds for podcasts and audiobooks", async () => {
    const user = userEvent.setup();
    const updateSettingsSpy = vi.spyOn(api.settings, "update");

    vi.spyOn(api.playback, "queue").mockResolvedValueOnce({
      queue: [
        {
          id: 1,
          type: "episode",
          podcastId: 10,
          title: "Podcast Episode",
          podcastTitle: "Podcast",
          podcastImageUrl: null,
          audioUrl: "https://example.com/audio1.mp3",
          duration: 1800,
          downloaded: false,
          isListened: false,
          publishedAt: "2026-01-01T00:00:00Z",
          playback: null,
        },
        {
          id: 2,
          type: "audiobook",
          podcastId: 0,
          audiobookId: 99,
          title: "Audiobook Title",
          author: "Author",
          podcastTitle: "Author",
          podcastImageUrl: null,
          audioUrl: "/api/audiobooks/99/tracks/1/audio",
          duration: 3600,
          downloaded: true,
          isListened: false,
          publishedAt: "2026-01-01T00:00:00Z",
          playback: null,
        },
      ],
      activePlayback: null,
    });

    renderPlaybackProvider();

    await waitFor(() => {
      expect(screen.getByTestId("loading")).toHaveTextContent("no");
    });

    // Podcast episode defaults to 1.3x
    expect(screen.getByTestId("current-title")).toHaveTextContent("Podcast Episode");
    expect(screen.getByTestId("speed")).toHaveTextContent("Speed 1.3x");

    // Switch to audiobook -> should automatically use Speed 1x
    await user.click(screen.getByRole("button", { name: "Play second" }));
    await waitFor(() => {
      expect(screen.getByTestId("current-title")).toHaveTextContent("Audiobook Title");
    });
    expect(screen.getByTestId("speed")).toHaveTextContent("Speed 1x");

	// Audiobook speed is persisted independently from the podcast speed.
    await user.click(screen.getByRole("button", { name: "Speed 2x" }));
    expect(screen.getByTestId("speed")).toHaveTextContent("Speed 2x");
	expect(updateSettingsSpy).toHaveBeenCalledWith({
	  audiobookPlaybackSpeed: "Speed 2x",
	});

    // Switch back to podcast -> should restore podcast speed (Speed 1.3x)
    await user.click(screen.getByRole("button", { name: "Play first" }));
    await waitFor(() => {
      expect(screen.getByTestId("current-title")).toHaveTextContent("Podcast Episode");
    });
    expect(screen.getByTestId("speed")).toHaveTextContent("Speed 1.3x");
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
          episodeId: payload.episodeId ?? 1,
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

  it.each([
    ["podcast to podcast", "episode", "episode"],
    ["podcast to audiobook", "episode", "audiobook"],
    ["audiobook to podcast", "audiobook", "episode"],
    ["audiobook to another audiobook", "audiobook", "audiobook"],
  ] as const)(
    "starts and plays typed mixed fallback: %s",
    async (_name, sourceType, targetType) => {
      const user = userEvent.setup();
      const episodeItem = (
        id: number,
        title: string,
        positionSeconds: number
      ): PlaybackQueueEpisode => ({
        ...episodes.get(id)!,
        title,
        podcastTitle: `${title} podcast`,
        podcastImageUrl: null,
        playback: {
          episodeId: id,
          positionSeconds,
          lastUpdated: "2026-05-22T08:00:00Z",
        },
      });
      const audiobookItem = (
        audiobookId: number,
        trackId: number,
        title: string,
        positionSeconds: number
      ): PlaybackQueueEpisode => ({
        id: audiobookId,
        podcastId: 0,
        type: "audiobook",
        audiobookId,
        trackId,
        title,
        audioUrl: `/api/audiobooks/${audiobookId}/tracks/${trackId}/audio`,
        duration: 60,
        downloaded: true,
        isListened: false,
        publishedAt: null,
        podcastTitle: "Author",
        playback: {
          audiobookId,
          trackId,
          positionSeconds,
          lastUpdated: "2026-05-22T08:00:00Z",
        },
      });

      const target =
        targetType === "episode"
          ? episodeItem(1, "Fallback podcast", 17)
          : audiobookItem(200, 201, "Fallback audiobook", 17);
      const source =
        sourceType === "episode"
          ? episodeItem(2, "Finishing podcast", 0)
          : audiobookItem(100, 101, "Finishing audiobook", 0);
      vi.mocked(api.playback.queue)
        .mockResolvedValueOnce({ queue: [target, source], activePlayback: null })
        .mockResolvedValueOnce({ queue: [target], activePlayback: null });
      vi.mocked(api.playback.update).mockImplementation(async (payload) => ({
        playback:
          sourceType === "episode"
            ? {
                episodeId: source.id,
                positionSeconds: payload.positionSeconds,
                lastUpdated: "2026-05-22T09:00:00Z",
              }
            : {
                audiobookId: source.audiobookId,
                trackId: source.trackId,
                positionSeconds: payload.positionSeconds,
                lastUpdated: "2026-05-22T09:00:00Z",
              },
        nextTarget:
          targetType === "episode"
            ? { type: "episode", episodeId: target.id }
            : {
                type: "audiobook",
                audiobookId: target.audiobookId!,
                trackId: target.trackId!,
              },
        nextEpisodeId: targetType === "episode" ? target.id : null,
      }));

      function MixedFallbackHarness() {
        const { queue, currentEpisode, playing, playQueueItem } = usePlayback();
        return (
          <>
            <div data-testid="mixed-current">{currentEpisode?.title}</div>
            <div data-testid="mixed-playing">{playing ? "yes" : "no"}</div>
            <button
              type="button"
              onClick={() => {
                const item = queue[queue.length - 1];
                if (item) playQueueItem(item);
              }}
            >
              Play finishing item
            </button>
          </>
        );
      }

      render(
        <PlaybackProvider>
          <MixedFallbackHarness />
        </PlaybackProvider>
      );
      await waitFor(() =>
        expect(screen.getByTestId("mixed-current")).toHaveTextContent(
          target.title
        )
      );
      await user.click(
        screen.getByRole("button", { name: "Play finishing item" })
      );
      await waitFor(() =>
        expect(screen.getByTestId("mixed-current")).toHaveTextContent(
          source.title
        )
      );

      const audio = FakeAudio.first;
      audio.playImpl.mockClear();
      audio.currentTime = 60;
      audio.emit("ended");

      await waitFor(() =>
        expect(screen.getByTestId("mixed-current")).toHaveTextContent(
          target.title
        )
      );
      expect(audio.src).toContain(
        targetType === "episode"
          ? `/api/episodes/${target.id}/audio`
          : target.audioUrl
      );
      expect(audio.currentTime).toBe(17);
      await waitFor(() => {
        expect(screen.getByTestId("mixed-playing")).toHaveTextContent("yes");
        expect(audio.playImpl).toHaveBeenCalledTimes(1);
      });
    }
  );

  it("stops after final completion when backend returns no eligible target", async () => {
    const user = userEvent.setup();
    const finalEpisode = {
      ...episodes.get(2)!,
      podcastTitle: "Second Podcast",
      podcastImageUrl: null,
      playback: playback.get(2) ?? null,
    };
    const queueSpy = vi.mocked(api.playback.queue);
    queueSpy
      .mockResolvedValueOnce({ queue: [finalEpisode], activePlayback: null })
      .mockResolvedValueOnce({ queue: [], activePlayback: null });
    vi.mocked(api.playback.update).mockImplementation(async (payload) => ({
      playback: {
        episodeId: 2,
        positionSeconds: payload.positionSeconds,
        lastUpdated: "2026-05-22T09:00:00Z",
      },
      nextEpisodeId: null,
    }));

    renderPlaybackProvider();
    await waitFor(() =>
      expect(screen.getByTestId("current-title")).toHaveTextContent(
        "Second queued episode"
      )
    );
    await user.click(screen.getByRole("button", { name: "Toggle play" }));

    const audio = FakeAudio.first;
    audio.playImpl.mockClear();
    audio.currentTime = 2400;
    audio.emit("ended");

    await waitFor(() => expect(queueSpy).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId("playing")).toHaveTextContent("no");
    expect(audio.playImpl).not.toHaveBeenCalled();
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
        episodeId: payload.episodeId ?? 1,
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
        episodeId: payload.episodeId ?? 1,
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
        episodeId: payload.episodeId ?? 1,
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

  it("plays audiobook queue items using audiobook audio source url and saves track playback", async () => {
    const user = userEvent.setup();
    const updatePlaybackSpy = vi.spyOn(api.playback, "update").mockResolvedValue({
      playback: {
        episodeId: 100,
        positionSeconds: 150,
        lastUpdated: "2026-05-22T09:00:00Z",
      },
      nextEpisodeId: null,
    });
    const setActiveSpy = vi.spyOn(api.playback, "setActive").mockResolvedValue({
      activePlayback: {
        audiobookId: 100,
        trackId: 501,
        lastUpdated: "2026-05-22T09:00:00Z",
      },
    });

    vi.spyOn(api.playback, "queue").mockResolvedValue({
      queue: [
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
          podcastTitle: "First Podcast",
          playback: {
            episodeId: 1,
            positionSeconds: 15,
            lastUpdated: "2026-05-22T08:00:00Z",
          },
        },
        {
          id: 100,
          podcastId: 0,
          type: "audiobook",
          audiobookId: 100,
          trackId: 501,
          title: "Sample Audiobook",
          description: "",
          podcastTitle: "Sample Author",
          author: "Sample Author",
          audioUrl: "/api/audiobooks/100/tracks/501/audio",
          duration: 3600,
          downloaded: true,
          isListened: false,
          publishedAt: null,
          playback: {
            episodeId: 100,
            positionSeconds: 120,
            lastUpdated: "2026-05-22T08:00:00Z",
          },
        },
      ],
      activePlayback: {
        episodeId: 1,
        lastUpdated: "2026-05-22T08:00:00Z",
      },
    });

    function AudiobookHarness() {
      const { currentEpisode, queue, playQueueItem, playToggle } = usePlayback();
      return (
        <div>
          <div data-testid="current-title">{currentEpisode?.title}</div>
          <button
            type="button"
            onClick={() => {
              const item = queue.find(
                (candidate) => candidate.audiobookId === 100
              );
              if (item) playQueueItem(item);
            }}
          >
            Play audiobook
          </button>
          <button type="button" onClick={playToggle}>
            Pause
          </button>
        </div>
      );
    }

    render(
      <PlaybackProvider>
        <AudiobookHarness />
      </PlaybackProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("current-title")).toHaveTextContent("First queued episode");
    });

    await user.click(screen.getByRole("button", { name: "Play audiobook" }));

    const audio = FakeAudio.first;
    expect(audio.src).toContain("/api/audiobooks/100/tracks/501/audio");
    expect(setActiveSpy).toHaveBeenCalledWith({
      audiobookId: 100,
      trackId: 501,
    });

    audio.currentTime = 150;
    await user.click(screen.getByRole("button", { name: "Pause" }));

    expect(updatePlaybackSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        trackId: 501,
        positionSeconds: 150,
      })
    );
  });

  it("switches audiobook chapters and updates audio source url accordingly", async () => {
    const user = userEvent.setup();
    vi.spyOn(api.playback, "update").mockResolvedValue({
      playback: {
        episodeId: 100,
        positionSeconds: 200,
        lastUpdated: "2026-05-22T09:00:00Z",
      },
      nextEpisodeId: null,
    });

    let currentQueueItem = {
      id: 100,
      podcastId: 0,
      type: "audiobook" as const,
      audiobookId: 100,
      trackId: 501,
      trackNumber: 1,
      trackCount: 3,
      title: "Sample Audiobook",
      description: "",
      podcastTitle: "Sample Author",
      author: "Sample Author",
      audioUrl: "/api/audiobooks/100/tracks/501/audio",
      duration: 1800,
      downloaded: true,
      isListened: false,
      publishedAt: null,
      playback: {
        episodeId: 100,
        positionSeconds: 50,
        lastUpdated: "2026-05-22T08:00:00Z",
      },
    };

    vi.spyOn(api.playback, "queue").mockImplementation(async () => ({
      queue: [currentQueueItem],
      activePlayback: {
        audiobookId: 100,
        trackId: currentQueueItem.trackId,
        lastUpdated: "2026-05-22T08:00:00Z",
      },
    }));

    function MultiChapterHarness() {
      const { currentEpisode, queue, playQueueItem, playToggle } = usePlayback();
      const { reloadQueue } = usePlaybackDispatch();
      return (
        <div>
          <div data-testid="track-id">{currentEpisode?.trackId}</div>
          <button
            type="button"
            onClick={() => {
              const item = queue.find(
                (candidate) => candidate.audiobookId === 100
              );
              if (item) playQueueItem(item);
            }}
          >
            Play
          </button>
          <button
            type="button"
            onClick={async () => {
              currentQueueItem = {
                ...currentQueueItem,
                trackId: 502,
                trackNumber: 2,
                audioUrl: "/api/audiobooks/100/tracks/502/audio",
                playback: {
                  episodeId: 100,
                  positionSeconds: 0,
                  lastUpdated: "2026-05-22T08:05:00Z",
                },
              };
              await reloadQueue();
            }}
          >
            Change to Chapter 2
          </button>
          <button type="button" onClick={playToggle}>
            Toggle
          </button>
        </div>
      );
    }

    render(
      <PlaybackProvider>
        <MultiChapterHarness />
      </PlaybackProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("track-id")).toHaveTextContent("501");
    });

    await user.click(screen.getByRole("button", { name: "Play" }));

    const audio = FakeAudio.first;
    expect(audio.src).toContain("/api/audiobooks/100/tracks/501/audio");

    await user.click(screen.getByRole("button", { name: "Change to Chapter 2" }));
    // Trigger queue refresh
    await user.click(screen.getByRole("button", { name: "Play" }));

    await waitFor(() => {
      expect(screen.getByTestId("track-id")).toHaveTextContent("502");
    });

    expect(audio.src).toContain("/api/audiobooks/100/tracks/502/audio");
  });

  it("completes audiobook chapters and advances using the backend completion response", async () => {
    const user = userEvent.setup();
    const firstTrack = {
      id: 501,
      audiobookId: 100,
      trackNumber: 1,
      title: "Chapter 1",
      audioUrl: "/api/audiobooks/100/tracks/501/audio",
      duration: 100,
      downloaded: true,
      isListened: false,
      publishedAt: null,
      playback: { audiobookId: 100, trackId: 501, positionSeconds: 0, lastUpdated: "2026-05-22T08:00:00Z" },
    };
    const secondTrack = {
      ...firstTrack,
      id: 502,
      trackNumber: 2,
      title: "Chapter 2",
      audioUrl: "/api/audiobooks/100/tracks/502/audio",
      playback: { audiobookId: 100, trackId: 502, positionSeconds: 0, lastUpdated: "2026-05-22T08:00:00Z" },
    };
    let currentTrack = firstTrack;
    const queueSpy = vi.mocked(api.playback.queue).mockImplementation(async () => ({
      queue: [{
        id: 100,
        podcastId: 0,
        type: "audiobook" as const,
        audiobookId: 100,
        trackId: currentTrack.id,
        trackNumber: currentTrack.trackNumber,
        title: "Sample Audiobook",
        description: "",
        podcastTitle: "Sample Author",
        author: "Sample Author",
        audioUrl: currentTrack.audioUrl,
        duration: currentTrack.duration,
        downloaded: true,
        isListened: false,
        publishedAt: null,
        playback: currentTrack.playback,
      }],
      activePlayback: { audiobookId: 100, trackId: currentTrack.id, lastUpdated: "2026-05-22T08:00:00Z" },
    }))
      .mockImplementationOnce(async () => ({
        queue: [{
          id: 100, podcastId: 0, type: "audiobook" as const, audiobookId: 100,
          trackId: firstTrack.id, trackNumber: 1, title: "Sample Audiobook", description: "",
          podcastTitle: "Sample Author", author: "Sample Author", audioUrl: firstTrack.audioUrl,
          duration: 100, downloaded: true, isListened: false, publishedAt: null, playback: firstTrack.playback,
        }],
        activePlayback: { audiobookId: 100, trackId: firstTrack.id, lastUpdated: "2026-05-22T08:00:00Z" },
      }))
      .mockImplementationOnce(async () => {
        currentTrack = secondTrack;
        return {
          queue: [{
            id: 100, podcastId: 0, type: "audiobook" as const, audiobookId: 100,
            trackId: secondTrack.id, trackNumber: 2, title: "Sample Audiobook", description: "",
            podcastTitle: "Sample Author", author: "Sample Author", audioUrl: secondTrack.audioUrl,
            duration: 100, downloaded: true, isListened: false, publishedAt: null, playback: secondTrack.playback,
          }],
          activePlayback: { audiobookId: 100, trackId: secondTrack.id, lastUpdated: "2026-05-22T08:01:00Z" },
        };
      });
    const updateSpy = vi.mocked(api.playback.update).mockImplementation(async (payload) => ({
      playback: { audiobookId: 100, trackId: payload.trackId ?? 501, positionSeconds: payload.positionSeconds, lastUpdated: "2026-05-22T08:01:00Z" },
      nextTrackId: payload.trackId === firstTrack.id && payload.completed ? secondTrack.id : null,
      nextEpisodeId: null,
    }));

    function AudiobookCompletionHarness() {
      const { queue, playQueueItem, currentEpisode, playing } = usePlayback();
      return <>
        <div data-testid="current-title">{currentEpisode?.title}</div>
        <div data-testid="track-id">{currentEpisode?.trackId}</div>
        <div data-testid="playing">{playing ? "yes" : "no"}</div>
        <button
          type="button"
          onClick={() => {
            const item = queue[0];
            if (item) playQueueItem(item);
          }}
        >
          Play audiobook
        </button>
      </>;
    }

    render(<PlaybackProvider><AudiobookCompletionHarness /></PlaybackProvider>);
    await waitFor(() => expect(screen.getByTestId("track-id")).toHaveTextContent("501"));
    await user.click(screen.getByRole("button", { name: "Play audiobook" }));
    const audio = FakeAudio.first;
    audio.currentTime = 100;
    audio.emit("ended");

    await waitFor(() => expect(screen.getByTestId("track-id")).toHaveTextContent("502"));
    expect(audio.src).toContain("/api/audiobooks/100/tracks/502/audio");
    expect(updateSpy).toHaveBeenCalledWith(expect.objectContaining({ audiobookId: 100, trackId: 501, completed: true }));
    expect(queueSpy).toHaveBeenCalledTimes(2);
  });

  it("completes an audiobook from the media ended state before the ended event arrives", async () => {
    const user = userEvent.setup();
    const sendBeaconSpy = vi.fn(
      (url: string | URL, data?: BodyInit | null) => {
        void url;
        void data;
        return true;
      }
    );
    Object.defineProperty(navigator, "sendBeacon", {
      configurable: true,
      value: sendBeaconSpy,
    });
    let progressIntervalCallback: (() => void) | null = null;
    const originalSetInterval = window.setInterval.bind(window);
    vi.spyOn(window, "setInterval").mockImplementation((handler, timeout) => {
      if (timeout === 15_000 && typeof handler === "function") {
        progressIntervalCallback = handler;
      }
      return originalSetInterval(
        handler,
        timeout
      ) as unknown as ReturnType<typeof setInterval>;
    });
    const firstTrack = {
      id: 501,
      trackNumber: 1,
      audioUrl: "/api/audiobooks/100/tracks/501/audio",
      duration: 100,
      playback: {
        audiobookId: 100,
        trackId: 501,
        positionSeconds: 0,
        lastUpdated: "2026-05-22T08:00:00Z",
      },
    };
    const secondTrack = {
      ...firstTrack,
      id: 502,
      trackNumber: 2,
      audioUrl: "/api/audiobooks/100/tracks/502/audio",
      duration: 107,
      playback: {
        ...firstTrack.playback,
        trackId: 502,
        positionSeconds: 29,
      },
    };
    const followingEpisode = {
      ...episodes.get(1)!,
      podcastTitle: "First Podcast",
      podcastImageUrl: null,
      playback: playback.get(1) ?? null,
    };
    const firstCompletion =
      deferred<Awaited<ReturnType<typeof api.playback.update>>>();
    let completedTrackId: number | null = null;
    vi.mocked(api.playback.queue).mockImplementation(async () => {
      const track =
        completedTrackId === firstTrack.id
          ? secondTrack
          : completedTrackId === secondTrack.id
            ? null
            : firstTrack;
      return {
        queue: [
          ...(track
            ? [
                {
                  id: 100,
                  podcastId: 0,
                  type: "audiobook" as const,
                  audiobookId: 100,
                  trackId: track.id,
                  trackNumber: track.trackNumber,
                  trackCount: 2,
                  title: "Sample Audiobook",
                  description: "",
                  podcastTitle: "Sample Author",
                  author: "Sample Author",
                  audioUrl: track.audioUrl,
                  duration: track.duration,
                  downloaded: true,
                  isListened: false,
                  publishedAt: null,
                  playback: track.playback,
                },
              ]
            : []),
          followingEpisode,
        ],
        activePlayback: track
          ? {
              audiobookId: 100,
              trackId: track.id,
              lastUpdated: "2026-05-22T08:01:00Z",
            }
          : null,
      };
    });
    const updateSpy = vi
      .mocked(api.playback.update)
      .mockImplementation(async (payload) => {
        if (payload.completed) {
          completedTrackId = payload.trackId ?? null;
        }
        const response = {
          playback: {
            audiobookId: 100,
            trackId: payload.trackId ?? firstTrack.id,
            positionSeconds: payload.positionSeconds,
            lastUpdated: "2026-05-22T08:01:00Z",
          },
          nextTrackId:
            payload.completed && payload.trackId === firstTrack.id
              ? secondTrack.id
              : null,
          nextEpisodeId: null,
        };
        if (payload.completed && payload.trackId === firstTrack.id) {
          return firstCompletion.promise;
        }
        return response;
      });

    function NaturalCompletionHarness() {
      const { queue, currentEpisode, playing, playQueueItem } = usePlayback();
      return (
        <>
          <div data-testid="track-id">{currentEpisode?.trackId}</div>
          <div data-testid="current-title">{currentEpisode?.title}</div>
          <div data-testid="queue-size">{queue.length}</div>
          <div data-testid="playing">{playing ? "yes" : "no"}</div>
          <button
            type="button"
            onClick={() => {
              const item = queue[0];
              if (item) playQueueItem(item);
            }}
          >
            Play audiobook
          </button>
        </>
      );
    }

    render(
      <PlaybackProvider>
        <NaturalCompletionHarness />
      </PlaybackProvider>
    );
    await waitFor(() =>
      expect(screen.getByTestId("track-id")).toHaveTextContent("501")
    );
    await user.click(screen.getByRole("button", { name: "Play audiobook" }));
    await waitFor(() => expect(progressIntervalCallback).not.toBeNull());

    const audio = FakeAudio.first;
    audio.duration = 103;
    audio.currentTime = 102;
    audio.paused = true;
    audio.ended = false;
    audio.emit("pause");
    await waitFor(() =>
      expect(updateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          audiobookId: 100,
          trackId: 501,
          positionSeconds: 100,
          completed: false,
        })
      )
    );
    expect(
      updateSpy.mock.calls.filter(([payload]) => payload.completed)
    ).toHaveLength(0);

    audio.currentTime = 103;
    audio.ended = true;
    audio.emit("timeupdate");

    await waitFor(() =>
      expect(
        updateSpy.mock.calls.filter(
          ([payload]) =>
            payload.completed && payload.trackId === firstTrack.id
        )
      ).toHaveLength(1)
    );
    const completedSource = audio.src;
    audio.emit("ended");
    await act(async () => {
      await Promise.resolve();
    });
    expect(
      updateSpy.mock.calls.filter(
        ([payload]) =>
          payload.completed && payload.trackId === firstTrack.id
      )
    ).toHaveLength(1);
    expect(audio.src).toBe(completedSource);
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        audiobookId: 100,
        trackId: 501,
        positionSeconds: 103,
        durationSeconds: 103,
        completed: true,
      })
    );
    const firstCompletionCallIndex = updateSpy.mock.calls.findIndex(
      ([payload]) =>
        payload.completed && payload.trackId === firstTrack.id
    );
    (progressIntervalCallback as (() => void) | null)?.();
    window.dispatchEvent(new Event("pagehide"));
    await act(async () => {
      await Promise.resolve();
    });
    expect(
      updateSpy.mock.calls
        .slice(firstCompletionCallIndex + 1)
        .filter(
          ([payload]) =>
            !payload.completed && payload.trackId === firstTrack.id
        )
    ).toHaveLength(0);
    expect(sendBeaconSpy).not.toHaveBeenCalled();

    audio.onCurrentTimeSet = (value) => {
      if (value !== secondTrack.playback.positionSeconds) {
        return;
      }
      audio.onCurrentTimeSet = null;
      progressIntervalCallback?.();
      window.dispatchEvent(new Event("pagehide"));
    };
    await act(async () => {
      firstCompletion.resolve({
        playback: {
          audiobookId: 100,
          trackId: firstTrack.id,
          positionSeconds: 103,
          lastUpdated: "2026-05-22T08:01:00Z",
        },
        nextTrackId: secondTrack.id,
        nextEpisodeId: null,
      });
    });
    await waitFor(() =>
      expect(screen.getByTestId("track-id")).toHaveTextContent("502")
    );
    expect(audio.src).toContain("/api/audiobooks/100/tracks/502/audio");
    expect(api.playback.setActive).toHaveBeenCalledWith({
      audiobookId: 100,
      trackId: 502,
    });
    await waitFor(() =>
      expect(screen.getByTestId("playing")).toHaveTextContent("yes")
    );
    audio.emit("playing");

    const progressCallsAfterFirstCompletion = updateSpy.mock.calls
      .slice(firstCompletionCallIndex + 1)
      .map(([payload]) => payload)
      .filter((payload) => !payload.completed);
    expect(progressCallsAfterFirstCompletion).not.toContainEqual(
      expect.objectContaining({ trackId: firstTrack.id })
    );
    expect(progressCallsAfterFirstCompletion).toContainEqual(
      expect.objectContaining({
        audiobookId: 100,
        trackId: secondTrack.id,
        positionSeconds: secondTrack.playback.positionSeconds,
        durationSeconds: secondTrack.duration,
        completed: false,
      })
    );
    expect(sendBeaconSpy).toHaveBeenCalledTimes(1);
    const beaconBody = sendBeaconSpy.mock.calls[0]?.[1];
    expect(beaconBody).toBeInstanceOf(Blob);
    if (!(beaconBody instanceof Blob)) {
      throw new Error("Expected playback beacon body");
    }
    const beaconPayload = await new Promise<Record<string, unknown>>(
      (resolve, reject) => {
        const reader = new FileReader();
        reader.addEventListener("load", () => {
          resolve(JSON.parse(String(reader.result)) as Record<string, unknown>);
        });
        reader.addEventListener("error", () => reject(reader.error));
        reader.readAsText(beaconBody);
      }
    );
    expect(beaconPayload).toEqual(
      expect.objectContaining({
        audiobookId: 100,
        trackId: secondTrack.id,
        positionSeconds: secondTrack.playback.positionSeconds,
        durationSeconds: secondTrack.duration,
        completed: false,
      })
    );

    audio.duration = 107;
    audio.currentTime = 107;
    audio.paused = true;
    audio.ended = true;
    audio.emit("timeupdate");
    audio.emit("pause");

    await waitFor(() =>
      expect(
        updateSpy.mock.calls.filter(
          ([payload]) =>
            payload.completed && payload.trackId === secondTrack.id
        )
      ).toHaveLength(1)
    );
    await waitFor(() =>
      expect(screen.getByTestId("current-title")).toHaveTextContent(
        "First queued episode"
      )
    );
    expect(screen.getByTestId("queue-size")).toHaveTextContent("1");
    expect(audio.src).toContain("/api/episodes/1/audio");
    expect(api.playback.setActive).toHaveBeenCalledWith(1);
    await waitFor(() =>
      expect(screen.getByTestId("playing")).toHaveTextContent("yes")
    );
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        audiobookId: 100,
        trackId: 502,
        positionSeconds: 107,
        durationSeconds: 107,
        completed: true,
      })
    );
    expect(
      updateSpy.mock.calls.filter(
        ([payload]) =>
          payload.completed && payload.trackId === firstTrack.id
      )
    ).toHaveLength(1);
  });

  it("keeps a rejected audiobook completion locked until explicit replay", async () => {
    const user = userEvent.setup();
    const sendBeaconSpy = vi.fn(
      (url: string | URL, data?: BodyInit | null) => {
        void url;
        void data;
        return true;
      }
    );
    Object.defineProperty(navigator, "sendBeacon", {
      configurable: true,
      value: sendBeaconSpy,
    });
    let progressIntervalCallback: (() => void) | null = null;
    const originalSetInterval = window.setInterval.bind(window);
    vi.spyOn(window, "setInterval").mockImplementation((handler, timeout) => {
      if (timeout === 15_000 && typeof handler === "function") {
        progressIntervalCallback = handler;
      }
      return originalSetInterval(
        handler,
        timeout
      ) as unknown as ReturnType<typeof setInterval>;
    });
    const audiobookItem = {
      id: 100,
      podcastId: 0,
      type: "audiobook" as const,
      audiobookId: 100,
      trackId: 501,
      trackNumber: 1,
      trackCount: 1,
      title: "Sample Audiobook",
      description: "",
      podcastTitle: "Sample Author",
      author: "Sample Author",
      audioUrl: "/api/audiobooks/100/tracks/501/audio",
      duration: 100,
      downloaded: true,
      isListened: false,
      publishedAt: null,
      playback: {
        audiobookId: 100,
        trackId: 501,
        positionSeconds: 0,
        lastUpdated: "2026-05-22T08:00:00Z",
      },
    };
    vi.mocked(api.playback.queue).mockResolvedValue({
      queue: [audiobookItem],
      activePlayback: {
        audiobookId: 100,
        trackId: 501,
        lastUpdated: "2026-05-22T08:00:00Z",
      },
    });
    const updateSpy = vi
      .mocked(api.playback.update)
      .mockImplementation(async (payload) => {
        if (payload.completed) {
          throw new Error("completion rejected");
        }
        return {
          playback: {
            audiobookId: 100,
            trackId: payload.trackId ?? 501,
            positionSeconds: payload.positionSeconds,
            lastUpdated: "2026-05-22T08:01:00Z",
          },
          nextTrackId: null,
          nextEpisodeId: null,
        };
      });

    function RejectedCompletionHarness() {
      const { queue, currentEpisode, playQueueItem } = usePlayback();
      return (
        <>
          <div data-testid="rejected-track-id">{currentEpisode?.trackId}</div>
          <button
            type="button"
            onClick={() => {
              const item = queue[0];
              if (item) playQueueItem(item);
            }}
          >
            Replay rejected audiobook
          </button>
        </>
      );
    }

    render(
      <PlaybackProvider>
        <RejectedCompletionHarness />
      </PlaybackProvider>
    );
    await waitFor(() =>
      expect(screen.getByTestId("rejected-track-id")).toHaveTextContent("501")
    );
    await user.click(
      screen.getByRole("button", { name: "Replay rejected audiobook" })
    );
    await waitFor(() => expect(progressIntervalCallback).not.toBeNull());

    const audio = FakeAudio.first;
    audio.duration = 100;
    audio.currentTime = 100;
    audio.ended = true;
    audio.emit("timeupdate");
    await waitFor(() =>
      expect(
        updateSpy.mock.calls.filter(
          ([payload]) => payload.completed && payload.trackId === 501
        )
      ).toHaveLength(1)
    );

    (progressIntervalCallback as (() => void) | null)?.();
    window.dispatchEvent(new Event("pagehide"));
    await act(async () => {
      await Promise.resolve();
    });
    expect(
      updateSpy.mock.calls.filter(
        ([payload]) => !payload.completed && payload.trackId === 501
      )
    ).toHaveLength(0);
    expect(sendBeaconSpy).not.toHaveBeenCalled();

    await user.click(
      screen.getByRole("button", { name: "Replay rejected audiobook" })
    );
    audio.currentTime = 40;
    (progressIntervalCallback as (() => void) | null)?.();
    window.dispatchEvent(new Event("pagehide"));
    await waitFor(() =>
      expect(updateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          audiobookId: 100,
          trackId: 501,
          positionSeconds: 40,
          durationSeconds: 100,
          completed: false,
        })
      )
    );
    expect(sendBeaconSpy).toHaveBeenCalledTimes(1);
  });
});
