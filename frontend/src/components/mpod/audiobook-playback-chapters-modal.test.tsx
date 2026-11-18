import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AudiobookPlaybackChaptersModal } from "./audiobook-playback-chapters-modal";

const audiobook = {
  id: 7,
  title: "Book",
  author: "Author",
  relPath: "Author/Book",
  hasCover: false,
  totalDuration: 300,
  trackCount: 3,
  listenedCount: 1,
  isListened: false,
  positionSeconds: 0,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  tracks: [
    { id: 1, audiobookId: 7, trackNumber: 1, title: "Done", relPath: "1.mp3", filePath: "/1.mp3", duration: 100, isListened: true, inPlaylist: true, positionSeconds: 100 },
    { id: 2, audiobookId: 7, trackNumber: 2, title: "Current", relPath: "2.mp3", filePath: "/2.mp3", duration: 100, isListened: false, inPlaylist: true, positionSeconds: 40 },
    { id: 3, audiobookId: 7, trackNumber: 3, title: "Hidden", relPath: "3.mp3", filePath: "/3.mp3", duration: 100, isListened: false, inPlaylist: false, positionSeconds: 0 },
  ],
};

describe("AudiobookPlaybackChaptersModal", () => {
  it("shows playback actions only for selected chapters", () => {
    render(
      <AudiobookPlaybackChaptersModal
        audiobook={audiobook}
        currentTrackId={2}
        playing
        onClose={vi.fn()}
        onPlayTrack={vi.fn()}
      />
    );

    expect(screen.getByRole("button", { name: "Replay Done" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pause Current" })).toBeInTheDocument();
    expect(screen.queryByText("Hidden")).not.toBeInTheDocument();
    expect(screen.getByText("1m / 2m")).toHaveClass(
      "w-20",
      "whitespace-nowrap"
    );
    expect(
      document.querySelector('[data-slot="abook-playback-chapters-modal"]')
    ).toHaveClass("max-w-[720px]", "border-0", "ring-1", "sm:p-8");
    expect(document.querySelector('[data-current="true"]')).toHaveClass(
      "w-full",
      "min-w-0",
      "overflow-hidden"
    );
    expect(document.querySelector('[data-slot="scroll-area"]')).toHaveClass(
      "[&_[data-slot=scroll-area-viewport]>div]:!block",
      "[&_[data-slot=scroll-area-viewport]>div]:!w-full"
    );
    expect(screen.getByRole("button", { name: "Pause Current" })).toHaveClass(
      "size-11"
    );
  });

  it("scrolls the current chapter into view on mount", () => {
    const scrollIntoViewMock = vi.fn();
    window.HTMLElement.prototype.scrollIntoView = scrollIntoViewMock;

    render(
      <AudiobookPlaybackChaptersModal
        audiobook={audiobook}
        currentTrackId={2}
        playing
        onClose={vi.fn()}
        onPlayTrack={vi.fn()}
      />
    );

    expect(scrollIntoViewMock).toHaveBeenCalledWith({ block: "start" });
  });

  it("scrolls to the new chapter when currentTrackId changes", () => {
    const scrollIntoViewMock = vi.fn();
    window.HTMLElement.prototype.scrollIntoView = scrollIntoViewMock;

    const { rerender } = render(
      <AudiobookPlaybackChaptersModal
        audiobook={audiobook}
        currentTrackId={1}
        playing
        onClose={vi.fn()}
        onPlayTrack={vi.fn()}
      />
    );

    expect(scrollIntoViewMock).toHaveBeenCalledTimes(1);

    rerender(
      <AudiobookPlaybackChaptersModal
        audiobook={audiobook}
        currentTrackId={2}
        playing
        onClose={vi.fn()}
        onPlayTrack={vi.fn()}
      />
    );

    expect(scrollIntoViewMock).toHaveBeenCalledTimes(2);
  });

  it("does not re-scroll on duration or playing updates when currentTrackId has not changed", () => {
    const scrollIntoViewMock = vi.fn();
    window.HTMLElement.prototype.scrollIntoView = scrollIntoViewMock;

    const { rerender } = render(
      <AudiobookPlaybackChaptersModal
        audiobook={audiobook}
        currentTrackId={2}
        currentDurationSeconds={40}
        playing={true}
        onClose={vi.fn()}
        onPlayTrack={vi.fn()}
      />
    );

    expect(scrollIntoViewMock).toHaveBeenCalledTimes(1);

    // Progress updates to 41 seconds
    rerender(
      <AudiobookPlaybackChaptersModal
        audiobook={audiobook}
        currentTrackId={2}
        currentDurationSeconds={41}
        playing={true}
        onClose={vi.fn()}
        onPlayTrack={vi.fn()}
      />
    );

    // Paused
    rerender(
      <AudiobookPlaybackChaptersModal
        audiobook={audiobook}
        currentTrackId={2}
        currentDurationSeconds={41}
        playing={false}
        onClose={vi.fn()}
        onPlayTrack={vi.fn()}
      />
    );

    // Must still be called only once
    expect(scrollIntoViewMock).toHaveBeenCalledTimes(1);
  });

  it("does not scroll if currentTrackId does not match any track", () => {
    const scrollIntoViewMock = vi.fn();
    window.HTMLElement.prototype.scrollIntoView = scrollIntoViewMock;

    render(
      <AudiobookPlaybackChaptersModal
        audiobook={audiobook}
        currentTrackId={999}
        playing
        onClose={vi.fn()}
        onPlayTrack={vi.fn()}
      />
    );

    expect(scrollIntoViewMock).not.toHaveBeenCalled();
  });
});
