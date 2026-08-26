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
  it("renders audiobook header and chapter list", () => {
    render(
      <AudiobookChaptersModal
        audiobook={mockAudiobook}
        onSelectTrack={vi.fn()}
        onClose={vi.fn()}
      />
    );

    expect(screen.getAllByText("Dune").length).toBeGreaterThan(0);
    expect(screen.getByText("Frank Herbert")).toBeInTheDocument();
    expect(screen.getByText("Chapter 1.mp3")).toBeInTheDocument();
    expect(screen.getByText("Chapter 2.mp3")).toBeInTheDocument();
    expect(screen.getByText("Chapter 3.mp3")).toBeInTheDocument();
  });

  it("highlights active track with bg-accent and displays progress", () => {
    render(
      <AudiobookChaptersModal
        audiobook={mockAudiobook}
        activeTrackId={102}
        isPlaying={true}
        activePositionSeconds={720}
        onSelectTrack={vi.fn()}
        onClose={vi.fn()}
      />
    );

    const activeItem = document.querySelector('[data-active="true"]');
    expect(activeItem).toBeInTheDocument();
    expect(activeItem).toHaveClass("bg-accent");
    expect(screen.getByText("12m / 40m")).toBeInTheDocument();
    expect(document.querySelector('[data-icon-name="hugeicons/pause"]')).toBeInTheDocument();
  });

  it("calls onSelectTrack when clicking play on inactive track", () => {
    const onSelect = vi.fn();
    render(
      <AudiobookChaptersModal
        audiobook={mockAudiobook}
        activeTrackId={101}
        onSelectTrack={onSelect}
        onClose={vi.fn()}
      />
    );

    const playBtn = screen.getByRole("button", { name: "Play Chapter 3.mp3" });
    fireEvent.click(playBtn);
    expect(onSelect).toHaveBeenCalledWith(mockAudiobook.tracks![2]);
  });

  it("calls onClose when clicking close button", () => {
    const onClose = vi.fn();
    render(
      <AudiobookChaptersModal
        audiobook={mockAudiobook}
        onSelectTrack={vi.fn()}
        onClose={onClose}
      />
    );

    const closeBtn = screen.getByRole("button", { name: "Close chapters modal" });
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalled();
  });
});
