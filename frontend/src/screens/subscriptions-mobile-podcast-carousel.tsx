import { useEffect, useState } from "react";

import { PodcastCard } from "@/components/mpod";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  type CarouselApi,
} from "@/components/ui/carousel";
import { api } from "@/lib/api";
import type { CachedSubscriptionPodcast } from "@/lib/subscriptions-cache";
import { cn } from "@/lib/utils";

type SubscriptionsMobilePodcastCarouselProps = {
  exitingPodcastIds: Set<number>;
  onRefreshPodcast: (podcastId: number) => void;
  onSelectPodcast: (podcastId: number) => void;
  onUnsubscribePodcast: (podcast: CachedSubscriptionPodcast) => void;
  podcasts: CachedSubscriptionPodcast[];
  refreshingPodcastIds: Set<number>;
  selectedPodcastId: number | null;
};

export function SubscriptionsMobilePodcastCarousel({
  exitingPodcastIds,
  onRefreshPodcast,
  onSelectPodcast,
  onUnsubscribePodcast,
  podcasts,
  refreshingPodcastIds,
  selectedPodcastId,
}: SubscriptionsMobilePodcastCarouselProps) {
  const isSingle = podcasts.length <= 1;
  const [carouselApi, setCarouselApi] = useState<CarouselApi>();
  const initialIndex = Math.max(
    0,
    podcasts.findIndex((p) => p.id === selectedPodcastId)
  );
  const [activeIndex, setActiveIndex] = useState(initialIndex);

  useEffect(() => {
    if (!carouselApi) return;

    const onSelect = () => {
      const snap = carouselApi.selectedScrollSnap();
      setActiveIndex(snap);
    };

    carouselApi.on("select", onSelect);
    return () => {
      carouselApi.off("select", onSelect);
    };
  }, [carouselApi]);

  useEffect(() => {
    if (!carouselApi) return;

    const onSettle = () => {
      const snap = carouselApi.selectedScrollSnap();
      const targetPodcast = podcasts[snap];
      if (targetPodcast && targetPodcast.id !== selectedPodcastId) {
        onSelectPodcast(targetPodcast.id);
      }
    };

    carouselApi.on("settle", onSettle);
    return () => {
      carouselApi.off("settle", onSettle);
    };
  }, [carouselApi, onSelectPodcast, podcasts, selectedPodcastId]);

  useEffect(() => {
    if (!carouselApi || selectedPodcastId == null) return;
    const targetIndex = podcasts.findIndex((p) => p.id === selectedPodcastId);
    if (targetIndex >= 0 && carouselApi.selectedScrollSnap() !== targetIndex) {
      carouselApi.scrollTo(targetIndex);
      setActiveIndex(targetIndex);
    }
  }, [carouselApi, podcasts, selectedPodcastId]);

  return (
    <Carousel
      setApi={setCarouselApi}
      className={cn(
        "touch-pan-y relative h-[160px] w-full shrink-0 overflow-hidden [&_[data-slot=carousel-content]]:h-full",
        isSingle && "px-5"
      )}
      role="region"
      aria-roledescription="carousel"
      aria-label="Podcast subscriptions"
      opts={{
        align: "center",
        containScroll: false,
        dragFree: false,
        loop: podcasts.length >= 2,
        skipSnaps: false,
        watchDrag: podcasts.length > 1,
      }}
    >
      <CarouselContent className="ml-0 h-full">
        {podcasts.map((podcast, index) => {
          const isActive = index === activeIndex;
          const isExiting = exitingPodcastIds.has(podcast.id);

          return (
            <CarouselItem
              key={podcast.id}
              className={cn(
                "h-[160px] min-w-0 shrink-0 grow-0",
                isSingle ? "basis-full px-0" : "basis-[calc(100%-60px)] px-1.5"
              )}
              role="group"
              aria-roledescription="slide"
              aria-label={`${podcast.title} (${index + 1} of ${podcasts.length})`}
            >
              <div className="relative h-full w-full">
                <div inert={!isActive ? true : undefined} className="h-full w-full">
                  <PodcastCard
                    layout="horizontal"
                    selected={isActive}
                    title={podcast.title}
                    description={podcast.description ?? podcast.rssUrl}
                    artworkUrl={
                      podcast.imageUrl
                        ? api.podcasts.imagePath(podcast.id)
                        : undefined
                    }
                    artworkAlt={`${podcast.title} artwork`}
                    refreshing={refreshingPodcastIds.has(podcast.id)}
                    onSelect={() => {
                      onSelectPodcast(podcast.id);
                      if (!isActive) {
                        carouselApi?.scrollTo(index);
                      }
                    }}
                    onRefresh={() => onRefreshPodcast(podcast.id)}
                    onUnsubscribe={() => onUnsubscribePodcast(podcast)}
                    className={cn(
                      "transition-opacity duration-200 ease-out opacity-100 scale-100",
                      isActive && "shadow-md",
                      isExiting && "pointer-events-none opacity-0"
                    )}
                  />
                </div>
                {!isActive ? (
                  <button
                    type="button"
                    className="absolute inset-0 z-10 cursor-pointer rounded-2xl bg-transparent"
                    onClick={() => {
                      onSelectPodcast(podcast.id);
                      carouselApi?.scrollTo(index);
                    }}
                    aria-label={`Select ${podcast.title}`}
                  />
                ) : null}
              </div>
            </CarouselItem>
          );
        })}
      </CarouselContent>
    </Carousel>
  );
}
