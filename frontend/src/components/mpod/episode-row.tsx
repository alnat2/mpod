import type {
  DragEventHandler,
  MouseEventHandler,
  PointerEventHandler,
  ReactNode,
} from "react";

import { HugeiconsIcon } from "@hugeicons/react";
import type { IconSvgElement } from "@hugeicons/react";
import {
  Menu09Icon,
  PauseIcon,
  PlayIcon,
  PlayListRemoveIcon,
  ViewIcon,
} from "@hugeicons/core-free-icons";

import downloadedStatusIcon from "@/assets/episode-downloaded-status.svg";
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
  compactMobile?: boolean;
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

function EpisodeStatusIcon({
  className,
  src,
}: {
  className?: string;
  src: string;
}) {
  return (
    <span
      className="flex size-4 shrink-0 items-center justify-center"
      data-episode-status-icon="downloaded"
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

function EpisodeIconButton({
  action,
}: {
  action: EpisodeRowAction;
  mobile?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          aria-label={action.label}
          className={cn(
            "size-11 rounded-[10px] border-border bg-background text-primary shadow-xs hover:bg-background hover:text-primary [&_svg]:size-6"
          )}
          disabled={action.disabled}
          variant="outline"
          type="button"
          onMouseDown={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={action.onClick}
        >
          <HugeiconsIcon
            icon={action.icon}
            className={cn("size-6", action.iconClassName)}
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
  compactMobile = false,
  current,
  downloaded = false,
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
  const resolvedSubtitle = subtitle ?? podcastTitle;
  const mobileInfoLabel = current ? "Now playing" : resolvedSubtitle;
  const desktopActions = children ?? resolvedActions.map((action) => (
    <EpisodeIconButton action={action} key={action.label} />
  ));

  return (
    <div
      className={cn(
        "w-full shrink-0 bg-card text-foreground shadow-xs",
        isMobile
          ? cn(
              "relative grid grid-cols-[minmax(0,1fr)_auto] gap-x-2 gap-y-2 overflow-hidden rounded-[16px] py-3 pr-3 pl-8",
              compactMobile
                ? "h-[96px] grid-rows-[20px_44px]"
                : "h-[116px] grid-rows-[40px_44px]"
            )
          : isDesktop
            ? "flex h-[70px] items-center gap-3 rounded px-3"
            : "relative grid h-[116px] grid-cols-[minmax(0,1fr)_auto] grid-rows-[40px_44px] gap-x-2 gap-y-2 overflow-hidden rounded-[16px] py-3 pr-3 pl-8 md:flex md:h-[70px] md:items-center md:gap-3 md:rounded md:px-3 md:py-0",
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
          className={cn(
            "flex shrink-0 items-center justify-center",
            isMobile
              ? "absolute top-1/2 left-0 size-8 -translate-y-1/2"
              : isDesktop
                ? "size-6"
                : "absolute top-1/2 left-0 size-8 -translate-y-1/2 md:static md:size-6 md:translate-y-0"
          )}
          aria-hidden="true"
          data-episode-drag-handle="true"
        >
          <HugeiconsIcon
            icon={Menu09Icon}
            className={cn(isMobile ? "size-5" : isDesktop ? "size-6" : "size-5 md:size-6")}
          />
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
          isMobile
            ? "contents"
            : isDesktop
              ? "flex min-w-0 flex-1 flex-col justify-center gap-1"
              : "contents md:flex md:min-w-0 md:flex-1 md:flex-col md:justify-center md:gap-1"
        )}
      >
        <p
          className={cn(
            "min-w-0 text-sm leading-5 font-semibold",
            isMobile
              ? cn(
                  "col-span-2 self-center",
                  compactMobile ? "truncate" : "line-clamp-2"
                )
              : isDesktop
                ? "truncate"
                : "col-span-2 line-clamp-2 self-center md:line-clamp-1"
          )}
        >
          {title}
        </p>
        {!isDesktop ? (
          <div
            className={cn(
              "grid h-10 min-w-0 grid-cols-[auto_minmax(0,1fr)] grid-rows-2 gap-x-1 gap-y-1 self-center",
              !isMobile && "md:hidden"
            )}
          >
            <div className="col-span-2 flex min-w-0 items-center gap-0.5 text-chart-5">
              {downloaded ? (
                <EpisodeStatusIcon className="size-full" src={downloadedStatusIcon} />
              ) : null}
              {mobileInfoLabel ? (
                <p className="min-w-0 flex-1 truncate text-xs leading-4">
                  {mobileInfoLabel}
                </p>
              ) : null}
            </div>
            {durationLabel ? (
              <span className="self-start whitespace-nowrap text-xs leading-4 text-muted-foreground">
                {durationLabel}
              </span>
            ) : null}
            {dateLabel ? (
              <span className="self-start text-right whitespace-nowrap text-xs leading-4 text-muted-foreground">
                {dateLabel}
              </span>
            ) : null}
          </div>
        ) : null}
        {!isMobile && resolvedSubtitle ? (
          <p
            className={cn(
              "truncate text-xs leading-4 text-muted-foreground",
              !isDesktop && "hidden md:block",
              current && "text-chart-5"
            )}
          >
            {current ? `${resolvedSubtitle} · now playing` : resolvedSubtitle}
          </p>
        ) : null}
      </div>
      {!isMobile ? (
        <div
          className={cn(
            "shrink-0 text-right text-xs leading-4 whitespace-nowrap text-muted-foreground",
            isDesktop
              ? "flex flex-row items-center gap-2"
              : "hidden md:flex md:flex-row md:items-center md:gap-2"
          )}
        >
          {dateLabel ? <span>{dateLabel}</span> : null}
          {durationLabel ? <span>{durationLabel}</span> : null}
        </div>
      ) : null}
      {!isDesktop ? (
        <div className={cn("shrink-0 items-center gap-2", isMobile ? "flex self-center" : "flex self-center md:hidden")}>
          {resolvedActions.map((action) => (
            <EpisodeIconButton action={action} key={action.label} mobile />
          ))}
        </div>
      ) : null}
      {!isMobile ? (
        <div className={cn("shrink-0 items-center gap-2", isDesktop ? "flex" : "hidden md:flex")}>
          {desktopActions}
        </div>
      ) : null}
    </div>
  );
}
