import { MemoryRouter } from "react-router-dom";
import type { ComponentProps, ReactNode } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api, type PlaybackQueueResponse, type PlaybackState } from "@/lib/api";
import { PlaybackProvider } from "@/lib/playback-context";
import { TooltipProvider } from "@/components/ui/tooltip";
import { HomeScreen } from "./home-screen";

vi.unmock("@/lib/playback-context");
vi.unmock("@/components/mpod");

let episodeRowRenderCount = 0;

vi.mock("@/components/mpod/episode-row", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/mpod/episode-row")>();
  const ActualEpisodeRow = actual.EpisodeRow;
  return {
    ...actual,
    EpisodeRow: (props: ComponentProps<typeof ActualEpisodeRow>) => {
      episodeRowRenderCount += 1;
      return <ActualEpisodeRow {...props} />;
    },
  };
});

vi.mock("@/components/mpod/modal-screen", () => ({
  ModalScreen: ({ children, title }: { children: ReactNode; title: string }) => (
    <div data-testid="modal-screen" aria-label={title}>
      {children}
    </div>
  ),
}));

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

let mediaSession: FakeMediaSession;

const initialQueueResponse: PlaybackQueueResponse = {
  queue: [
    {
      id: 1,
      podcastId: 11,
      title: "First queued episode",
      description: "First notes",
      showNotes: "First notes",
      audioUrl: "https://example.com/1.mp3",
      duration: 1800,
      downloaded: true,
      isListened: false,
      publishedAt: "2026-05-10T10:00:00Z",
      podcastTitle: "Queue Podcast",
      podcastImageUrl: null,
      playback: {
        episodeId: 1,
        positionSeconds: 15,
        lastUpdated: "2026-05-22T08:00:00Z",
      },
    },
    {
      id: 2,
      podcastId: 22,
      title: "Second queued episode",
      description: "Second notes",
      showNotes: "Second notes",
      audioUrl: "https://example.com/2.mp3",
      duration: 2400,
      downloaded: false,
      isListened: false,
      publishedAt: "2026-05-11T10:00:00Z",
      podcastTitle: "Second Podcast",
      podcastImageUrl: null,
      playback: null,
    },
  ],
  activePlayback: {
    episodeId: 1,
    lastUpdated: "2026-05-22T08:00:00Z",
  },
};

