import type { ReactNode } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "@/lib/api";

import { HomeScreen } from "./home-screen";

const playEpisodeMock = vi.fn();
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

const queue = [
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
    },
  },
];

vi.mock("@/lib/playback-context", () => ({
  usePlayback: () => ({
    queue,
    currentEpisode: queue[1],
    updateQueue: updateQueueMock,
    loading: false,
    playbackError: null,
    reloadQueue: reloadQueueMock,
    playing: false,
    playToggle: playToggleMock,
    playEpisode: playEpisodeMock,
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
    onProgressSeek,
    onNotes,
  }: {
    title: string;
    podcastTitle: string;
    elapsedLabel: string;
    durationLabel: string;
    progressValue?: number;
    onProgressSeek?: (progressRatio: number) => void;
    onNotes?: () => void;
  }) => (
    <section data-testid="player">
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
  }: {
    children: ReactNode;
    summary?: string;
  }) => (
    <div>
      <div>{summary}</div>
      {children}
    </div>
  ),
  EpisodeRow: ({
    title,
    current,
    downloaded,
    inPlaylist,
    showDragHandle,
    actions = [],
  }: {
    title: string;
    current?: boolean;
    downloaded?: boolean;
    inPlaylist?: boolean;
    showDragHandle?: boolean;
    actions?: Array<{ label: string; onClick?: () => void }>;
  }) => (
    <div
      data-testid={`episode-row-${title}`}
      data-current={current ? "yes" : "no"}
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
  });

  it("renders the player from the active playback episode, not queue order", async () => {
    render(<HomeScreen />);

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
    await user.click(playButtons[0]);

    expect(playEpisodeMock).toHaveBeenCalledWith(1);
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
    await user.click(removeButtons[0]);

    expect(updateQueueMock).toHaveBeenCalledWith([queue[1]]);
    await waitFor(() => {
      expect(removeSpy).toHaveBeenCalledWith(1);
    });
    expect(scheduleActionMock).not.toHaveBeenCalled();
  });
});
