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

import downloadedStatusIcon from "@/assets/episode-downloaded-status.svg";
import inPlaylistStatusIcon from "@/assets/episode-in-playlist-status.svg";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import { Artwork } from "./artwork";
import { BottomSheet } from "./bottom-sheet";

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
  downloaded?: boolean;
  inPlaylist?: boolean;
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
  mobileActions?: EpisodeRowAction[];
  children?: ReactNode;
};

function EpisodeStatusIcon({
  className,
  name,
  src,
}: {
  className?: string;
  name: "downloaded" | "in-playlist";
  src: string;
}) {
  return (
    <span
      className="flex size-4 shrink-0 items-center justify-center"
      data-episode-status-icon={name}
      aria-hidden="true"
    >
      <span
        className={cn("block bg-current", className)}
        style={{
          maskImage: `url("${src}")`,
          maskPosition: "center",
          maskRepeat: "no-repeat",
          maskSize: "100% 100%",
          WebkitMaskImage: `url("${src}")`,
          WebkitMaskPosition: "center",
          WebkitMaskRepeat: "no-repeat",
          WebkitMaskSize: "100% 100%",
        }}
      />
    </span>
  );
}

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

function EpisodeActionsSheet({
  action,
  items,
  podcastTitle,
  title,
}: {
  action: EpisodeRowAction;
  items: EpisodeRowAction[];
  podcastTitle?: string;
  title: string;
}) {
  return (
    <BottomSheet
      actions={items}
      subtitle={podcastTitle}
      title={title}
      trigger={
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
      }
    />
  );
}

export function EpisodeRow({
  className,
  current,
  downloaded = false,
  inPlaylist = false,
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
  showDragHandle = false,
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
  mobileActions,
  children,
}: EpisodeRowProps) {
  const isMobile = layout === "mobile";
  const isDesktop = layout === "desktop";
  const showMobileStatusIcons = isMobile && (downloaded || inPlaylist);
  const mobileStatusLabel = [
    downloaded ? "Downloaded" : null,
    inPlaylist ? "In playlist" : null,
  ]
    .filter(Boolean)
    .join(", ");
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
          ? "h-[76px] gap-2 overflow-hidden px-3 py-2"
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
        {showMobileStatusIcons ? (
          <div
            aria-label={mobileStatusLabel}
            className="flex h-4 items-center gap-1 text-chart-5"
            data-episode-status="true"
            role="img"
          >
            {downloaded ? (
              <EpisodeStatusIcon
                className="size-[13.6667px]"
                name="downloaded"
                src={downloadedStatusIcon}
              />
            ) : null}
            {inPlaylist ? (
              <EpisodeStatusIcon
                className="size-4"
                name="in-playlist"
                src={inPlaylistStatusIcon}
              />
            ) : null}
          </div>
        ) : resolvedSubtitle ? (
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
        <EpisodeActionsSheet
          action={resolvedMobileMenuAction}
          items={mobileActions ?? resolvedActions}
          podcastTitle={podcastTitle}
          title={title}
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
