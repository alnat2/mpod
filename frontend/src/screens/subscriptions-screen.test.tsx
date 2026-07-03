import type { ReactNode, Ref, UIEventHandler } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { api, type Episode, type Podcast } from "@/lib/api";

import { SubscriptionsScreen } from "./subscriptions-screen";

const reloadQueueMock = vi.fn();

const defaultIntersectionObserver = globalThis.IntersectionObserver;

function setViewportMatch(matches: boolean) {
  globalThis.matchMedia = ((query: string) => ({
    matches,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as typeof globalThis.matchMedia;
}

function makeIntersectingObserver() {
  return class IntersectingObserver {
    root = null;
    rootMargin = "";
    scrollMargin = "";
    thresholds = [];

    constructor(
      private readonly callback: IntersectionObserverCallback
    ) {}

    disconnect() {}

    observe(target: Element) {
      this.callback(
        [
          {
            boundingClientRect: target.getBoundingClientRect(),
            intersectionRatio: 1,
            intersectionRect: target.getBoundingClientRect(),
            isIntersecting: true,
            rootBounds: null,
            target,
            time: 0,
          },
        ],
        this as unknown as IntersectionObserver
      );
    }

    takeRecords() {
      return [];
    }

    unobserve() {}
  };
}

vi.mock("@/lib/playback-context", () => ({
  usePlaybackDispatch: () => ({
    reloadQueue: reloadQueueMock,
  }),
}));

vi.mock("./add-podcast-modal", () => ({
  AddPodcastModal: () => null,
}));

const scheduleActionMock = vi.fn();
const undoActionMock = vi.fn();

vi.mock("./use-delayed-actions", () => ({
  useDelayedActions: () => ({
    pendingActions: [],
    scheduleAction: scheduleActionMock,
    undoAction: undoActionMock,
  }),
}));

vi.mock("@/components/mpod", () => ({
  AppShell: ({
    children,
  }: {
    children: ReactNode;
  }) => (
    <div>{children}</div>
  ),
  PodcastCard: ({
    title,
    onSelect,
    onRefresh,
    refreshing,
  }: {
    title: string;
    onSelect?: () => void;
    onRefresh?: () => void;
    refreshing?: boolean;
  }) => (
    <div>
      <button type="button" onClick={onSelect}>
        {title}
      </button>
      <button
        type="button"
        aria-label={`Refresh ${title}`}
        disabled={refreshing}
        onClick={onRefresh}
      >
        Refresh
      </button>
    </div>
  ),
  PlaylistQueue: ({
    children,
    summary,
    headerAction,
    bodyClassName,
    bodyRef,
    bodyOnScroll,
  }: {
    children: ReactNode;
    summary?: string;
    headerAction?: ReactNode;
    bodyClassName?: string;
    bodyRef?: Ref<HTMLDivElement>;
    bodyOnScroll?: UIEventHandler<HTMLDivElement>;
  }) => (
    <div>
      <div>{summary}</div>
      {headerAction}
      <div
        data-testid="playlist-queue-body"
        className={bodyClassName}
        ref={bodyRef}
        onScroll={bodyOnScroll}
      >
        {children}
      </div>
    </div>
  ),
  EpisodeRow: ({
    title,
    subtitle,
    showDragHandle,
    actions = [],
  }: {
    title: string;
    subtitle?: string;
    showDragHandle?: boolean;
    actions?: Array<{ label: string; onClick?: () => void }>;
  }) => (
    <div data-testid={`episode-row-${title}`}>
      {showDragHandle ? <span data-testid={`drag-handle-${title}`} /> : null}
      <span>{title}</span>
      {subtitle ? <span>{subtitle}</span> : null}
      {actions.map((action) => (
        <button
          key={action.label}
          type="button"
          aria-label={action.label}
          onClick={action.onClick}
        >
          {action.label}
        </button>
      ))}
    </div>
  ),
  ModalScreen: ({ children }: { children: ReactNode }) => (
    <div data-testid="modal">{children}</div>
  ),
  PageHeader: ({ title }: { title: string }) => <div>{title}</div>,
  ShowNotes: ({
    podcastTitle,
    episodeTitle,
    children,
    onClose,
  }: {
    podcastTitle: string;
    episodeTitle: string;
    children: ReactNode;
    onClose?: () => void;
  }) => (
    <div>
      <div>Show notes</div>
      <div>{podcastTitle} - {episodeTitle}</div>
      <div>{children}</div>
      <button type="button" onClick={onClose}>
        Close
      </button>
    </div>
  ),
}));

describe("SubscriptionsScreen", () => {
  const podcast: Podcast = {
    id: 1,
    title: "Build Your SaaS",
    rssUrl: "https://example.com/feed.xml",
    description: "Build in public",
    imageUrl: null,
    lastChecked: null,
    updateTime: null,
  };

  const baseEpisode: Episode = {
    id: 101,
    podcastId: 1,
    title: "QA reorder third",
    description: "Episode notes",
    showNotes: "Sanitized episode notes",
    audioUrl: "https://example.com/audio.mp3",
    duration: 900,
    downloaded: false,
    isListened: false,
    publishedAt: "2026-05-20T10:00:00Z",
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    reloadQueueMock.mockReset();
    scheduleActionMock.mockReset();
    undoActionMock.mockReset();
    setViewportMatch(false);
    globalThis.IntersectionObserver = defaultIntersectionObserver;

    vi.spyOn(api.podcasts, "list").mockResolvedValue({ podcasts: [podcast] });
    vi.spyOn(api.podcasts, "episodes").mockResolvedValue({
      episodes: [baseEpisode],
    });
    vi.spyOn(api.playlist, "list").mockResolvedValue({ items: [] });
  });

  it("renders the agreed action order for a plain episode", async () => {
    render(<SubscriptionsScreen />);

    const row = await screen.findByTestId("episode-row-QA reorder third");
    const buttons = Array.from(row.querySelectorAll("button")).map((button) =>
      button.getAttribute("aria-label")
    );

    expect(buttons).toEqual([
      "Download",
      "Add to playlist",
      "Show notes",
      "Mark as listened",
    ]);
    expect(screen.getByTestId("drag-handle-QA reorder third")).toBeInTheDocument();
    expect(row).not.toHaveTextContent("Build Your SaaS");
    expect(row).not.toHaveTextContent(podcast.title);
    expect(screen.getByText("1 podcast")).toBeInTheDocument();
    expect(screen.getByText("1 / 1 episodes")).toBeInTheDocument();
  });

  it("shows total podcasts and selected podcast total/unlistened episode counts", async () => {
    const secondPodcast: Podcast = {
      ...podcast,
      id: 2,
      title: "Second Show",
      rssUrl: "https://example.com/second.xml",
    };
    vi.spyOn(api.podcasts, "list").mockResolvedValue({
      podcasts: [podcast, secondPodcast],
    });
    vi.spyOn(api.podcasts, "episodes").mockImplementation((podcastId) =>
      Promise.resolve({
        episodes:
          podcastId === podcast.id
            ? [
                baseEpisode,
                { ...baseEpisode, id: 102, title: "Listened", isListened: true },
              ]
            : [{ ...baseEpisode, id: 201, podcastId: 2, title: "Second episode" }],
      })
    );

    render(<SubscriptionsScreen />);

    expect(await screen.findByText("2 podcasts")).toBeInTheDocument();
    expect(screen.getByText("2 / 1 episodes")).toBeInTheDocument();
    expect(screen.queryByText("Build Your SaaS episodes")).not.toBeInTheDocument();
  });

  it("keeps podcasts with playlist episodes visible in the default filtered view", async () => {
    const secondPodcast: Podcast = {
      ...podcast,
      id: 2,
      title: "Second Show",
      rssUrl: "https://example.com/second.xml",
    };
    const listenedPlaylistEpisode: Episode = {
      ...baseEpisode,
      isListened: true,
    };
    const secondEpisode: Episode = {
      ...baseEpisode,
      id: 201,
      podcastId: 2,
      title: "Second episode",
    };

    vi.spyOn(api.podcasts, "list").mockResolvedValue({
      podcasts: [podcast, secondPodcast],
    });
    vi.spyOn(api.podcasts, "episodes").mockImplementation((podcastId) =>
      Promise.resolve({
        episodes:
          podcastId === podcast.id ? [listenedPlaylistEpisode] : [secondEpisode],
      })
    );
    vi.spyOn(api.playlist, "list").mockResolvedValue({
      items: [
        {
          episodeId: listenedPlaylistEpisode.id,
          position: 1,
          episode: {
            id: listenedPlaylistEpisode.id,
            title: listenedPlaylistEpisode.title,
            podcastId: listenedPlaylistEpisode.podcastId,
            isListened: true,
            downloaded: false,
          },
        },
        {
          episodeId: secondEpisode.id,
          position: 2,
          episode: {
            id: secondEpisode.id,
            title: secondEpisode.title,
            podcastId: secondEpisode.podcastId,
            isListened: false,
            downloaded: false,
          },
        },
      ],
    });

    render(<SubscriptionsScreen />);

    expect(await screen.findByText("Build Your SaaS")).toBeInTheDocument();
    expect(screen.getByText("Second Show")).toBeInTheDocument();
    expect(screen.getByTestId("episode-row-QA reorder third")).toHaveTextContent(
      "In playlist"
    );
  });

  it("renders the state-based action variants", async () => {
    vi.spyOn(api.podcasts, "episodes").mockResolvedValue({
      episodes: [
        {
          ...baseEpisode,
          downloaded: true,
          isListened: true,
        },
      ],
    });
    vi.spyOn(api.playlist, "list").mockResolvedValue({
      items: [
        {
          episodeId: baseEpisode.id,
          position: 1,
          episode: {
            id: baseEpisode.id,
            title: baseEpisode.title,
            podcastId: baseEpisode.podcastId,
            isListened: true,
            downloaded: true,
          },
        },
      ],
    });

    render(<SubscriptionsScreen />);
    await userEvent.setup().click(
      await screen.findByRole("button", { name: "Show all" })
    );

    const row = await screen.findByTestId("episode-row-QA reorder third");
    const buttons = Array.from(row.querySelectorAll("button")).map((button) =>
      button.getAttribute("aria-label")
    );

    expect(buttons).toEqual([
      "Downloaded",
      "Remove from playlist",
      "Show notes",
      "Mark as unlistened",
    ]);
  });

  it("opens the show notes modal from the row action", async () => {
    const user = userEvent.setup();
    render(<SubscriptionsScreen />);

    await user.click(await screen.findByRole("button", { name: "Show notes" }));

    expect(await screen.findByTestId("modal")).toBeInTheDocument();
    expect(
      screen.getByText("Build Your SaaS - QA reorder third")
    ).toBeInTheDocument();
    expect(screen.getByText("Sanitized episode notes")).toBeInTheDocument();
    expect(screen.queryByText("Episode notes")).not.toBeInTheDocument();
  });

  it("opens show notes from a mobile carousel podcast that is not selected", async () => {
    const user = userEvent.setup();
    const secondPodcast: Podcast = {
      ...podcast,
      id: 2,
      title: "Second Show",
      rssUrl: "https://example.com/second.xml",
    };
    const secondEpisode: Episode = {
      ...baseEpisode,
      id: 201,
      podcastId: 2,
      title: "Second episode",
      description: "Second episode notes",
      showNotes: "Second sanitized notes",
    };

    setViewportMatch(true);
    globalThis.IntersectionObserver =
      makeIntersectingObserver() as unknown as typeof IntersectionObserver;
    vi.spyOn(api.podcasts, "list").mockResolvedValue({
      podcasts: [podcast, secondPodcast],
    });
    vi.spyOn(api.podcasts, "episodes").mockImplementation((podcastId) =>
      Promise.resolve({
        episodes: podcastId === secondPodcast.id ? [secondEpisode] : [baseEpisode],
      })
    );

    render(<SubscriptionsScreen />);

    const secondRow = await screen.findByTestId("episode-row-Second episode");
    await user.click(
      within(secondRow).getByRole("button", { name: "Show notes" })
    );

    expect(await screen.findByTestId("modal")).toBeInTheDocument();
    expect(screen.getByText("Second Show - Second episode")).toBeInTheDocument();
    expect(screen.getByText("Second sanitized notes")).toBeInTheDocument();
  });

  it("virtualizes long episode lists and renders more rows after scrolling", async () => {
    const manyEpisodes = Array.from({ length: 20 }, (_, index) => ({
      ...baseEpisode,
      id: baseEpisode.id + index,
      title: `Episode ${index + 1}`,
      publishedAt: `2026-05-${String(index + 1).padStart(2, "0")}T10:00:00Z`,
    }));

    vi.spyOn(api.podcasts, "episodes").mockResolvedValue({
      episodes: manyEpisodes,
    });

    render(<SubscriptionsScreen />);

    expect(await screen.findByTestId("episode-row-Episode 1")).toBeInTheDocument();
    expect(screen.getByTestId("episode-row-Episode 13")).toBeInTheDocument();
    expect(screen.queryByTestId("episode-row-Episode 20")).not.toBeInTheDocument();

    const body = screen.getByTestId("playlist-queue-body");
    Object.defineProperty(body, "scrollTop", {
      configurable: true,
      value: 1120,
      writable: true,
    });

    fireEvent.scroll(body);

    await waitFor(() => {
      expect(screen.getByTestId("episode-row-Episode 20")).toBeInTheDocument();
    });
  });

  it("keeps the mobile episode list vertically scrollable above the bottom nav", async () => {
    render(<SubscriptionsScreen />);

    const body = await screen.findByTestId("playlist-queue-body");

    expect(body).toHaveClass("overflow-y-auto", "pb-20", "md:pb-0");
    expect(body).not.toHaveClass("overflow-hidden");
  });

  it("adds an episode to the playlist from the row action", async () => {
    const user = userEvent.setup();
    const addSpy = vi.spyOn(api.playlist, "add").mockResolvedValue({ success: true });

    render(<SubscriptionsScreen />);

    await user.click(await screen.findByRole("button", { name: "Add to playlist" }));

    await waitFor(() => {
      expect(addSpy).toHaveBeenCalledWith(101);
    });
  });

  it("clears playlist state and reloads the playback queue after marking a playlist episode listened", async () => {
    const user = userEvent.setup();
    vi.spyOn(api.podcasts, "episodes")
      .mockResolvedValueOnce({ episodes: [baseEpisode] })
      .mockResolvedValue({ episodes: [{ ...baseEpisode, isListened: true }] });
    vi.spyOn(api.playlist, "list")
      .mockResolvedValueOnce({
        items: [
          {
            episodeId: baseEpisode.id,
            position: 1,
            episode: {
              id: baseEpisode.id,
              title: baseEpisode.title,
              podcastId: baseEpisode.podcastId,
              isListened: false,
              downloaded: false,
            },
          },
        ],
      })
      .mockResolvedValue({ items: [] });
    const setListenedSpy = vi.spyOn(api.episodes, "setListened").mockResolvedValue({
      episode: {
        id: baseEpisode.id,
        isListened: true,
      },
    });

    render(<SubscriptionsScreen />);

    await user.click(await screen.findByRole("button", { name: "Show all" }));
    const row = await screen.findByTestId("episode-row-QA reorder third");
    expect(
      within(row).getByRole("button", { name: "Remove from playlist" })
    ).toBeInTheDocument();

    await user.click(
      within(row).getByRole("button", { name: "Mark as listened" })
    );

    await waitFor(() => {
      expect(setListenedSpy).toHaveBeenCalledWith(baseEpisode.id, true);
    });
    await waitFor(() => {
      expect(reloadQueueMock).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(
        within(row).getByRole("button", { name: "Add to playlist" })
      ).toBeInTheDocument();
    });
    expect(
      within(row).getByRole("button", { name: "Mark as unlistened" })
    ).toBeInTheDocument();
  });

  it("keeps the page content visible while reconciling after mark listened", async () => {
    const user = userEvent.setup();
    const listSpy = vi.spyOn(api.podcasts, "list");
    listSpy.mockResolvedValueOnce({ podcasts: [podcast] });
    listSpy.mockReturnValueOnce(new Promise(() => {}));
    const setListenedSpy = vi.spyOn(api.episodes, "setListened").mockResolvedValue({
      episode: {
        id: baseEpisode.id,
        isListened: true,
      },
    });

    render(<SubscriptionsScreen />);

    await user.click(await screen.findByRole("button", { name: "Mark as listened" }));

    await waitFor(() => {
      expect(setListenedSpy).toHaveBeenCalledWith(baseEpisode.id, true);
    });
    await waitFor(() => {
      expect(listSpy).toHaveBeenCalledTimes(2);
    });

    expect(screen.queryByText("Loading subscriptions")).not.toBeInTheDocument();
    expect(screen.getByText("No unlistened podcasts")).toBeInTheDocument();
  });

  it("shows the no-subscriptions empty state without refresh controls", async () => {
    vi.spyOn(api.podcasts, "list").mockResolvedValue({ podcasts: [] });
    const episodesSpy = vi.spyOn(api.podcasts, "episodes");

    render(<SubscriptionsScreen />);

    expect(await screen.findByText("No podcasts")).toBeInTheDocument();
    expect(screen.getByText("No podcasts yet")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add RSS feed" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Import OPML" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Refresh all" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Show all" })).not.toBeInTheDocument();
    expect(episodesSpy).not.toHaveBeenCalled();
  });

  it("shows the all-caught-up state when subscriptions have no unlistened episodes", async () => {
    const user = userEvent.setup();
    vi.spyOn(api.podcasts, "episodes").mockResolvedValue({
      episodes: [{ ...baseEpisode, isListened: true }],
    });

    render(<SubscriptionsScreen />);

    expect(await screen.findByText("No unlistened podcasts")).toBeInTheDocument();
    expect(screen.getByText("1 podcast")).toBeInTheDocument();
    expect(screen.getByText("All caught up")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add RSS feed" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Import OPML" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Show all" }));

    expect(await screen.findByTestId("episode-row-QA reorder third")).toBeInTheDocument();
  });

  it("disables Refresh all while a refresh is in progress", async () => {
    const user = userEvent.setup();
    let resolveRefresh!: () => void;
    const refreshPromise = new Promise<void>((resolve) => {
      resolveRefresh = resolve;
    });
    const refreshSpy = vi
      .spyOn(api.podcasts, "refreshAll")
      .mockReturnValue(refreshPromise.then(() => ({ success: true })));

    render(<SubscriptionsScreen />);

    const refreshButton = await screen.findByRole("button", {
      name: "Refresh all",
    });
    await user.click(refreshButton);

    expect(refreshSpy).toHaveBeenCalledTimes(1);
    expect(refreshButton).toBeDisabled();

    await user.click(refreshButton);
    expect(refreshSpy).toHaveBeenCalledTimes(1);

    resolveRefresh();

    await waitFor(() => {
      expect(refreshButton).not.toBeDisabled();
    });
  });

  it("disables a podcast Refresh button while that refresh is in progress", async () => {
    const user = userEvent.setup();
    let resolveRefresh!: () => void;
    const refreshPromise = new Promise<void>((resolve) => {
      resolveRefresh = resolve;
    });
    const refreshSpy = vi
      .spyOn(api.podcasts, "refresh")
      .mockReturnValue(
        refreshPromise.then(() => ({
          success: true,
          newEpisodes: 0,
          lastChecked: "2026-05-27T10:00:00Z",
        }))
      );

    render(<SubscriptionsScreen />);

    const refreshButton = await screen.findByRole("button", {
      name: "Refresh Build Your SaaS",
    });
    await user.click(refreshButton);

    expect(refreshSpy).toHaveBeenCalledWith(1);
    expect(refreshButton).toBeDisabled();

    await user.click(refreshButton);
    expect(refreshSpy).toHaveBeenCalledTimes(1);

    resolveRefresh();

    await waitFor(() => {
      expect(refreshButton).not.toBeDisabled();
    });
  });
});
