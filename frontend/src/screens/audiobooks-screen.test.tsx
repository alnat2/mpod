import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AudiobooksScreen } from "./audiobooks-screen";
import { api, type Audiobook } from "@/lib/api";

const mockAudiobooks: Audiobook[] = [
  {
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
        title: "01.mp3",
        relPath: "Frank Herbert/Dune/01.mp3",
        filePath: "/share/audio/abooks/Frank Herbert/Dune/01.mp3",
        duration: 2400,
        isListened: false,
        positionSeconds: 0,
      },
    ],
  },
  {
    id: 2,
    title: "Single Story",
    author: "Standalone Author",
    relPath: "Single Story.mp3",
    hasCover: false,
    totalDuration: 3600,
    trackCount: 1,
    listenedCount: 0,
    isListened: false,
    positionSeconds: 0,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  },
];

describe("AudiobooksScreen", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(api.audiobooks, "list").mockResolvedValue({ audiobooks: mockAudiobooks });
    vi.spyOn(api.audiobooks, "rescan").mockResolvedValue({ success: true });
    vi.spyOn(api.audiobooks, "addToPlaylist").mockResolvedValue({ success: true });
  });

  it("renders page header, breadcrumbs, folders, and root items", async () => {
    render(
      <MemoryRouter>
        <AudiobooksScreen />
      </MemoryRouter>
    );

    expect(screen.getByText("Scanning audiobooks...")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("Audiobooks")).toBeInTheDocument();
    });

    expect(screen.getByText("Local collection · 2 items")).toBeInTheDocument();
    expect(screen.getByText("Frank Herbert")).toBeInTheDocument();
    expect(screen.getByText("Single Story")).toBeInTheDocument();
  });

  it("navigates into subfolder when clicking folder", async () => {
    render(
      <MemoryRouter>
        <AudiobooksScreen />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Frank Herbert")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Frank Herbert"));

    await waitFor(() => {
      expect(screen.getByText("Dune")).toBeInTheDocument();
    });
  });

  it("triggers rescan when clicking refresh button", async () => {
    const rescanSpy = vi.spyOn(api.audiobooks, "rescan");

    render(
      <MemoryRouter>
        <AudiobooksScreen />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Rescan library" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Rescan library" }));

    await waitFor(() => {
      expect(rescanSpy).toHaveBeenCalled();
    });
  });
});
