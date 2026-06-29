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
        "flex w-full flex-col items-center gap-4 rounded-2xl border border-border bg-card p-3 text-card-foreground md:h-[420px] md:max-w-none md:w-[285px] md:gap-5 md:rounded-lg md:px-3 md:py-5 md:text-center",
        onSelect && "cursor-pointer outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
        selected && "bg-accent",
        className
      )}
    >
      <div className="flex w-full flex-row items-center gap-3 md:flex-col md:justify-center md:gap-3">
        <Artwork
          className="size-[88px] shrink-0 rounded-lg md:size-[200px]"
          src={artworkUrl}
          alt={artworkAlt}
          title={title}
        />
        <div className="flex min-w-0 flex-1 flex-col items-start gap-1 text-left md:w-full md:items-center md:text-center">
          <h3 className="w-full truncate text-xl leading-7 font-semibold text-card-foreground">
            {title}
          </h3>
          <p className="line-clamp-2 w-full text-base leading-6 font-normal text-muted-foreground">
            {description}
          </p>
        </div>
      </div>
      <div className="flex w-full items-center justify-center gap-2 md:gap-3 md:px-3">
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
