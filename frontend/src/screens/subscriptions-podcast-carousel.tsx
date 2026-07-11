import type { ReactNode } from "react";

import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "@/components/ui/carousel";
import { cn } from "@/lib/utils";

type SubscriptionsPodcastCarouselProps<T extends { id: number }> = {
  podcasts: T[];
  renderPodcastCard: (podcast: T) => ReactNode;
};

export function SubscriptionsPodcastCarousel<T extends { id: number }>({
  podcasts,
  renderPodcastCard,
}: SubscriptionsPodcastCarouselProps<T>) {
  return (
    <div className="min-w-0 shrink-0">
      <Carousel
        className="w-full max-w-full overflow-hidden"
        opts={{
          align: "start",
          containScroll: "trimSnaps",
        }}
      >
        <CarouselContent
          className={cn("ml-0 gap-5", podcasts.length < 4 && "justify-center")}
        >
          {podcasts.map((podcast) => (
            <CarouselItem key={podcast.id} className="basis-[285px] pl-0">
              {renderPodcastCard(podcast)}
            </CarouselItem>
          ))}
        </CarouselContent>
        <div className="mt-2 hidden items-center justify-center gap-5 md:flex">
          <CarouselPrevious
            size="icon"
            className="static size-8 translate-x-0 translate-y-0 rounded-full"
          />
          <CarouselNext
            size="icon"
            className="static size-8 translate-x-0 translate-y-0 rounded-full"
          />
        </div>
      </Carousel>
    </div>
  );
}
