import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AudiobookChaptersModal } from "./audiobook-chapters-modal";
import type { Audiobook } from "@/lib/api";

const mockAudiobook: Audiobook = {
  id: 1,
  title: "Dune",
  author: "Frank Herbert",
  relPath: "Frank Herbert/Dune",
  hasCover: false,
  totalDuration: 7200,
  trackCount: 3,
  listenedCount: 0,
  isListened: false,
  positionSeconds: 0,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  tracks: [
    {
      id: 101,
      audiobookId: 1,
      trackNumber: 1,
      title: "Chapter 1.mp3",
      relPath: "Frank Herbert/Dune/01.mp3",
      filePath: "/share/audio/abooks/Frank Herbert/Dune/01.mp3",
      duration: 2400,
      isListened: false,
      positionSeconds: 0,
    },
    {
      id: 102,
      audiobookId: 1,
      trackNumber: 2,
      title: "Chapter 2.mp3",
      relPath: "Frank Herbert/Dune/02.mp3",
      filePath: "/share/audio/abooks/Frank Herbert/Dune/02.mp3",
      duration: 2400,
      isListened: false,
      positionSeconds: 600,
    },
    {
      id: 103,
      audiobookId: 1,
      trackNumber: 3,
      title: "Chapter 3.mp3",
      relPath: "Frank Herbert/Dune/03.mp3",
      filePath: "/share/audio/abooks/Frank Herbert/Dune/03.mp3",
      duration: 2400,
      isListened: false,
      positionSeconds: 0,
    },
  ],
};

describe("AudiobookChaptersModal", () => {
  it("renders audiobook header and chapter list with durations", () => {
    render(
      <AudiobookChaptersModal
        audiobook={mockAudiobook}
        onClose={vi.fn()}
      />
    );

    expect(screen.getAllByText("Dune").length).toBeGreaterThan(0);
    expect(screen.getByText("Frank Herbert")).toBeInTheDocument();
    expect(screen.getByText("Chapter 1.mp3")).toBeInTheDocument();
    expect(screen.getByText("Chapter 2.mp3")).toBeInTheDocument();
    expect(screen.getByText("Chapter 3.mp3")).toBeInTheDocument();
    expect(screen.getAllByText("40m")).toHaveLength(3);
    expect(document.querySelector('[data-slot="abook-chapters-modal"]')).toHaveClass(
      "max-w-[720px]",
      "border-0",
      "ring-1",
      "sm:p-8"
    );
    expect(document.querySelector('[data-slot="chapter-item"]')).toHaveClass(
      "h-[70px]",
      "w-full",
      "min-w-0",
      "overflow-hidden",
      "px-1"
    );
    expect(document.querySelector('[data-slot="scroll-area"]')).toHaveClass(
      "[&_[data-slot=scroll-area-viewport]>div]:!block",
      "[&_[data-slot=scroll-area-viewport]>div]:!w-full"
    );
    expect(screen.getAllByText("40m")[0]).toHaveClass("w-20");
    expect(
      screen.getByRole("button", { name: "Add Chapter 1.mp3 to playlist" })
    ).toHaveClass("size-11");
  });

  it("calls onToggleTrackPlaylist when clicking Add to playlist on a chapter", () => {
    const onToggle = vi.fn();
    render(
      <AudiobookChaptersModal
        audiobook={mockAudiobook}
        onToggleTrackPlaylist={onToggle}
        onClose={vi.fn()}
      />
    );

    const addBtn = screen.getByRole("button", { name: "Add Chapter 2.mp3 to playlist" });
    expect(addBtn).toBeInTheDocument();
    fireEvent.click(addBtn);
    expect(onToggle).toHaveBeenCalledWith(mockAudiobook.tracks![1]);
  });

  it("renders Remove from playlist button when chapter is in playlist", () => {
    const bookWithTrackInPlaylist: Audiobook = {
      ...mockAudiobook,
      tracks: (mockAudiobook.tracks ?? []).map((t, idx) =>
        idx === 0 ? { ...t, inPlaylist: true } : t
      ),
    };

    const onToggle = vi.fn();
    render(
      <AudiobookChaptersModal
        audiobook={bookWithTrackInPlaylist}
        onToggleTrackPlaylist={onToggle}
        onClose={vi.fn()}
      />
    );

    const removeBtn = screen.getByRole("button", { name: "Remove Chapter 1.mp3 from playlist" });
    expect(removeBtn).toBeInTheDocument();
    fireEvent.click(removeBtn);
    expect(onToggle).toHaveBeenCalledWith(bookWithTrackInPlaylist.tracks![0]);
  });

  it("calls onClose when clicking close button", () => {
    const onClose = vi.fn();
    render(
      <AudiobookChaptersModal
        audiobook={mockAudiobook}
        onClose={onClose}
      />
    );

    const closeBtn = screen.getByRole("button", { name: "Close chapters modal" });
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalled();
  });
});
