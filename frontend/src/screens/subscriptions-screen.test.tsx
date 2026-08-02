import { useState, type ReactNode, type Ref, type UIEventHandler } from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { api, type Episode, type Podcast } from "@/lib/api";
import { SubscriptionsCacheProvider } from "@/lib/subscriptions-cache-provider";

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

function renderSubscriptionsScreen() {
  return render(
    <SubscriptionsCacheProvider>
      <SubscriptionsScreen />
    </SubscriptionsCacheProvider>
  );
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });

  return { promise, resolve };
}

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
    vi.useRealTimers();
    vi.restoreAllMocks();
    reloadQueueMock.mockReset();
    scheduleActionMock.mockReset();
    undoActionMock.mockReset();
    setViewportMatch(false);
    globalThis.IntersectionObserver = defaultIntersectionObserver;

    vi.spyOn(api.podcasts, "list").mockResolvedValue({ podcasts: [podcast] });
    vi.spyOn(api.episodes, "list").mockResolvedValue({
      episodes: [baseEpisode],
    });
    vi.spyOn(api.playlist, "list").mockResolvedValue({ items: [] });
  });

  it("does not show an empty-library heading during the first load", async () => {
    const podcastsRequest = deferred<Awaited<ReturnType<typeof api.podcasts.list>>>();
    const episodesRequest = deferred<Awaited<ReturnType<typeof api.episodes.list>>>();
    const playlistRequest = deferred<Awaited<ReturnType<typeof api.playlist.list>>>();
    vi.spyOn(api.podcasts, "list").mockReturnValue(podcastsRequest.promise);
    vi.spyOn(api.episodes, "list").mockReturnValue(episodesRequest.promise);
    vi.spyOn(api.playlist, "list").mockReturnValue(playlistRequest.promise);

    renderSubscriptionsScreen();

    expect(screen.getByText("Subscriptions")).toBeInTheDocument();
    expect(screen.getByText("Loading your podcast library.")).toBeInTheDocument();
    expect(screen.getByLabelText("Loading subscriptions")).toBeInTheDocument();
    expect(screen.queryByText("No podcasts")).not.toBeInTheDocument();
    expect(screen.queryByText("No podcasts yet")).not.toBeInTheDocument();

    await act(async () => {
      podcastsRequest.resolve({ podcasts: [podcast] });
      episodesRequest.resolve({ episodes: [baseEpisode] });
      playlistRequest.resolve({ items: [] });
    });

    expect(
      await screen.findByText("1 podcast · 1 with unlistened")
    ).toBeInTheDocument();
  });

  it("shows cached subscriptions immediately while remount revalidates them", async () => {
    const podcastsRequest = deferred<Awaited<ReturnType<typeof api.podcasts.list>>>();
    const episodesRequest = deferred<Awaited<ReturnType<typeof api.episodes.list>>>();
    const playlistRequest = deferred<Awaited<ReturnType<typeof api.playlist.list>>>();
    vi.spyOn(api.podcasts, "list")
      .mockResolvedValueOnce({ podcasts: [podcast] })
      .mockReturnValue(podcastsRequest.promise);
    vi.spyOn(api.episodes, "list")
      .mockResolvedValueOnce({
        episodes: [{ ...baseEpisode, isListened: true }],
      })
      .mockReturnValue(episodesRequest.promise);
    vi.spyOn(api.playlist, "list")
      .mockResolvedValueOnce({ items: [] })
      .mockReturnValue(playlistRequest.promise);

    function CacheHarness() {
      const [visible, setVisible] = useState(true);

      return (
        <>
          <button type="button" onClick={() => setVisible((current) => !current)}>
            Toggle subscriptions
          </button>
          {visible ? <SubscriptionsScreen /> : null}
        </>
      );
    }

    const user = userEvent.setup();
    render(
      <SubscriptionsCacheProvider>
        <CacheHarness />
      </SubscriptionsCacheProvider>
    );

    await user.click(
      await screen.findByRole("button", { name: "Show all" })
    );
    expect(
      await screen.findByTestId("episode-row-QA reorder third")
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Toggle subscriptions" })
    );
    await user.click(
      screen.getByRole("button", { name: "Toggle subscriptions" })
    );

    expect(screen.getByTestId("episode-row-QA reorder third")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Show unlistened" })
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Loading subscriptions")).not.toBeInTheDocument();
    expect(screen.queryByText("No podcasts")).not.toBeInTheDocument();

    await act(async () => {
      podcastsRequest.resolve({
        podcasts: [{ ...podcast, title: "Updated Build Your SaaS" }],
      });
      episodesRequest.resolve({
        episodes: [
          { ...baseEpisode, title: "Updated episode", isListened: true },
        ],
      });
      playlistRequest.resolve({ items: [] });
    });

    expect(await screen.findByText("Updated Build Your SaaS")).toBeInTheDocument();
    expect(
      await screen.findByTestId("episode-row-Updated episode")
    ).toBeInTheDocument();
  });

  it("renders the agreed action order for a plain episode", async () => {
    const perPodcastEpisodesSpy = vi.spyOn(api.podcasts, "episodes");

    renderSubscriptionsScreen();

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
    expect(screen.queryByTestId("drag-handle-QA reorder third")).not.toBeInTheDocument();
    expect(row).not.toHaveTextContent("Build Your SaaS");
    expect(row).not.toHaveTextContent(podcast.title);
    expect(
      screen.getByText("1 podcast · 1 with unlistened")
    ).toBeInTheDocument();
    expect(screen.getByText("1 / 1 episodes")).toBeInTheDocument();
    expect(perPodcastEpisodesSpy).not.toHaveBeenCalled();
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
    vi.spyOn(api.episodes, "list").mockResolvedValue({
      episodes: [
        baseEpisode,
        { ...baseEpisode, id: 102, title: "Listened", isListened: true },
        {
          ...baseEpisode,
          id: 201,
          podcastId: 2,
          title: "Second episode",
          isListened: true,
        },
      ],
    });

    renderSubscriptionsScreen();

    expect(
      await screen.findByText("2 podcasts · 1 with unlistened")
    ).toBeInTheDocument();
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
    vi.spyOn(api.episodes, "list").mockResolvedValue({
      episodes: [listenedPlaylistEpisode, secondEpisode],
    });
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

    renderSubscriptionsScreen();

    expect(await screen.findByText("Build Your SaaS")).toBeInTheDocument();
    expect(screen.getByText("Second Show")).toBeInTheDocument();
    expect(screen.getByTestId("episode-row-QA reorder third")).toHaveTextContent(
      "In playlist"
    );
  });

  it("renders the state-based action variants", async () => {
    vi.spyOn(api.episodes, "list").mockResolvedValue({
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

    renderSubscriptionsScreen();
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
    renderSubscriptionsScreen();

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
    vi.spyOn(api.episodes, "list").mockResolvedValue({
      episodes: [baseEpisode, secondEpisode],
    });

    renderSubscriptionsScreen();

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

    vi.spyOn(api.episodes, "list").mockResolvedValue({
      episodes: manyEpisodes,
    });

    renderSubscriptionsScreen();

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
    renderSubscriptionsScreen();

    const body = await screen.findByTestId("playlist-queue-body");

    expect(body).toHaveClass("overflow-y-auto", "pb-20", "md:pb-0");
    expect(body).not.toHaveClass("overflow-hidden");
  });

  it("adds an episode to the playlist from the row action", async () => {
    const user = userEvent.setup();
    const addSpy = vi.spyOn(api.playlist, "add").mockResolvedValue({ success: true });

    renderSubscriptionsScreen();

    await user.click(await screen.findByRole("button", { name: "Add to playlist" }));

    await waitFor(() => {
      expect(addSpy).toHaveBeenCalledWith(101);
    });
    await waitFor(() => {
      expect(reloadQueueMock).toHaveBeenCalledTimes(1);
    });
  });

  it("clears playlist state and reloads the playback queue after marking a playlist episode listened", async () => {
    const user = userEvent.setup();
    vi.spyOn(api.episodes, "list")
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

    renderSubscriptionsScreen();

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

    renderSubscriptionsScreen();

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
    const episodesSpy = vi.spyOn(api.episodes, "list");

    renderSubscriptionsScreen();

    expect(await screen.findByText("No podcasts")).toBeInTheDocument();
    expect(screen.getByText("No podcasts yet")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add RSS feed" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Import OPML" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Refresh all" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Show all" })).not.toBeInTheDocument();
    expect(episodesSpy).toHaveBeenCalledTimes(1);
  });

  it("shows the all-caught-up state when subscriptions have no unlistened episodes", async () => {
    const user = userEvent.setup();
    vi.spyOn(api.episodes, "list").mockResolvedValue({
      episodes: [{ ...baseEpisode, isListened: true }],
    });

    renderSubscriptionsScreen();

    expect(await screen.findByText("No unlistened podcasts")).toBeInTheDocument();
    expect(
      screen.getByText("1 podcast · 0 with unlistened")
    ).toBeInTheDocument();
    expect(screen.getByText("All caught up")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add RSS feed" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Import OPML" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Show all" }));

    expect(await screen.findByTestId("episode-row-QA reorder third")).toBeInTheDocument();
  });

  it("releases Refresh all when the refresh request fails", async () => {
    const user = userEvent.setup();
    let rejectRefresh!: (error: Error) => void;
    const refreshPromise = new Promise<never>((_resolve, reject) => {
      rejectRefresh = reject;
    });
    const refreshSpy = vi
      .spyOn(api.podcasts, "refreshAll")
      .mockReturnValue(refreshPromise);

    renderSubscriptionsScreen();

    const refreshButton = await screen.findByRole("button", {
      name: "Refresh all",
    });
    await user.click(refreshButton);

    expect(refreshSpy).toHaveBeenCalledTimes(1);
    expect(refreshButton).toBeDisabled();

    await user.click(refreshButton);
    expect(refreshSpy).toHaveBeenCalledTimes(1);

    rejectRefresh(new Error("Refresh request failed"));

    await waitFor(() => {
      expect(refreshButton).not.toBeDisabled();
    });
    expect(screen.getByText("Request failed")).toBeInTheDocument();
  });

  it("keeps Refresh all disabled until the background job completes", async () => {
    const user = userEvent.setup();
    let resolveRefresh!: () => void;
    const refreshPromise = new Promise<void>((resolve) => {
      resolveRefresh = resolve;
    });
    const listSpy = vi
      .spyOn(api.podcasts, "list")
      .mockResolvedValue({ podcasts: [podcast] });
    vi.spyOn(api.podcasts, "refreshAll").mockReturnValue(
      refreshPromise.then(() => ({ success: true, state: "running" }))
    );
    const statusSpy = vi
      .spyOn(api.jobs, "status")
      .mockResolvedValueOnce({
        scheduler: {
          state: "running",
          lastRunAt: "2026-05-27T10:00:00Z",
          lastSuccessAt: null,
        },
      })
      .mockResolvedValueOnce({
        scheduler: {
          state: "completed",
          lastRunAt: "2026-05-27T10:00:00Z",
          lastSuccessAt: "2026-05-27T10:00:05Z",
        },
      });

    renderSubscriptionsScreen();

    const refreshButton = await screen.findByRole("button", {
      name: "Refresh all",
    });
    await user.click(refreshButton);

    expect(refreshButton).toBeDisabled();

    vi.useFakeTimers();
    await act(async () => {
      resolveRefresh();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(refreshButton).toBeDisabled();
    expect(listSpy).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });

    expect(statusSpy).toHaveBeenCalledTimes(1);
    expect(refreshButton).toBeDisabled();
    expect(listSpy).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });

    expect(statusSpy).toHaveBeenCalledTimes(2);
    expect(refreshButton).not.toBeDisabled();
    expect(listSpy).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
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

    renderSubscriptionsScreen();

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
