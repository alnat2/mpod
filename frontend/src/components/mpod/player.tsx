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
}: {
  label: string;
  icon: IconSvgElement;
  onClick?: () => void;
  primary?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          aria-label={label}
          className={cn(
            "inline-flex shrink-0 items-center justify-center rounded-full text-foreground outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
            primary
              ? "size-12 bg-primary text-primary-foreground shadow-2xs"
              : "size-8 hover:bg-muted"
          )}
          type="button"
          onClick={onClick}
        >
          <HugeiconsIcon icon={icon} className="size-8" aria-hidden="true" />
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
        "flex w-full max-w-[480px] flex-col items-center justify-center gap-4 rounded-2xl border border-border bg-card px-12 py-5 text-center text-card-foreground shadow-xs",
        className
      )}
    >
      <Artwork
        className="size-40 rounded-lg"
        src={artworkUrl}
        alt={artworkAlt}
        title={podcastTitle}
      />
      <div className="flex w-full flex-col gap-2">
        <h2 className="line-clamp-2 text-lg leading-7 font-bold">{title}</h2>
        <p className="truncate text-sm leading-5 text-muted-foreground">
          {podcastTitle}
        </p>
      </div>
      <div className="flex w-full flex-col gap-2">
        <Progress
          aria-label="Seek playback position"
          className={cn(
            "h-2 bg-primary/20",
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
      <div className="flex items-center justify-center gap-4">
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
      <div className="flex items-center justify-center gap-3">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" type="button">
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
