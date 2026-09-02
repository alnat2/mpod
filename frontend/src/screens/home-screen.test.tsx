import type { ReactNode } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { api, type PlaybackQueueEpisode } from "@/lib/api";
import { expectNoA11yViolations } from "@/test/axe";

import { HomeScreen } from "./home-screen";

const playEpisodeMock = vi.fn();
const playQueueItemMock = vi.fn();
const playToggleMock = vi.fn();
const seekBackwardMock = vi.fn();
const seekForwardMock = vi.fn();
const seekToMock = vi.fn();
const setSpeedLabelMock = vi.fn();
const clearPlaybackErrorMock = vi.fn();
const reloadQueueMock = vi.fn().mockResolvedValue(undefined);
const updateQueueMock = vi.fn();
const scheduleActionMock = vi.fn();
const undoActionMock = vi.fn();
let playbackDurationSeconds = 2400;

const baseQueue = [
  {
    id: 1,
    podcastId: 11,
    title: "First queued episode",
    description: "First notes",
    showNotes: "First sanitized notes",
    audioUrl: "https://example.com/1.mp3",
    duration: 1800,
    downloaded: true,
    isListened: false,
    publishedAt: "2026-05-10T10:00:00Z",
    podcastTitle: "Queue Podcast",
    podcastImageUrl: null,
    playback: null,
  },
  {
    id: 2,
    podcastId: 22,
    title: "Actually playing",
    description: "Current notes",
    showNotes: "Current sanitized notes",
    audioUrl: "https://example.com/2.mp3",
    duration: 2400,
    downloaded: false,
    isListened: false,
    publishedAt: "2026-05-11T10:00:00Z",
    podcastTitle: "Current Podcast",
    podcastImageUrl: null,
    playback: {
      episodeId: 2,
      positionSeconds: 96,
      durationSeconds: 2400,
      completed: false,
      clientUpdatedAt: "2026-05-22T08:00:00Z",
      serverUpdatedAt: "2026-05-22T08:00:00Z",
      lastUpdated: "2026-05-22T08:00:00Z",
    },
  },
];

let queue: PlaybackQueueEpisode[] = [...baseQueue];
let currentEpisode: PlaybackQueueEpisode | (typeof baseQueue)[number] = queue[1]!;

vi.mock("@/lib/playback-context", () => ({
  usePlayback: () => ({
    queue,
    currentEpisode,
    updateQueue: updateQueueMock,
    loading: false,
    playbackError: null,
    reloadQueue: reloadQueueMock,
    playing: false,
    playToggle: playToggleMock,
    playEpisode: playEpisodeMock,
    playQueueItem: playQueueItemMock,
    positionSeconds: 96,
    durationSeconds: playbackDurationSeconds,
    speedLabel: "Speed 1.3x",
    setSpeedLabel: setSpeedLabelMock,
    clearPlaybackError: clearPlaybackErrorMock,
    seekBackward: seekBackwardMock,
    seekForward: seekForwardMock,
    seekTo: seekToMock,
  }),
}));

vi.mock("./add-podcast-modal", () => ({
  AddPodcastModal: () => null,
}));

vi.mock("./use-delayed-actions", () => ({
  useDelayedActions: () => ({
    pendingActions: [],
    scheduleAction: scheduleActionMock,
    undoAction: undoActionMock,
  }),
}));

