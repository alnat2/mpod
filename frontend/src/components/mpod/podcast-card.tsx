import { HugeiconsIcon } from "@hugeicons/react";
import { Loading02Icon } from "@hugeicons/core-free-icons";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

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
    <Card
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
        "h-[420px] w-[285px] items-center gap-5 rounded-lg px-3 py-5 text-center",
        onSelect && "cursor-pointer outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
        selected && "border-ring bg-secondary",
        className
      )}
    >
      <div className="size-[200px] overflow-hidden rounded-lg border border-border bg-muted">
        {artworkUrl ? (
          <img
            className="size-full object-cover"
            src={artworkUrl}
            alt={artworkAlt}
          />
        ) : null}
      </div>
      <div className="flex w-full flex-col items-center justify-center gap-3">
        <div className="flex w-full flex-col gap-1">
          <h3 className="truncate text-xl leading-7 font-semibold text-card-foreground">
            {title}
          </h3>
          <p className="line-clamp-2 text-base leading-6 text-muted-foreground">
            {description}
          </p>
        </div>
        <p className="w-full text-xs leading-4 text-muted-foreground">
          {episodeCountLabel}
        </p>
      </div>
      <div className="flex items-center justify-center gap-2">
        <Button
          variant="outline"
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onRefresh?.();
          }}
        >
          <HugeiconsIcon icon={Loading02Icon} data-icon="inline-start" />
          Refresh
        </Button>
        <Button
          variant="secondary"
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onUnsubscribe?.();
          }}
        >
          Unsubscribe
        </Button>
      </div>
    </Card>
  );
}
