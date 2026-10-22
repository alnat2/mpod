import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { CachedSubscriptionPodcast } from "@/lib/subscriptions-cache";
import { SubscriptionsMobilePodcastCarousel } from "./subscriptions-mobile-podcast-carousel";

const mockPodcasts: CachedSubscriptionPodcast[] = [
  {
    id: 1,
    title: "First Podcast",
    description: "First description",
    rssUrl: "https://example.com/first.xml",
    lastChecked: null,
    updateTime: null,
    episodes: [],
  },
  {
    id: 2,
    title: "Second Podcast",
    description: "Second description",
    rssUrl: "https://example.com/second.xml",
    lastChecked: null,
    updateTime: null,
    episodes: [],
  },
  {
    id: 3,
    title: "Third Podcast",
    description: "Third description",
    rssUrl: "https://example.com/third.xml",
    lastChecked: null,
    updateTime: null,
    episodes: [],
  },
];

describe("SubscriptionsMobilePodcastCarousel", () => {
  it("renders a carousel with accessibility attributes and podcast cards", () => {
    const onSelectPodcast = vi.fn();
    const onRefreshPodcast = vi.fn();
    const onUnsubscribePodcast = vi.fn();

    render(
      <SubscriptionsMobilePodcastCarousel
        podcasts={mockPodcasts}
        selectedPodcastId={1}
        onSelectPodcast={onSelectPodcast}
        onRefreshPodcast={onRefreshPodcast}
        onUnsubscribePodcast={onUnsubscribePodcast}
        refreshingPodcastIds={new Set()}
        exitingPodcastIds={new Set()}
      />
    );

    const carousel = screen.getByRole("region", {
      name: "Podcast subscriptions",
    });
    expect(carousel).toHaveAttribute("aria-roledescription", "carousel");

    const slides = screen.getAllByRole("group");
    expect(slides).toHaveLength(3);
    expect(slides[0]).toHaveAttribute("aria-roledescription", "slide");
    expect(slides[0]).toHaveAttribute("aria-label", "First Podcast (1 of 3)");

    expect(screen.getByText("First Podcast")).toBeInTheDocument();
    expect(screen.getByText("Second Podcast")).toBeInTheDocument();
    expect(screen.getByText("Third Podcast")).toBeInTheDocument();
  });

  it("applies inert to inactive slides and allows clicking their overlay to select", async () => {
    const user = userEvent.setup();
    const onSelectPodcast = vi.fn();

    render(
      <SubscriptionsMobilePodcastCarousel
        podcasts={mockPodcasts}
        selectedPodcastId={1}
        onSelectPodcast={onSelectPodcast}
        onRefreshPodcast={vi.fn()}
        onUnsubscribePodcast={vi.fn()}
        refreshingPodcastIds={new Set()}
        exitingPodcastIds={new Set()}
      />
    );

    const slides = screen.getAllByRole("group");
    // Slide 1 is active (selectedPodcastId: 1)
    expect(slides[0]!.querySelector("[inert]")).toBeNull();
    // Slide 2 and 3 are inactive
    expect(slides[1]!.querySelector("[inert]")).not.toBeNull();
    expect(slides[2]!.querySelector("[inert]")).not.toBeNull();

    // Click inactive slide 2 overlay
    const selectSecondButton = screen.getByRole("button", {
      name: "Select Second Podcast",
    });
    await user.click(selectSecondButton);

    expect(onSelectPodcast).toHaveBeenCalledWith(2);
  });

  it("handles refresh and unsubscribe actions from the active podcast card", async () => {
    const user = userEvent.setup();
    const onRefreshPodcast = vi.fn();
    const onUnsubscribePodcast = vi.fn();

    render(
      <SubscriptionsMobilePodcastCarousel
        podcasts={mockPodcasts}
        selectedPodcastId={1}
        onSelectPodcast={vi.fn()}
        onRefreshPodcast={onRefreshPodcast}
        onUnsubscribePodcast={onUnsubscribePodcast}
        refreshingPodcastIds={new Set()}
        exitingPodcastIds={new Set()}
      />
    );

    const refreshButtons = screen.getAllByRole("button", { name: "Refresh" });
    expect(refreshButtons[0]).toBeDefined();
    await user.click(refreshButtons[0]!);
    expect(onRefreshPodcast).toHaveBeenCalledWith(1);

    const unsubscribeButtons = screen.getAllByRole("button", {
      name: "Unsubscribe",
    });
    expect(unsubscribeButtons[0]).toBeDefined();
    await user.click(unsubscribeButtons[0]!);
    expect(onUnsubscribePodcast).toHaveBeenCalledWith(mockPodcasts[0]);
  });
});