vi.mock("@/components/mpod", () => ({
  AppShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Player: ({
    title,
    podcastTitle,
    elapsedLabel,
    durationLabel,
    progressValue,
    hasChapters,
    onProgressSeek,
    onNotes,
  }: {
    title: string;
    podcastTitle: string;
    elapsedLabel: string;
    durationLabel: string;
    progressValue?: number;
    hasChapters?: boolean;
    onProgressSeek?: (progressRatio: number) => void;
    onNotes?: () => void;
  }) => (
    <section
      data-testid="player"
      data-has-chapters={hasChapters ? "yes" : "no"}
    >
      <div>{title}</div>
      <div>{podcastTitle}</div>
      <div data-testid="elapsed-label">{elapsedLabel}</div>
      <div data-testid="duration-label">{durationLabel}</div>
      <div data-testid="progress-value">{progressValue}</div>
      <button type="button" onClick={() => onProgressSeek?.(0.5)}>
        Seek middle
      </button>
      <button type="button" onClick={onNotes}>
        Notes
      </button>
    </section>
  ),
  PlaylistQueue: ({
    children,
    summary,
    bodyClassName,
  }: {
    children: ReactNode;
    summary?: string;
    bodyClassName?: string;
  }) => (
    <div data-testid="playlist-queue" data-body-class={bodyClassName}>
      <div>{summary}</div>
      {children}
    </div>
  ),
  EpisodeRow: ({
    title,
    current,
    currentStatusLabel,
    downloaded,
    inPlaylist,
    showDragHandle,
    actions = [],
  }: {
    title: string;
    current?: boolean;
    currentStatusLabel?: string;
    downloaded?: boolean;
    inPlaylist?: boolean;
    showDragHandle?: boolean;
    actions?: Array<{ label: string; onClick?: () => void }>;
  }) => (
    <div
      data-testid={`episode-row-${title}`}
      data-current={current ? "yes" : "no"}
      data-current-status-label={currentStatusLabel}
      data-downloaded={downloaded ? "yes" : "no"}
      data-in-playlist={inPlaylist ? "yes" : "no"}
    >
      {showDragHandle ? <span data-testid={`drag-handle-${title}`} /> : null}
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
  }: {
    podcastTitle: string;
    episodeTitle: string;
    children: ReactNode;
  }) => (
    <div>
      <div>{podcastTitle}</div>
      <div>{episodeTitle}</div>
      <div>{children}</div>
    </div>
  ),
}));

