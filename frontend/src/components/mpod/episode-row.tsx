import type {
  DragEventHandler,
  MouseEventHandler,
  PointerEventHandler,
  ReactNode,
} from "react";

import { HugeiconsIcon } from "@hugeicons/react";
import type { IconSvgElement } from "@hugeicons/react";
import {
  DragDropVerticalIcon,
  PauseIcon,
  PlayIcon,
  PlayListRemoveIcon,
  ViewIcon,
} from "@hugeicons/core-free-icons";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import { Artwork } from "./artwork";

type EpisodeRowAction = {
  disabled?: boolean;
  label: string;
  icon: IconSvgElement;
  iconClassName?: string;
  onClick?: () => void;
};

type EpisodeRowProps = {
  className?: string;
  current?: boolean;
  title: string;
  podcastTitle?: string;
  subtitle?: string;
  dateLabel?: string;
  durationLabel?: string;
  thumbnailUrl?: string;
  thumbnailAlt?: string;
  episodeRowId?: number;
  showDragHandle?: boolean;
  draggable?: boolean;
  dragging?: boolean;
  onDragStart?: DragEventHandler<HTMLDivElement>;
  onDragOver?: DragEventHandler<HTMLDivElement>;
  onDrop?: DragEventHandler<HTMLDivElement>;
  onDragEnd?: DragEventHandler<HTMLDivElement>;
  onPointerDown?: PointerEventHandler<HTMLDivElement>;
  onPointerEnter?: PointerEventHandler<HTMLDivElement>;
  onPointerUp?: PointerEventHandler<HTMLDivElement>;
  onPointerCancel?: PointerEventHandler<HTMLDivElement>;
  onMouseDown?: MouseEventHandler<HTMLDivElement>;
  onMouseEnter?: MouseEventHandler<HTMLDivElement>;
  onMouseUp?: MouseEventHandler<HTMLDivElement>;
  actions?: EpisodeRowAction[];
  children?: ReactNode;
};

function EpisodeIconButton({ action }: { action: EpisodeRowAction }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          aria-label={action.label}
          className="rounded-[10px] border-border bg-background text-primary shadow-xs hover:bg-background hover:text-primary"
          disabled={action.disabled}
          variant="outline"
          size="icon-lg"
          type="button"
          onMouseDown={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={action.onClick}
        >
          <HugeiconsIcon
            icon={action.icon}
            className={cn("size-4", action.iconClassName)}
            aria-hidden="true"
          />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{action.label}</TooltipContent>
    </Tooltip>
  );
}

export function EpisodeRow({
  className,
  current,
  title,
  podcastTitle,
  subtitle,
  dateLabel,
  durationLabel,
  thumbnailUrl,
  thumbnailAlt = "",
  episodeRowId,
  showDragHandle = true,
  draggable,
  dragging,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  onPointerDown,
  onPointerEnter,
  onPointerUp,
  onPointerCancel,
  onMouseDown,
  onMouseEnter,
  onMouseUp,
  actions,
  children,
}: EpisodeRowProps) {
  const resolvedActions =
    actions ??
    [
      { label: current ? "Pause" : "Play", icon: current ? PauseIcon : PlayIcon },
      { label: "Remove from playlist", icon: PlayListRemoveIcon },
      { label: "Show notes", icon: ViewIcon },
    ];
  const resolvedSubtitle =
    subtitle ??
    (podcastTitle
      ? current
        ? `${podcastTitle} · now playing`
        : podcastTitle
      : undefined);

  return (
    <div
      className={cn(
        "flex h-[70px] w-full shrink-0 items-center justify-center gap-3 border border-border bg-card px-3 text-foreground",
        draggable && "cursor-grab",
        dragging && "opacity-60",
        current && "bg-accent",
        className
      )}
      data-episode-row-id={episodeRowId}
      draggable={draggable}
      aria-grabbed={dragging || undefined}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      onPointerDown={onPointerDown}
      onPointerEnter={onPointerEnter}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onMouseDown={onMouseDown}
      onMouseEnter={onMouseEnter}
      onMouseUp={onMouseUp}
    >
      {showDragHandle ? (
        <div
          className="flex size-6 shrink-0 items-center justify-center"
          aria-hidden="true"
        >
          <HugeiconsIcon icon={DragDropVerticalIcon} className="size-6" />
        </div>
      ) : null}
      <Artwork
        className="size-10"
        src={thumbnailUrl}
        alt={thumbnailAlt}
        title={podcastTitle ?? resolvedSubtitle}
      />
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-1">
        <p className="truncate text-sm leading-5 font-semibold">{title}</p>
        {resolvedSubtitle ? (
          <p
            className={cn(
              "truncate text-xs leading-4 text-muted-foreground",
              current && "text-chart-5"
            )}
          >
            {resolvedSubtitle}
          </p>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-2 text-right text-xs leading-4 whitespace-nowrap text-muted-foreground">
        {dateLabel ? <span>{dateLabel}</span> : null}
        {durationLabel ? <span>{durationLabel}</span> : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {children ?? resolvedActions.map((action) => (
          <EpisodeIconButton action={action} key={action.label} />
        ))}
      </div>
    </div>
  );
}
