import { HugeiconsIcon } from "@hugeicons/react";
import { Refresh01Icon } from "@hugeicons/core-free-icons";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { Artwork } from "./artwork";

type PodcastCardProps = {
  className?: string;
  selected?: boolean;
  title: string;
  description: string;
  episodeCountLabel: string;
  artworkUrl?: string;
  artworkAlt?: string;
  onSelect?: () => void;
  onRefresh?: () => void;
  onUnsubscribe?: () => void;
};

export function PodcastCard({
  className,
  selected,
  title,
  description,
  episodeCountLabel,
  artworkUrl,
  artworkAlt = "",
  onSelect,
  onRefresh,
  onUnsubscribe,
}: PodcastCardProps) {
  return (
    <div
      role={onSelect ? "button" : undefined}
      tabIndex={onSelect ? 0 : undefined}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (!onSelect) {
          return;
        }

        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect();
        }
      }}
      className={cn(
        "flex h-[420px] w-[285px] flex-col items-center gap-5 rounded-lg border border-border bg-card px-3 py-5 text-center text-card-foreground",
        onSelect && "cursor-pointer outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
        selected && "border-4 border-[#9AE600]",
        className
      )}
    >
      <Artwork
        className="size-[200px] rounded-lg"
        src={artworkUrl}
        alt={artworkAlt}
        title={title}
      />
      <div className="flex w-full flex-col items-center justify-center gap-3">
        <div className="flex w-full flex-col items-center gap-1 text-center">
          <h3 className="w-full truncate text-xl leading-7 font-semibold text-card-foreground">
            {title}
          </h3>
          <p className="line-clamp-2 w-full text-base leading-6 font-normal text-muted-foreground">
            {description}
          </p>
        </div>
        <p className="w-full text-center text-xs leading-4 text-muted-foreground">
          {episodeCountLabel}
        </p>
      </div>
      <div className="flex items-center justify-center gap-2">
        <Button
          variant="outline"
          className="h-8 gap-1.5 rounded-lg px-3 shadow-xs"
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onRefresh?.();
          }}
        >
          <HugeiconsIcon icon={Refresh01Icon} data-icon="inline-start" />
          Refresh
        </Button>
        <Button
          variant="secondary"
          className="h-8 gap-1.5 rounded-lg px-3"
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onUnsubscribe?.();
          }}
        >
          Unsubscribe
        </Button>
      </div>
    </div>
  );
}