describe("HomeScreen", () => {
  beforeEach(() => {
    playEpisodeMock.mockReset();
    playQueueItemMock.mockReset();
    playToggleMock.mockReset();
    seekBackwardMock.mockReset();
    seekForwardMock.mockReset();
    seekToMock.mockReset();
    setSpeedLabelMock.mockReset();
    clearPlaybackErrorMock.mockReset();
    reloadQueueMock.mockClear();
    updateQueueMock.mockReset();
    scheduleActionMock.mockReset();
    undoActionMock.mockReset();
    playbackDurationSeconds = 2400;
    queue = [...baseQueue];
    currentEpisode = queue[1]!;
  });

  it("renders the player from the active playback episode, not queue order", async () => {
    const { container } = render(<HomeScreen />);

    expect(await screen.findByTestId("player")).toHaveTextContent("Actually playing");
    expect(screen.getByTestId("player")).toHaveTextContent("Current Podcast");
    expect(screen.queryByText("First queued episode")).toBeInTheDocument();

    expect(screen.getByTestId("episode-row-Actually playing")).toHaveAttribute(
      "data-current",
      "yes"
    );
    expect(screen.getByTestId("episode-row-First queued episode")).toHaveAttribute(
      "data-current",
      "no"
    );
    expect(screen.getByTestId("drag-handle-First queued episode")).toBeInTheDocument();
    await expectNoA11yViolations(container);
  });

  it("shows chapter navigation for a folder-backed book with one selected track", async () => {
    currentEpisode = {
      id: 7,
      podcastId: 0,
      type: "audiobook",
      audiobookId: 7,
      trackId: 71,
      trackCount: 1,
      hasChapters: true,
      title: "The Running Grave",
      author: "Robert Galbraith",
      podcastTitle: "Robert Galbraith",
      audioUrl: "/api/audiobooks/7/tracks/71/audio",
      duration: 3600,
      downloaded: true,
      isListened: false,
      publishedAt: null,
      playback: null,
    };

    render(<HomeScreen />);

    expect(await screen.findByTestId("player")).toHaveAttribute(
      "data-has-chapters",
      "yes"
    );
  });

  it("passes 'Now playing · Chapter N / M' as currentStatusLabel for active multi-chapter audiobooks", async () => {
    const multiChapterBook: PlaybackQueueEpisode = {
      id: 8,
      podcastId: 0,
      type: "audiobook",
      audiobookId: 8,
      trackId: 83,
      trackNumber: 3,
      trackCount: 12,
      hasChapters: true,
      title: "Oathbringer",
      author: "Brandon Sanderson",
      podcastTitle: "Brandon Sanderson",
      audioUrl: "/api/audiobooks/8/tracks/83/audio",
      duration: 3600,
      downloaded: true,
      isListened: false,
      publishedAt: null,
      playback: null,
    };
    queue = [multiChapterBook];
    currentEpisode = multiChapterBook;

    render(<HomeScreen />);

    const row = await screen.findByTestId("episode-row-Oathbringer");
    expect(row).toHaveAttribute("data-current", "yes");
    expect(row).toHaveAttribute(
      "data-current-status-label",
      "Now playing · Chapter 3 / 12"
    );
  });

  it("gives the playlist body a real scroll viewport", () => {
    render(<HomeScreen />);

    expect(screen.getByTestId("playlist-queue")).toHaveAttribute(
      "data-body-class",
      expect.stringContaining("h-[236px]")
    );
    expect(screen.getByTestId("playlist-queue")).toHaveAttribute(
      "data-body-class",
      expect.stringContaining("overflow-y-auto")
    );
  });

  it("shows download state without a redundant playlist state in player rows", async () => {
    render(<HomeScreen />);

    expect(
      await screen.findByTestId("episode-row-First queued episode")
    ).toHaveAttribute("data-downloaded", "yes");
    expect(screen.getByTestId("episode-row-First queued episode")).toHaveAttribute(
      "data-in-playlist",
      "no"
    );
  });

  it("does not reload the queue when the playback provider has already loaded it", async () => {
    render(<HomeScreen />);

    expect(await screen.findByTestId("player")).toBeInTheDocument();
    expect(reloadQueueMock).not.toHaveBeenCalled();
  });

  it("plays the clicked playlist row without relying on queue position", async () => {
    const user = userEvent.setup();
    render(<HomeScreen />);

    const playButtons = await screen.findAllByRole("button", { name: "Play" });
    const firstPlayButton = playButtons[0];
    if (!firstPlayButton) {
      throw new Error("Expected a playlist play button");
    }
    await user.click(firstPlayButton);

    expect(playQueueItemMock).toHaveBeenCalledWith(queue[0]);
  });

  it("opens show notes for the current player episode", async () => {
    const user = userEvent.setup();
    render(<HomeScreen />);

    await user.click(await screen.findByRole("button", { name: "Notes" }));

    const modal = await screen.findByTestId("modal");
    expect(modal).toHaveTextContent("Current Podcast");
    expect(modal).toHaveTextContent("Actually playing");
    expect(modal).toHaveTextContent("Current sanitized notes");
    expect(modal).not.toHaveTextContent("Current notes");
  });

  it("uses episode metadata duration when audio duration is not loaded yet", async () => {
    const user = userEvent.setup();
    playbackDurationSeconds = 0;

    render(<HomeScreen />);

    expect(await screen.findByTestId("duration-label")).toHaveTextContent("38:24");

    await user.click(screen.getByRole("button", { name: "Seek middle" }));
    expect(seekToMock).toHaveBeenCalledWith(1200);
  });

  it("shows remaining time on the right side of the player", async () => {
    playbackDurationSeconds = 2400;

    render(<HomeScreen />);

    expect(await screen.findByTestId("elapsed-label")).toHaveTextContent("1:36");
    expect(screen.getByTestId("duration-label")).toHaveTextContent("38:24");
    expect(screen.getByTestId("progress-value")).toHaveTextContent("4");
  });

  it("removes playlist items immediately from the row action", async () => {
    const user = userEvent.setup();
    const removeSpy = vi.spyOn(api.playlist, "remove").mockResolvedValue({ success: true });

    render(<HomeScreen />);

    const removeButtons = await screen.findAllByRole("button", {
      name: "Remove from playlist",
    });
    const firstRemoveButton = removeButtons[0];
    if (!firstRemoveButton) {
      throw new Error("Expected a remove-from-playlist button");
    }
    await user.click(firstRemoveButton);

    expect(updateQueueMock).toHaveBeenCalledWith([queue[1]]);
    await waitFor(() => {
      expect(removeSpy).toHaveBeenCalledWith(1);
    });
    expect(scheduleActionMock).not.toHaveBeenCalled();
  });
});
