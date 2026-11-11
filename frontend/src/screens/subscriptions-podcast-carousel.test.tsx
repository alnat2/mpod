import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SubscriptionsPodcastCarousel } from "./subscriptions-podcast-carousel";

const onCarouselRender = vi.fn();
vi.mock("@/components/ui/carousel", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/ui/carousel")>();
  return {
    ...actual,
    Carousel: (props: Record<string, unknown>) => {
      onCarouselRender(props);
      return actual.Carousel(props as any);
    },
  };
});

const mockPodcasts = [
  { id: 1, title: "Podcast 1" },
  { id: 2, title: "Podcast 2" },
  { id: 3, title: "Podcast 3" },
];

describe("SubscriptionsPodcastCarousel", () => {
  it("renders podcast items and navigation controls", () => {
    render(
      <SubscriptionsPodcastCarousel
        podcasts={mockPodcasts}
        renderPodcastCard={(p) => <div data-testid={`card-${p.id}`}>{p.title}</div>}
      />
    );

    expect(screen.getByTestId("card-1")).toBeInTheDocument();
    expect(screen.getByTestId("card-2")).toBeInTheDocument();
    expect(screen.getByTestId("card-3")).toBeInTheDocument();

    expect(
      screen.getByRole("button", { name: "Previous slide" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Next slide" })
    ).toBeInTheDocument();
  });

  it("configures loop: true when podcasts count >= 2", () => {
    onCarouselRender.mockClear();

    render(
      <SubscriptionsPodcastCarousel
        podcasts={mockPodcasts.slice(0, 2)}
        renderPodcastCard={(p) => <div>{p.title}</div>}
      />
    );

    expect(onCarouselRender).toHaveBeenLastCalledWith(
      expect.objectContaining({
        opts: expect.objectContaining({
          loop: true,
          align: "start",
          containScroll: "trimSnaps",
        }),
      })
    );
  });

  it("configures loop: false when podcasts count < 2", () => {
    onCarouselRender.mockClear();

    render(
      <SubscriptionsPodcastCarousel
        podcasts={mockPodcasts.slice(0, 1)}
        renderPodcastCard={(p) => <div>{p.title}</div>}
      />
    );

    expect(onCarouselRender).toHaveBeenLastCalledWith(
      expect.objectContaining({
        opts: expect.objectContaining({
          loop: false,
          align: "start",
          containScroll: "trimSnaps",
        }),
      })
    );
  });
});
