import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AudiobooksScreen } from "./audiobooks-screen";
import { api, type Audiobook } from "@/lib/api";

vi.mock("@/lib/playback-context", () => ({
  usePlayback: () => ({
    currentEpisode: null,
    playing: false,
    positionSeconds: 0,
  }),
  usePlaybackDispatch: () => ({
    playEpisode: vi.fn(),
    playToggle: vi.fn(),
    reloadQueue: vi.fn().mockResolvedValue(undefined),
  }),
}));

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

  it("renders correct icons for general folders, audio files, and audio folders", async () => {
    render(
      <MemoryRouter>
        <AudiobooksScreen />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Frank Herbert")).toBeInTheDocument();
      expect(screen.getByText("Single Story")).toBeInTheDocument();
    });

    // 1. General folder has folder-03 icon
    const authorRow = screen.getByText("Frank Herbert").closest('[data-slot="fm-item"]');
    expect(authorRow?.querySelector('[data-icon-name="hugeicons/folder-03"]')).toBeInTheDocument();

    // 2. Standalone audio file has audio-book-01 icon
    const storyRow = screen.getByText("Single Story").closest('[data-slot="fm-item"]');
    expect(storyRow?.querySelector('[data-icon-name="hugeicons/audio-book-01"]')).toBeInTheDocument();

    // Navigate into author folder to check audio folder icon
    fireEvent.click(screen.getByText("Frank Herbert"));

    await waitFor(() => {
      expect(screen.getByText("Dune")).toBeInTheDocument();
    });

    // 3. Audio folder (multi-track / directory book) has folder-audio icon
    const duneRow = screen.getByText("Dune").closest('[data-slot="fm-item"]');
    expect(duneRow?.querySelector('[data-icon-name="hugeicons/folder-audio"]')).toBeInTheDocument();
  });

  it("sorts all folders first in alphabetical order followed by audio files in alphabetical order", async () => {
    const mixedAudiobooks: Audiobook[] = [
      {
        id: 1,
        title: "Zebra Story.mp3",
        author: "",
        relPath: "Zebra Story.mp3",
        hasCover: false,
        totalDuration: 1000,
        trackCount: 1,
        listenedCount: 0,
        isListened: false,
        positionSeconds: 0,
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      },
      {
        id: 2,
        title: "Apple Story.mp3",
        author: "",
        relPath: "Apple Story.mp3",
        hasCover: false,
        totalDuration: 1000,
        trackCount: 1,
        listenedCount: 0,
        isListened: false,
        positionSeconds: 0,
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      },
      {
        id: 3,
        title: "Beta Folder Book",
        author: "",
        relPath: "Beta Folder Book",
        hasCover: false,
        totalDuration: 5000,
        trackCount: 2,
        listenedCount: 0,
        isListened: false,
        positionSeconds: 0,
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      },
      {
        id: 4,
        title: "Sub Book",
        author: "Alpha Category",
        relPath: "Alpha Category/Sub Book",
        hasCover: false,
        totalDuration: 5000,
        trackCount: 2,
        listenedCount: 0,
        isListened: false,
        positionSeconds: 0,
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      },
    ];

    vi.spyOn(api.audiobooks, "list").mockResolvedValue({ audiobooks: mixedAudiobooks });

    render(
      <MemoryRouter>
        <AudiobooksScreen />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Alpha Category")).toBeInTheDocument();
      expect(screen.getByText("Beta Folder Book")).toBeInTheDocument();
      expect(screen.getByText("Apple Story.mp3")).toBeInTheDocument();
      expect(screen.getByText("Zebra Story.mp3")).toBeInTheDocument();
    });

    const items = document.querySelectorAll('[data-slot="fm-item"]');
    const titles = Array.from(items).map((el) => el.querySelector("span")?.textContent?.trim());

    // Folders come first: Alpha Category (general folder), Beta Folder Book (audiobook folder)
    // Audio files come second: Apple Story.mp3, Zebra Story.mp3
    expect(titles).toEqual([
      "Alpha Category",
      "Beta Folder Book",
      "Apple Story.mp3",
      "Zebra Story.mp3",
    ]);
  });
});
