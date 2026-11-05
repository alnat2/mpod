import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import type {
  CachedSubscriptionEpisode,
  CachedSubscriptionPodcast,
} from "@/lib/subscriptions-cache";
import { SubscriptionsDesktopEpisodeList } from "./subscriptions-desktop-episode-list";

const mockEpisodes: CachedSubscriptionEpisode[] = [
  {
    id: 101,
    podcastId: 1,
    title: "Desktop Episode 1",
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
    title: "Desktop Episode 2",
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
  title: "Desktop Test Podcast",
  description: "Desktop description",
  rssUrl: "https://example.com/test.xml",
  lastChecked: null,
  updateTime: null,
  episodes: mockEpisodes,
};

describe("SubscriptionsDesktopEpisodeList", () => {
  it("renders summary and triggers actions", async () => {
    const user = userEvent.setup();
    const onAddToPlaylist = vi.fn();
    const onMarkAllListened = vi.fn();
    const onMarkListened = vi.fn();
    const onRemoveFromPlaylist = vi.fn();
    const onShowNotes = vi.fn();

    render(
      <TooltipProvider>
        <SubscriptionsDesktopEpisodeList
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

    // Summary label (total episodes / unlistened episodes)
    expect(screen.getByText("2 / 1 episodes")).toBeInTheDocument();

    // Mark all listened button
    const markAllButton = screen.getByRole("button", {
      name: "Mark all listened",
    });
    expect(markAllButton).toBeInTheDocument();
    await user.click(markAllButton);
    expect(onMarkAllListened).toHaveBeenCalledWith(1);
  });

  it("renders safely when podcast has no episodes array (regression for showAll)", () => {
    const podcastWithoutEpisodes: CachedSubscriptionPodcast = {
      id: 2,
      title: "Podcast Without Episodes",
      description: "Description",
      rssUrl: "https://example.com/feed.xml",
      lastChecked: null,
      updateTime: null,
      episodes: undefined as unknown as CachedSubscriptionEpisode[],
    };

    render(
      <TooltipProvider>
        <SubscriptionsDesktopEpisodeList
          podcast={podcastWithoutEpisodes}
          visibleEpisodes={[]}
          onAddToPlaylist={vi.fn()}
          onMarkAllListened={vi.fn()}
          onMarkListened={vi.fn()}
          onRemoveFromPlaylist={vi.fn()}
          onShowNotes={vi.fn()}
        />
      </TooltipProvider>
    );

    expect(screen.getByText("0 / 0 episodes")).toBeInTheDocument();
  });
});
