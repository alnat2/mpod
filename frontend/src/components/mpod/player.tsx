import { useState } from "react";
import type { PointerEvent } from "react";

import { HugeiconsIcon } from "@hugeicons/react";
import type { IconSvgElement } from "@hugeicons/react";
import {
  NoteIcon,
  PauseIcon,
  PlayIcon,
} from "@hugeicons/core-free-icons";

import playerBackwardIcon from "@/assets/player-backward.svg";
import playerPlayIcon from "@/assets/player-play.svg";
import playerSpeedIcon from "@/assets/player-speed.svg";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Progress } from "@/components/ui/progress";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import { Artwork } from "./artwork";
import {
  defaultPlaybackSpeed,
  playbackSpeedOptions,
  type PlaybackSpeedLabel,
} from "./playback";

type PlayerProps = {
  className?: string;
  title: string;
  podcastTitle: string;
  artworkUrl?: string;
  artworkAlt?: string;
  elapsedLabel: string;
  durationLabel: string;
  playing?: boolean;
  progressValue?: number;
  speedLabel?: PlaybackSpeedLabel;
  notesDisabled?: boolean;
  onBack?: () => void;
  onForward?: () => void;
  onPlay?: () => void;
  onProgressSeek?: (progressRatio: number) => void;
  onNotes?: () => void;
  onSpeedChange?: (speed: PlaybackSpeedLabel) => void;
};

