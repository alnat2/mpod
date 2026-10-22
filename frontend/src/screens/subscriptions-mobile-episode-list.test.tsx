import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import type {
  CachedSubscriptionEpisode,
  CachedSubscriptionPodcast,
} from "@/lib/subscriptions-cache";
import { SubscriptionsMobileEpisodeList } from "./subscriptions-mobile-episode-list";

const mockEpisodes: CachedSubscriptionEpisode[] = [
  {
    id: 101,
    podcastId: 1,
    title: "Episode 1",
    description: "Description 1",
    audioUrl: "https://example.com/ep1.mp3",
    downloaded: false,
    publishedAt: "2026-01-01T00:00:00Z",
    isListened: false,
    inPlaylist: false,
    duration: 3600,
  },
  {
    id: 102,
    podcastId: 1,
    title: "Episode 2",
    description: "Description 2",
    audioUrl: "https://example.com/ep2.mp3",
    downloaded: false,
    publishedAt: "2026-01-02T00:00:00Z",
    isListened: true,
    inPlaylist: true,
    duration: 1800,
  },
];

const mockPodcast: CachedSubscriptionPodcast = {
  id: 1,
  title: "Test Podcast",
  description: "Test description",
  rssUrl: "https://example.com/test.xml",
  lastChecked: null,
  updateTime: null,
  episodes: mockEpisodes,
};

describe("SubscriptionsMobileEpisodeList", () => {
  it("renders summary, episode rows, and triggers actions", async () => {
    const user = userEvent.setup();
    const onAddToPlaylist = vi.fn();
    const onMarkAllListened = vi.fn();
    const onMarkListened = vi.fn();
    const onRemoveFromPlaylist = vi.fn();
    const onShowNotes = vi.fn();

    render(
      <TooltipProvider>
        <SubscriptionsMobileEpisodeList
          podcast={mockPodcast}
          visibleEpisodes={mockEpisodes}
          onAddToPlaylist={onAddToPlaylist}
          onMarkAllListened={onMarkAllListened}
          onMarkListened={onMarkListened}
          onRemoveFromPlaylist={onRemoveFromPlaylist}
          onShowNotes={onShowNotes}
        />
      </TooltipProvider>
    );

    // Summary label
    expect(screen.getByText("2 / 1 episodes")).toBeInTheDocument();

    // Mark all listened button
    const markAllButton = screen.getByRole("button", {
      name: "Mark all listened",
    });
    expect(markAllButton).toBeInTheDocument();
    await user.click(markAllButton);
    expect(onMarkAllListened).toHaveBeenCalledWith(1);

    // Episode 1 row
    expect(screen.getByText("Episode 1")).toBeInTheDocument();
    // Episode 2 row
    expect(screen.getByText("Episode 2")).toBeInTheDocument();

    // Action buttons for Episode 1 (not in playlist, unlistened)
    const addButtons = screen.getAllByRole("button", {
      name: "Add to playlist",
    });
    expect(addButtons[0]).toBeDefined();
    await user.click(addButtons[0]!);
    expect(onAddToPlaylist).toHaveBeenCalledWith(101);

    // Action button for Episode 2 (in playlist)
    const removeButtons = screen.getAllByRole("button", {
      name: "Remove from playlist",
    });
    expect(removeButtons[0]).toBeDefined();
    await user.click(removeButtons[0]!);
    expect(onRemoveFromPlaylist).toHaveBeenCalledWith(mockEpisodes[1]);
  });
});
