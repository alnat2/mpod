import type { ReactNode, Ref, UIEventHandler } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { api, type Episode, type Podcast } from "@/lib/api";

import { SubscriptionsScreen } from "./subscriptions-screen";

const reloadQueueMock = vi.fn();

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
  }: {
    title: string;
    onSelect?: () => void;
  }) => (
    <button type="button" onClick={onSelect}>
      {title}
    </button>
  ),
  PlaylistQueue: ({
    children,
    summary,
    headerAction,
    bodyRef,
    bodyOnScroll,
  }: {
    children: ReactNode;
    summary?: string;
    headerAction?: ReactNode;
    bodyRef?: Ref<HTMLDivElement>;
    bodyOnScroll?: UIEventHandler<HTMLDivElement>;
  }) => (
    <div>
      <div>{summary}</div>
      {headerAction}
      <div
        data-testid="playlist-queue-body"
        ref={bodyRef}
        onScroll={bodyOnScroll}
      >
        {children}
      </div>
    </div>
  ),
  EpisodeRow: ({
    title,
    actions = [],
  }: {
    title: string;
    actions?: Array<{ label: string; onClick?: () => void }>;
  }) => (
    <div data-testid={`episode-row-${title}`}>
      <span>{title}</span>
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
    expect(screen.getByText("Episode notes")).toBeInTheDocument();
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

  it("adds an episode to the playlist from the row action", async () => {
    const user = userEvent.setup();
    const addSpy = vi.spyOn(api.playlist, "add").mockResolvedValue({ success: true });

    render(<SubscriptionsScreen />);

    await user.click(await screen.findByRole("button", { name: "Add to playlist" }));

    await waitFor(() => {
      expect(addSpy).toHaveBeenCalledWith(101);
    });
  });
});