function TransportButton({
  label,
  icon,
  onClick,
  primary,
  className,
  iconClassName,
}: {
  label: string;
  icon: IconSvgElement;
  onClick?: () => void;
  primary?: boolean;
  className?: string;
  iconClassName?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          aria-label={label}
          className={cn(
            "inline-flex shrink-0 items-center justify-center rounded-full text-foreground outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
            primary
              ? "size-14 bg-primary text-primary-foreground shadow-2xs md:size-12"
              : "size-11 hover:bg-muted md:size-8",
            className
          )}
          type="button"
          onClick={onClick}
        >
          <HugeiconsIcon
            icon={icon}
            className={cn(primary ? "size-8" : "size-11 md:size-8", iconClassName)}
            aria-hidden="true"
          />
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function compactSpeedLabel(speedLabel: PlaybackSpeedLabel) {
  return speedLabel.replace(/^Speed\s/, "").replace(/x$/, "");
}

function PlayerAssetIcon({
  src,
  name,
  className,
  assetClassName,
}: {
  src: string;
  name: "backward" | "forward" | "play" | "speed";
  className: string;
  assetClassName: string;
}) {
  return (
    <span
      className={cn("relative block shrink-0", className)}
      data-player-icon={name}
      aria-hidden="true"
    >
      <span
        className={cn("absolute bg-current", assetClassName)}
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

function LabeledSeekControl({
  label,
  caption,
  align,
  mirrored,
  onClick,
}: {
  label: string;
  caption: string;
  align: "center" | "end";
  mirrored?: boolean;
  onClick?: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          aria-label={label}
          className={cn(
            "inline-flex size-14 shrink-0 flex-col justify-end rounded-full text-muted-foreground outline-none transition-colors hover:bg-muted focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
            align === "end" ? "items-end" : "items-center"
          )}
          type="button"
          onClick={onClick}
        >
          <span className="flex flex-col items-center justify-end gap-0.5">
            <PlayerAssetIcon
              src={playerBackwardIcon}
              name={mirrored ? "forward" : "backward"}
              className="h-5 w-[33px]"
              assetClassName={cn(
                "inset-[-3.75%_-2.27%]",
                mirrored && "-scale-x-100"
              )}
            />
            <span className="text-xs leading-4 font-semibold">{caption}</span>
          </span>
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export function Player({
  className,
  title,
  podcastTitle,
  artworkUrl,
  artworkAlt = "",
  elapsedLabel,
  durationLabel,
  playing,
  progressValue = 0,
  speedLabel = defaultPlaybackSpeed,
  notesDisabled = true,
  onBack,
  onForward,
  onPlay,
  onProgressSeek,
  onNotes,
  onSpeedChange,
}: PlayerProps) {
  const isSpeedControlled = speedLabel !== undefined && onSpeedChange !== undefined;
  const [uncontrolledSpeedLabel, setUncontrolledSpeedLabel] =
    useState<PlaybackSpeedLabel>(speedLabel ?? defaultPlaybackSpeed);
  const activeSpeedLabel = isSpeedControlled
    ? speedLabel
    : uncontrolledSpeedLabel;

  function handleSpeedChange(value: string) {
    const nextSpeed = value as PlaybackSpeedLabel;
    onSpeedChange?.(nextSpeed);

    if (!isSpeedControlled) {
      setUncontrolledSpeedLabel(nextSpeed);
    }
  }

  function handleProgressPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (!onProgressSeek) return;

    const rect = event.currentTarget.getBoundingClientRect();
    const clickOffset = event.clientX - rect.left;
    const progressRatio = Math.min(1, Math.max(0, clickOffset / rect.width));
    onProgressSeek(progressRatio);
  }

  return (
    <section
      className={cn(
        "flex w-full max-w-80 flex-col items-center justify-center gap-3 rounded-[16px] bg-card px-6 pt-6 pb-4 text-center text-card-foreground shadow-xs ring-1 ring-border ring-inset md:max-w-[480px] md:gap-4 md:px-12 md:py-5",
        className
      )}
    >
      <Artwork
        className="hidden size-40 rounded-lg md:block"
        src={artworkUrl}
        alt={artworkAlt}
        title={podcastTitle}
      />
      <div className="flex w-full flex-col gap-2">
        <h2 className="line-clamp-2 text-lg leading-7 font-bold">
          {title}
        </h2>
        <p className="truncate text-sm leading-5 text-muted-foreground">
          {podcastTitle}
        </p>
      </div>
      <div className="flex w-full flex-col gap-3 md:contents">
        <div className="flex w-full flex-col gap-2 md:contents">
          <div className="flex w-full flex-col gap-2 pb-2 md:pb-0">
            <Progress
              aria-label="Seek playback position"
              className={cn(
                "order-last h-4 bg-muted shadow-lg md:order-first md:h-2 md:bg-muted md:shadow-none",
                onProgressSeek && "cursor-pointer"
              )}
              value={progressValue}
              onPointerDown={handleProgressPointerDown}
            />
            <div className="order-first flex h-[18px] w-full items-center justify-between text-xs leading-4 text-muted-foreground md:order-last">
              <span>{elapsedLabel}</span>
              <span>{durationLabel}</span>
            </div>
          </div>
          <div
            className="flex h-14 w-full items-center justify-between md:hidden"
            data-player-controls="mobile"
          >
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label={activeSpeedLabel}
                  className="inline-flex size-14 shrink-0 flex-col items-start justify-end rounded-full text-muted-foreground outline-none transition-colors hover:bg-muted focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <span className="flex flex-col items-center justify-end gap-0.5">
                    <PlayerAssetIcon
                      src={playerSpeedIcon}
                      name="speed"
                      className="h-5 w-[25px]"
                      assetClassName="inset-[-3.75%_-3%]"
                    />
                    <span className="text-xs leading-4 font-semibold">
                      {compactSpeedLabel(activeSpeedLabel)}
                    </span>
                  </span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuRadioGroup
                  value={activeSpeedLabel}
                  onValueChange={handleSpeedChange}
                >
                  {playbackSpeedOptions.map((option) => (
                    <DropdownMenuRadioItem value={option} key={option}>
                      {option}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
            <TransportButton
              label={playing ? "Pause" : "Play"}
              icon={playing ? PauseIcon : PlayIcon}
              className="shadow-md md:shadow-2xs"
              iconClassName="size-9 md:size-8"
              onClick={onPlay}
              primary
            />
            <LabeledSeekControl
              label="Go back 15 seconds"
              caption="-15"
              align="center"
              onClick={onBack}
            />
            <LabeledSeekControl
              label="Go forward 30 seconds"
              caption="+30"
              align="end"
              mirrored
              onClick={onForward}
            />
          </div>
          <div
            className="hidden h-14 w-full items-end justify-center gap-5 md:flex"
            data-player-controls="desktop"
          >
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  aria-label="Show notes"
                  className="size-14 flex-col justify-end gap-0.5 rounded-full p-0 text-muted-foreground shadow-none"
                  variant="ghost"
                  disabled={notesDisabled}
                  onClick={onNotes}
                >
                  <HugeiconsIcon
                    icon={NoteIcon}
                    className="size-5"
                    aria-hidden="true"
                  />
                  <span className="text-xs leading-4 font-semibold">Notes</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent>Show notes</TooltipContent>
            </Tooltip>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  aria-label={activeSpeedLabel}
                  className="size-14 flex-col justify-end gap-0.5 rounded-full p-0 text-muted-foreground shadow-none"
                  variant="ghost"
                >
                  <PlayerAssetIcon
                    src={playerSpeedIcon}
                    name="speed"
                    className="h-5 w-[25px]"
                    assetClassName="inset-[-3.75%_-3%]"
                  />
                  <span className="text-xs leading-4 font-semibold">
                    {compactSpeedLabel(activeSpeedLabel)}
                  </span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="center">
                <DropdownMenuRadioGroup
                  value={activeSpeedLabel}
                  onValueChange={handleSpeedChange}
                >
                  {playbackSpeedOptions.map((option) => (
                    <DropdownMenuRadioItem value={option} key={option}>
                      {option}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  size="icon"
                  aria-label={playing ? "Pause" : "Play"}
                  className="size-14 rounded-full p-0 shadow-md"
                  onClick={onPlay}
                >
                  {playing ? (
                    <HugeiconsIcon
                      icon={PauseIcon}
                      className="size-[22px]"
                      aria-hidden="true"
                    />
                  ) : (
                    <PlayerAssetIcon
                      src={playerPlayIcon}
                      name="play"
                      className="h-[22px] w-[21px]"
                      assetClassName="inset-0"
                    />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{playing ? "Pause" : "Play"}</TooltipContent>
            </Tooltip>
            <LabeledSeekControl
              label="Go back 15 seconds"
              caption="-15"
              align="center"
              onClick={onBack}
            />
            <LabeledSeekControl
              label="Go forward 30 seconds"
              caption="+30"
              align="center"
              mirrored
              onClick={onForward}
            />
          </div>
        </div>
        <button
          type="button"
          aria-label="Show notes"
          disabled={notesDisabled}
          data-player-action="mobile-notes"
          className="inline-flex h-5 items-center justify-center gap-1 self-center rounded-sm text-sm leading-5 font-medium text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 md:hidden"
          onClick={onNotes}
        >
          <HugeiconsIcon
            icon={NoteIcon}
            className="size-5 text-primary"
            aria-hidden="true"
          />
          Show notes
        </button>
      </div>
    </section>
  );
}