describe("HomeScreen Playback Integration", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    FakeAudio.instances = [];
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

    episodeRowRenderCount = 0;

    vi.spyOn(api.playback, "queue").mockResolvedValue(initialQueueResponse);
    vi.spyOn(api.settings, "get").mockResolvedValue({
      settings: {
        dailyRefreshTime: "06:00",
        playbackSpeed: "Speed 1.3x",
        audiobookPlaybackSpeed: "Speed 1x",
        proxyEnabled: false,
        proxyConfigured: false,
        appBuild: "test",
      },
    });
    vi.spyOn(api.playback, "get").mockResolvedValue({
      playback: initialQueueResponse.queue[0]!.playback,
    });
    vi.spyOn(api.playback, "update").mockResolvedValue({
      playback: initialQueueResponse.queue[0]!.playback!,
      nextEpisodeId: null,
    });
    vi.spyOn(api.playback, "setActive").mockResolvedValue({
      activePlayback: initialQueueResponse.activePlayback!,
    });
  });

  it("does not re-render HomeScreen or queue rows during timeupdate position changes on desktop", async () => {
    render(
      <MemoryRouter>
        <TooltipProvider>
          <PlaybackProvider>
            <HomeScreen />
          </PlaybackProvider>
        </TooltipProvider>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.queryByText("Loading playlist")).not.toBeInTheDocument();
    });
    expect(screen.getAllByText("First queued episode")).toHaveLength(2);
    expect(screen.getByText("Second queued episode")).toBeInTheDocument();
    expect(screen.getByText("0:15")).toBeInTheDocument();

    const audio = FakeAudio.first;
    expect(audio).toBeDefined();

    // Flush any pending React microtasks/effects after initial load
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    const rendersAfterLoad = episodeRowRenderCount;
    expect(rendersAfterLoad).toBeGreaterThan(0);

    // Send multiple timeupdate events with changed position inside await act
    await act(async () => {
      audio.currentTime = 30;
      audio.emit("timeupdate");
    });
    expect(await screen.findByText("0:30")).toBeInTheDocument();

    await act(async () => {
      audio.currentTime = 45;
      audio.emit("timeupdate");
    });
    expect(await screen.findByText("0:45")).toBeInTheDocument();

    await act(async () => {
      audio.currentTime = 60;
      audio.emit("timeupdate");
    });
    expect(await screen.findByText("1:00")).toBeInTheDocument();

    // Queue rows must NOT have re-rendered at all during position timeupdates
    expect(episodeRowRenderCount).toBe(rendersAfterLoad);
  });

  it("does not re-render HomeScreen or queue rows during timeupdate position changes on mobile", async () => {
    // Simulate mobile layout by setting innerWidth
    window.innerWidth = 375;
    window.dispatchEvent(new Event("resize"));

    render(
      <MemoryRouter>
        <TooltipProvider>
          <PlaybackProvider>
            <HomeScreen />
          </PlaybackProvider>
        </TooltipProvider>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.queryByText("Loading playlist")).not.toBeInTheDocument();
    });
    expect(screen.getAllByText("First queued episode")).toHaveLength(2);
    expect(screen.getByText("Second queued episode")).toBeInTheDocument();
    expect(screen.getByText("0:15")).toBeInTheDocument();

    const audio = FakeAudio.first;
    expect(audio).toBeDefined();

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    const rendersAfterLoad = episodeRowRenderCount;
    expect(rendersAfterLoad).toBeGreaterThan(0);

    await act(async () => {
      audio.currentTime = 75;
      audio.emit("timeupdate");
    });
    expect(await screen.findByText("1:15")).toBeInTheDocument();

    await act(async () => {
      audio.currentTime = 90;
      audio.emit("timeupdate");
    });
    expect(await screen.findByText("1:30")).toBeInTheDocument();

    expect(episodeRowRenderCount).toBe(rendersAfterLoad);

    // Reset window width
    window.innerWidth = 1024;
    window.dispatchEvent(new Event("resize"));
  });

  it("uses playback duration fallback when library duration is unknown without re-rendering queue rows on progress", async () => {
    const audiobookQueueResponse: PlaybackQueueResponse = {
      queue: [
        {
          id: 5,
          podcastId: 0,
          type: "audiobook",
          audiobookId: 5,
          trackId: 51,
          trackCount: 2,
          hasChapters: true,
          title: "Chapter 1",
          author: "Author Name",
          podcastTitle: "Author Name",
          audioUrl: "/api/audiobooks/5/tracks/51/audio",
          duration: 0, // Unknown in library
          downloaded: true,
          isListened: false,
          publishedAt: null,
          playback: {
            audiobookId: 5,
            trackId: 51,
            positionSeconds: 0,
            lastUpdated: "2026-05-22T08:00:00Z",
          },
        },
      ],
      activePlayback: {
        audiobookId: 5,
        trackId: 51,
        lastUpdated: "2026-05-22T08:00:00Z",
      },
    };

    vi.spyOn(api.playback, "queue").mockResolvedValue(audiobookQueueResponse);
    vi.spyOn(api.playback, "get").mockResolvedValue({
      playback: audiobookQueueResponse.queue[0]!.playback,
    });
    vi.spyOn(api.playback, "setActive").mockResolvedValue({
      activePlayback: audiobookQueueResponse.activePlayback!,
    });
    vi.spyOn(api.audiobooks, "get").mockImplementation(async () => {
      return {
        audiobook: {
          id: 5,
          title: "Test Audiobook",
          author: "Author Name",
          relPath: "author/book",
          totalDuration: 3600,
          trackCount: 2,
          listenedCount: 0,
          isListened: false,
          positionSeconds: 0,
          createdAt: "2026-01-01T00:00:00Z",
          updatedAt: "2026-01-01T00:00:00Z",
          hasCover: false,
          hasChapters: true,
          tracks: [
            {
              id: 51,
              audiobookId: 5,
              trackNumber: 1,
              title: "Chapter 1",
              relPath: "1.mp3",
              filePath: "/1.mp3",
              duration: 0,
              inPlaylist: true,
              isListened: false,
              positionSeconds: 0,
            },
            {
              id: 52,
              audiobookId: 5,
              trackNumber: 2,
              title: "Chapter 2",
              relPath: "2.mp3",
              filePath: "/2.mp3",
              duration: 3600,
              inPlaylist: true,
              isListened: false,
              positionSeconds: 0,
            },
          ],
        },
      };
    });

    render(
      <MemoryRouter>
        <TooltipProvider>
          <PlaybackProvider>
            <HomeScreen />
          </PlaybackProvider>
        </TooltipProvider>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.queryByText("Loading playlist")).not.toBeInTheDocument();
    });
    expect(screen.getAllByText("Chapter 1")).toHaveLength(2);
    const audio = FakeAudio.first;
    expect(audio).toBeDefined();

    // Audio duration becomes available via loadedmetadata from playback
    await act(async () => {
      audio.duration = 4500; // 1h 15m
      audio.emit("loadedmetadata");
    });

    // Open chapters modal
    const chaptersButtons = await screen.findAllByRole("button", { name: "Show chapters" });
    const chaptersButton = chaptersButtons[0]!;
    fireEvent.click(chaptersButton);

    await waitFor(() => {
      expect(screen.getByText("Test Audiobook")).toBeInTheDocument();
    });
    expect(await screen.findByText("1h 15m")).toBeInTheDocument();

    const rendersBeforeTimeUpdate = episodeRowRenderCount;

    await act(async () => {
      audio.currentTime = 120;
      audio.emit("timeupdate");
    });

    // Queue rows must not re-render due to timeupdate ticks
    expect(episodeRowRenderCount).toBe(rendersBeforeTimeUpdate);
  });
});
