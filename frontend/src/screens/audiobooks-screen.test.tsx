import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AudiobooksScreen } from "./audiobooks-screen";
import { api, ApiError, type Audiobook } from "@/lib/api";

const reloadQueueMock = vi.fn().mockResolvedValue(undefined);

vi.mock("@/lib/playback-context", () => ({
  usePlayback: () => ({
    currentEpisode: null,
    playing: false,
    positionSeconds: 0,
  }),
  usePlaybackDispatch: () => ({
    playEpisode: vi.fn(),
    playToggle: vi.fn(),
    reloadQueue: reloadQueueMock,
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
    reloadQueueMock.mockClear();
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

  it("shows pending state specifically for selected book until request completes", async () => {
    const baseBook = mockAudiobooks[1]!;
    const twoBooks: Audiobook[] = [
      { ...baseBook, id: 2, title: "Book A.mp3", relPath: "Book A.mp3" },
      { ...baseBook, id: 3, title: "Book B.mp3", relPath: "Book B.mp3" },
    ];
    vi.spyOn(api.audiobooks, "list").mockResolvedValue({ audiobooks: twoBooks });

    let resolveAdd!: (value: { success: boolean }) => void;
    vi.spyOn(api.audiobooks, "addToPlaylist").mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveAdd = resolve;
        })
    );

    render(
      <MemoryRouter>
        <AudiobooksScreen />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Book A.mp3")).toBeInTheDocument();
      expect(screen.getByText("Book B.mp3")).toBeInTheDocument();
    });

    const rowA = screen.getByText("Book A.mp3").closest<HTMLElement>('[data-slot="fm-item"]')!;
    const rowB = screen.getByText("Book B.mp3").closest<HTMLElement>('[data-slot="fm-item"]')!;

    const btnA = within(rowA).getByRole("button", { name: "Add to playlist" });
    const btnB = within(rowB).getByRole("button", { name: "Add to playlist" });

    fireEvent.click(btnA);

    // Book A enters pending state: disabled with spinner
    await waitFor(() => {
      expect(btnA).toBeDisabled();
      expect(btnA).toHaveAttribute("aria-busy", "true");
    });
    expect(rowA.querySelector('[data-icon-name="hugeicons/loading-02"]')).toBeInTheDocument();

    // Book B is NOT affected and remains interactive
    expect(btnB).not.toBeDisabled();
    expect(within(rowB).getByRole("button", { name: "Add to playlist" })).toBeInTheDocument();

    // Finish request
    resolveAdd({ success: true });

    await waitFor(() => {
      const updatedRowA = screen.getByText("Book A.mp3").closest<HTMLElement>('[data-slot="fm-item"]')!;
      expect(within(updatedRowA).getByRole("button", { name: "Remove from playlist" })).toBeInTheDocument();
      expect(within(updatedRowA).getByRole("button", { name: "Remove from playlist" })).not.toBeDisabled();
    });
  });

  it("blocks repeated clicks while adding and sends exactly one POST", async () => {
    let resolveAdd!: (value: { success: boolean }) => void;
    const addSpy = vi.spyOn(api.audiobooks, "addToPlaylist").mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveAdd = resolve;
        })
    );

    render(
      <MemoryRouter>
        <AudiobooksScreen />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Single Story")).toBeInTheDocument();
    });

    const storyRow = screen.getByText("Single Story").closest<HTMLElement>('[data-slot="fm-item"]')!;
    const btn = within(storyRow).getByRole("button", { name: "Add to playlist" });

    // Rapid repeated clicks
    fireEvent.click(btn);
    fireEvent.click(btn);
    fireEvent.click(btn);

    expect(addSpy).toHaveBeenCalledTimes(1);
    expect(addSpy).toHaveBeenCalledWith(2);

    resolveAdd({ success: true });

    await waitFor(() => {
      const updatedStoryRow = screen.getByText("Single Story").closest<HTMLElement>('[data-slot="fm-item"]')!;
      expect(within(updatedStoryRow).getByRole("button", { name: "Remove from playlist" })).toBeInTheDocument();
    });

    expect(addSpy).toHaveBeenCalledTimes(1);
  });

  it("immediately updates card to inPlaylist=true and calls reloadQueue() without waiting for library reload", async () => {
    // Initial fetch succeeds, but subsequent background list reload is hung/unresolved
    vi.spyOn(api.audiobooks, "list")
      .mockResolvedValueOnce({ audiobooks: mockAudiobooks })
      .mockReturnValue(new Promise(() => {}));

    vi.spyOn(api.audiobooks, "addToPlaylist").mockResolvedValue({ success: true });

    render(
      <MemoryRouter>
        <AudiobooksScreen />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Single Story")).toBeInTheDocument();
    });

    const storyRow = screen.getByText("Single Story").closest<HTMLElement>('[data-slot="fm-item"]')!;
    const btn = within(storyRow).getByRole("button", { name: "Add to playlist" });

    fireEvent.click(btn);

    // Card is immediately updated and reloadQueue() is called
    await waitFor(() => {
      const updatedStoryRow = screen.getByText("Single Story").closest<HTMLElement>('[data-slot="fm-item"]')!;
      expect(within(updatedStoryRow).getByRole("button", { name: "Remove from playlist" })).toBeInTheDocument();
    });
    expect(reloadQueueMock).toHaveBeenCalledTimes(1);
  });

  it("rolls back local state, shows ErrorBanner, and does not call reloadQueue() on error", async () => {
    vi.spyOn(api.audiobooks, "addToPlaylist").mockRejectedValue(
      new ApiError("Failed to add book to playlist", "INTERNAL_ERROR", 500)
    );

    render(
      <MemoryRouter>
        <AudiobooksScreen />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Single Story")).toBeInTheDocument();
    });

    const storyRow = screen.getByText("Single Story").closest<HTMLElement>('[data-slot="fm-item"]')!;
    const btn = within(storyRow).getByRole("button", { name: "Add to playlist" });

    fireEvent.click(btn);

    // Error banner is displayed
    await waitFor(() => {
      expect(screen.getByText("Failed to add book to playlist")).toBeInTheDocument();
    });

    // Local state is rolled back: button is Add to playlist and enabled
    const updatedStoryRow = screen.getByText("Single Story").closest<HTMLElement>('[data-slot="fm-item"]')!;
    expect(within(updatedStoryRow).getByRole("button", { name: "Add to playlist" })).toBeInTheDocument();
    expect(within(updatedStoryRow).getByRole("button", { name: "Add to playlist" })).not.toBeDisabled();

    // reloadQueue() was NOT called
    expect(reloadQueueMock).not.toHaveBeenCalled();
  });
});
