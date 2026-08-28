import { useState } from "react";

import { HugeiconsIcon } from "@hugeicons/react";
import type { IconSvgElement } from "@hugeicons/react";
import {
  NoteIcon,
  PauseIcon,
  PlayIcon,
  Tick02Icon,
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
import { Slider } from "@/components/ui/slider";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import { Artwork } from "./artwork";
import { BottomSheet } from "./bottom-sheet";
import { GoToTimeModal } from "./go-to-time-modal";
import {
  defaultPlaybackSpeed,
  defaultPodcastPlaybackSpeed,
  defaultAudiobookPlaybackSpeed,
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
  mode?: "episode" | "audiobook";
  hasChapters?: boolean;
  onChapters?: () => void;
  onBack?: () => void;
  onForward?: () => void;
  onPlay?: () => void;
  onProgressSeek?: (progressRatio: number) => void;
  onSeekSeconds?: (seconds: number) => void;
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

function formatSeekTime(seconds: number) {
  const roundedSeconds = Math.max(0, Math.round(seconds));
  const hours = Math.floor(roundedSeconds / 3600);
  const minutes = Math.floor((roundedSeconds % 3600) / 60);
  const remainingSeconds = roundedSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
  }

  return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
}

function seekValueText(progressValue: number, durationSeconds?: number) {
  if (!durationSeconds || durationSeconds <= 0) {
    return `${Math.round(progressValue)}%`;
  }

  const elapsedSeconds = (durationSeconds * progressValue) / 100;
  return `${formatSeekTime(elapsedSeconds)} elapsed, ${formatSeekTime(
    durationSeconds - elapsedSeconds
  )} remaining`;
}

function parseClockLabel(label: string) {
  const parts = label.split(":").map(Number);
  if (
    (parts.length !== 2 && parts.length !== 3) ||
    parts.some((part) => !Number.isFinite(part) || part < 0)
  ) {
    return null;
  }

  return parts.reduce((total, part) => total * 60 + part, 0);
}

function getSeekDurationSeconds(elapsedLabel: string, remainingLabel: string) {
  const elapsedSeconds = parseClockLabel(elapsedLabel);
  const remainingSeconds = parseClockLabel(remainingLabel);
  if (elapsedSeconds === null || remainingSeconds === null) {
    return undefined;
  }

  return elapsedSeconds + remainingSeconds;
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
  speedLabel,
  notesDisabled = true,
  mode = "episode",
  hasChapters = false,
  onChapters,
  onBack,
  onForward,
  onPlay,
  onProgressSeek,
  onSeekSeconds,
  onNotes,
  onSpeedChange,
}: PlayerProps) {
  const isAudiobook = mode === "audiobook";
  const defaultSpeedForMode = isAudiobook
    ? defaultAudiobookPlaybackSpeed
    : defaultPodcastPlaybackSpeed;
  const showChaptersButton = isAudiobook && Boolean(hasChapters);
  const showNotesButton = !isAudiobook;

  const [isGoToTimeOpen, setIsGoToTimeOpen] = useState(false);
  const isSpeedControlled = speedLabel !== undefined && onSpeedChange !== undefined;
  const [uncontrolledSpeedLabel, setUncontrolledSpeedLabel] =
    useState<PlaybackSpeedLabel>(speedLabel ?? defaultSpeedForMode);
  const [pendingProgressValue, setPendingProgressValue] = useState<number | null>(
    null
  );
  const activeSpeedLabel = isSpeedControlled
    ? speedLabel
    : uncontrolledSpeedLabel;
  const normalizedProgressValue = Math.min(100, Math.max(0, progressValue));
  const displayedProgressValue =
    pendingProgressValue ?? normalizedProgressValue;
  const totalDurationSeconds = getSeekDurationSeconds(elapsedLabel, durationLabel) ?? 0;

  function handleSpeedChange(value: string) {
    const nextSpeed = value as PlaybackSpeedLabel;
    onSpeedChange?.(nextSpeed);

    if (!isSpeedControlled) {
      setUncontrolledSpeedLabel(nextSpeed);
    }
  }

  function handleProgressChange(values: number[]) {
    const nextValue = values[0];
    if (nextValue === undefined) return;
    setPendingProgressValue(nextValue);
  }

  function handleProgressCommit(values: number[]) {
    const nextValue = values[0];
    setPendingProgressValue(null);
    if (nextValue === undefined) return;
    onProgressSeek?.(nextValue / 100);
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
            {onProgressSeek ? (
              <Slider
                className="group order-last h-4 cursor-pointer md:order-first md:h-2 [&_[data-slot=slider-range]]:transition-none [&_[data-slot=slider-thumb]]:opacity-0 [&_[data-slot=slider-thumb]]:focus-visible:opacity-100 [&_[data-slot=slider-track]]:h-full [&_[data-slot=slider-track]]:shadow-lg md:[&_[data-slot=slider-track]]:shadow-none"
                min={0}
                max={100}
                step={1}
                value={[displayedProgressValue]}
                thumbProps={{
                  "aria-label": "Seek playback position",
                  "aria-valuetext": seekValueText(
                    displayedProgressValue,
                    getSeekDurationSeconds(elapsedLabel, durationLabel)
                  ),
                }}
                onValueChange={handleProgressChange}
                onValueCommit={handleProgressCommit}
              />
            ) : (
              <Progress
                aria-label="Playback position"
                className="order-last h-4 bg-muted shadow-lg md:order-first md:h-2 md:bg-muted md:shadow-none"
                value={normalizedProgressValue}
              />
            )}
            <div className="order-first flex h-[18px] w-full items-center justify-between text-xs leading-4 text-muted-foreground md:order-last">
              <button
                type="button"
                aria-label={`Go to time (current: ${elapsedLabel})`}
                onClick={() => setIsGoToTimeOpen(true)}
                className="cursor-pointer rounded-xs transition-colors hover:text-foreground focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
              >
                {elapsedLabel}
              </button>
              <span>{durationLabel}</span>
            </div>
          </div>
          <div
            className="flex h-14 w-full items-center justify-between md:hidden"
            data-player-controls="mobile"
          >
            <BottomSheet
              title="Playback speed"
              actions={playbackSpeedOptions.map((option) => ({
                label: option,
                icon: Tick02Icon,
                iconClassName: cn(
                  option !== activeSpeedLabel && "invisible"
                ),
                selected: option === activeSpeedLabel,
                onClick: () => handleSpeedChange(option),
              }))}
              trigger={
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
              }
            />
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
            <LabeledSeekControl
              label="Go back 15 seconds"
              caption="-15"
              align="center"
              onClick={onBack}
            />

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
              label="Go forward 30 seconds"
              caption="+30"
              align="center"
              mirrored
              onClick={onForward}
            />
          </div>

          <div
            className="hidden w-full items-center justify-center gap-5 text-sm font-medium leading-5 text-foreground md:flex"
            data-player-secondary="desktop"
          >
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label={activeSpeedLabel}
                  className="cursor-pointer text-foreground underline decoration-dotted decoration-[10%] underline-offset-4 outline-none transition-colors hover:text-foreground/80 focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {activeSpeedLabel}
                </button>
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

            {showChaptersButton ? (
              <button
                type="button"
                aria-label="Show chapters"
                className="cursor-pointer text-foreground underline decoration-dotted decoration-[10%] underline-offset-4 outline-none transition-colors hover:text-foreground/80 focus-visible:ring-2 focus-visible:ring-ring"
                onClick={onChapters}
              >
                Show chapters
              </button>
            ) : showNotesButton ? (
              <button
                type="button"
                aria-label="Show notes"
                disabled={notesDisabled}
                className="cursor-pointer text-foreground underline decoration-dotted decoration-[10%] underline-offset-4 outline-none transition-colors hover:text-foreground/80 focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
                onClick={onNotes}
              >
                Show notes
              </button>
            ) : null}
          </div>
        </div>

        {showChaptersButton ? (
          <button
            type="button"
            aria-label="Show chapters"
            data-player-action="mobile-chapters"
            className="inline-flex h-5 items-center justify-center gap-1 self-center rounded-sm text-sm leading-5 font-medium text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 md:hidden cursor-pointer"
            onClick={onChapters}
          >
            <HugeiconsIcon
              icon={NoteIcon}
              className="size-5 text-primary"
              aria-hidden="true"
            />
            Show chapters
          </button>
        ) : showNotesButton ? (
          <button
            type="button"
            aria-label="Show notes"
            disabled={notesDisabled}
            data-player-action="mobile-notes"
            className="inline-flex h-5 items-center justify-center gap-1 self-center rounded-sm text-sm leading-5 font-medium text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 md:hidden cursor-pointer"
            onClick={onNotes}
          >
            <HugeiconsIcon
              icon={NoteIcon}
              className="size-5 text-primary"
              aria-hidden="true"
            />
            Show notes
          </button>
        ) : null}
      </div>

      {isGoToTimeOpen && (
        <GoToTimeModal
          totalDurationSeconds={totalDurationSeconds}
          onClose={() => setIsGoToTimeOpen(false)}
          onSeek={(seconds) => {
            if (onSeekSeconds) {
              onSeekSeconds(seconds);
            } else if (onProgressSeek && totalDurationSeconds > 0) {
              onProgressSeek(seconds / totalDurationSeconds);
            }
          }}
        />
      )}
    </section>
  );
}
