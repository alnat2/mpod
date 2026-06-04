import { useState } from "react";
import type { PointerEvent } from "react";

import { HugeiconsIcon } from "@hugeicons/react";
import type { IconSvgElement } from "@hugeicons/react";
import {
  ArrowDown01Icon,
  GoBackward10SecIcon,
  GoForward15SecIcon,
  NoteIcon,
  PauseIcon,
  PlayIcon,
} from "@hugeicons/core-free-icons";

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
        "flex w-full max-w-[320px] flex-col items-center justify-center gap-4 rounded-2xl border border-border bg-card px-6 py-4 text-center text-card-foreground shadow-xs md:max-w-[480px] md:px-12 md:py-5",
        className
      )}
    >
      <Artwork
        className="size-[120px] rounded-lg md:size-40"
        src={artworkUrl}
        alt={artworkAlt}
        title={podcastTitle}
      />
      <div className="flex w-full flex-col gap-2">
        <h2 className="line-clamp-2 text-xl leading-7 font-bold md:text-lg">
          {title}
        </h2>
        <p className="truncate text-sm leading-5 text-muted-foreground">
          {podcastTitle}
        </p>
      </div>
      <div className="flex w-full flex-col gap-2">
        <Progress
          aria-label="Seek playback position"
          className={cn(
            "h-4 bg-primary/20 md:h-2",
            onProgressSeek && "cursor-pointer"
          )}
          value={progressValue}
          onPointerDown={handleProgressPointerDown}
        />
        <div className="flex h-[18px] w-full items-center justify-between text-xs leading-4 text-muted-foreground">
          <span>{elapsedLabel}</span>
          <span>{durationLabel}</span>
        </div>
      </div>
      <div className="hidden items-center justify-center gap-4 md:flex">
        <TransportButton
          label="Go back 10 seconds"
          icon={GoBackward10SecIcon}
          onClick={onBack}
        />
        <TransportButton
          label={playing ? "Pause" : "Play"}
          icon={playing ? PauseIcon : PlayIcon}
          onClick={onPlay}
          primary
        />
        <TransportButton
          label="Go forward 15 seconds"
          icon={GoForward15SecIcon}
          onClick={onForward}
        />
      </div>
      <div className="flex w-full items-center justify-between md:hidden">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={activeSpeedLabel}
              className="inline-flex size-11 shrink-0 items-center justify-center rounded-[10px] border-2 border-primary bg-card text-lg leading-7 font-medium text-primary shadow-xs outline-none transition-colors hover:bg-muted focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              {compactSpeedLabel(activeSpeedLabel)}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-[274px]">
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
          label="Go back 10 seconds"
          icon={GoBackward10SecIcon}
          className="size-11 hover:bg-transparent"
          iconClassName="size-11"
          onClick={onBack}
        />
        <TransportButton
          label={playing ? "Pause" : "Play"}
          icon={playing ? PauseIcon : PlayIcon}
          onClick={onPlay}
          primary
        />
        <TransportButton
          label="Go forward 15 seconds"
          icon={GoForward15SecIcon}
          className="size-11 hover:bg-transparent"
          iconClassName="size-11"
          onClick={onForward}
        />
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label="Notes"
              disabled={notesDisabled}
              className="inline-flex size-11 shrink-0 items-center justify-center rounded-full text-primary outline-none transition-colors hover:bg-muted focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:text-muted-foreground disabled:opacity-50"
              onClick={onNotes}
            >
              <HugeiconsIcon
                icon={NoteIcon}
                className="size-11"
                aria-hidden="true"
              />
            </button>
          </TooltipTrigger>
          <TooltipContent>Notes</TooltipContent>
        </Tooltip>
      </div>
      <div className="hidden items-center justify-center gap-3 md:flex">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button className="h-9 shadow-xs" variant="outline" type="button">
              {activeSpeedLabel}
              <HugeiconsIcon
                icon={ArrowDown01Icon}
                className="size-4"
                data-icon="inline-end"
                aria-hidden="true"
              />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
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
        <Button
          className="h-9 rounded-[10px] px-2.5 shadow-xs"
          variant="outline"
          type="button"
          disabled={notesDisabled}
          onClick={onNotes}
        >
          <HugeiconsIcon
            icon={NoteIcon}
            className="size-4"
            data-icon="inline-start"
            aria-hidden="true"
          />
          Notes
        </Button>
      </div>
    </section>
  );
}
