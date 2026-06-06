import { HugeiconsIcon } from "@hugeicons/react";
import { Loading02Icon, Refresh01Icon } from "@hugeicons/core-free-icons";

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
  refreshing?: boolean;
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
  refreshing = false,
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
        "flex w-full max-w-[320px] flex-col items-center gap-4 rounded-lg border border-border bg-card px-4 py-6 text-center text-card-foreground md:h-[420px] md:max-w-none md:w-[285px] md:gap-5 md:px-3 md:py-5",
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
        <p className="w-full text-center text-xs leading-4 font-normal text-muted-foreground">
          {episodeCountLabel}
        </p>
      </div>
      <div className="flex w-full items-center justify-center gap-3 px-3">
        <Button
          variant="outline"
          className="h-8 flex-1 gap-1.5 rounded-lg px-3 shadow-xs"
          type="button"
          disabled={refreshing}
          onClick={(event) => {
            event.stopPropagation();
            onRefresh?.();
          }}
        >
          <HugeiconsIcon
            icon={refreshing ? Loading02Icon : Refresh01Icon}
            className={refreshing ? "animate-spin" : undefined}
            data-icon="inline-start"
          />
          Refresh
        </Button>
        <Button
          variant="secondary"
          className="h-8 flex-1 gap-1.5 rounded-lg px-3"
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
