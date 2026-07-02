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
  MoreVerticalIcon,
  PauseIcon,
  PlayIcon,
  PlayListRemoveIcon,
  ViewIcon,
} from "@hugeicons/core-free-icons";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
  layout?: "auto" | "desktop" | "mobile";
  title: string;
  podcastTitle?: string;
  subtitle?: string;
  dateLabel?: string;
  durationLabel?: string;
  thumbnailUrl?: string;
  thumbnailAlt?: string;
  showArtwork?: boolean;
  episodeRowId?: number;
  showDragHandle?: boolean;
  mobileMenuAction?: EpisodeRowAction;
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

function EpisodeActionsMenu({
  action,
  items,
}: {
  action: EpisodeRowAction;
  items: EpisodeRowAction[];
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          aria-label={action.label}
          className="rounded-[10px] border-border bg-background text-primary shadow-xs hover:bg-background hover:text-primary"
          variant="outline"
          size="icon-lg"
          type="button"
          onMouseDown={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
        >
          <HugeiconsIcon
            icon={action.icon}
            className={cn("size-4", action.iconClassName)}
            aria-hidden="true"
          />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={8}>
        {items.map((item) => (
          <DropdownMenuItem
            key={item.label}
            disabled={item.disabled}
            onSelect={() => item.onClick?.()}
          >
            <HugeiconsIcon
              icon={item.icon}
              className={cn("size-4", item.iconClassName)}
              aria-hidden="true"
            />
            {item.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function EpisodeRow({
  className,
  current,
  layout = "auto",
  title,
  podcastTitle,
  subtitle,
  dateLabel,
  durationLabel,
  thumbnailUrl,
  thumbnailAlt = "",
  showArtwork = true,
  episodeRowId,
  showDragHandle = true,
  mobileMenuAction,
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
  const isMobile = layout === "mobile";
  const isDesktop = layout === "desktop";
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
  const resolvedMobileMenuAction = mobileMenuAction ?? {
    label: "More actions",
    icon: MoreVerticalIcon,
  };
  const desktopActions = children ?? resolvedActions.map((action) => (
    <EpisodeIconButton action={action} key={action.label} />
  ));

  return (
    <div
      className={cn(
        "flex w-full shrink-0 items-center rounded shadow-xs bg-card text-foreground",
        isMobile
          ? "h-[76px] gap-2 overflow-hidden px-2 py-2"
          : isDesktop
            ? "h-[70px] gap-3 px-3"
            : "h-[76px] gap-2 overflow-hidden px-2 py-2 md:h-[70px] md:gap-3 md:px-3 md:py-0",
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
      {showArtwork ? (
        <Artwork
          className={cn(
            "size-10",
            isMobile ? "hidden" : isDesktop ? "block" : "hidden md:block"
          )}
          src={thumbnailUrl}
          alt={thumbnailAlt}
          title={podcastTitle ?? resolvedSubtitle}
        />
      ) : null}
      <div
        className={cn(
          "flex min-w-0 flex-1 flex-col justify-center",
          isDesktop ? "gap-1" : "gap-0.5 md:gap-1"
        )}
      >
        <p
          className={cn(
            "min-w-0 text-sm leading-5 font-semibold",
            isMobile ? "line-clamp-2" : isDesktop ? "truncate" : "line-clamp-2 md:line-clamp-1"
          )}
        >
          {title}
        </p>
        {resolvedSubtitle ? (
          <p
            className={cn(
              isMobile
                ? "min-w-0 truncate text-xs leading-4 text-muted-foreground"
                : "truncate text-xs leading-4 text-muted-foreground",
              (current || resolvedSubtitle.toLowerCase().includes("playlist")) && "text-chart-5"
            )}
          >
            {resolvedSubtitle}
          </p>
        ) : null}
      </div>
      <div
        className={cn(
          "flex shrink-0 text-right text-xs leading-4 whitespace-nowrap text-muted-foreground",
          isMobile
            ? "w-12 flex-col items-end justify-center gap-1"
            : isDesktop
              ? "flex-row items-center gap-2"
              : "flex-col items-end justify-center gap-0.5 md:flex-row md:items-center md:gap-2"
        )}
      >
        {dateLabel ? <span>{dateLabel}</span> : null}
        {durationLabel ? <span>{durationLabel}</span> : null}
      </div>
      <div
        className={cn(
          "shrink-0 items-center gap-2",
          isMobile ? "flex" : isDesktop ? "hidden" : "flex md:hidden"
        )}
      >
        <EpisodeActionsMenu
          action={resolvedMobileMenuAction}
          items={resolvedActions}
        />
      </div>
      <div
        className={cn(
          "shrink-0 items-center gap-2",
          isMobile ? "hidden" : isDesktop ? "flex" : "hidden md:flex"
        )}
      >
        {desktopActions}
      </div>
    </div>
  );
}
