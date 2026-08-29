import { HugeiconsIcon } from "@hugeicons/react";
import {
  AudioBook01Icon,
  MultiplicationSignIcon,
  PauseIcon,
  PlayIcon,
  ReplayIcon,
} from "@hugeicons/core-free-icons";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { api, type Audiobook, type AudiobookTrack } from "@/lib/api";
import { cn } from "@/lib/utils";
import { formatDuration } from "@/screens/screen-utils";

import { ModalScreen } from "./modal-screen";

type AudiobookPlaybackChaptersModalProps = {
  audiobook: Audiobook;
  currentTrackId?: number;
  currentDurationSeconds?: number;
  playing: boolean;
  onClose: () => void;
  onPlayTrack: (track: AudiobookTrack) => void | Promise<void>;
};

export function AudiobookPlaybackChaptersModal({
  audiobook,
  currentTrackId,
  currentDurationSeconds = 0,
  playing,
  onClose,
  onPlayTrack,
}: AudiobookPlaybackChaptersModalProps) {
  const tracks = (audiobook.tracks ?? []).filter((track) =>
    Boolean(track.inPlaylist ?? track.isInPlaylist)
  );
  const coverSrc = audiobook.hasCover
    ? api.audiobooks.coverUrl(audiobook.id)
    : "/audiobook-fallback.png";

  return (
    <ModalScreen title={audiobook.title} onClose={onClose}>
      <Card
        data-slot="abook-playback-chapters-modal"
        className="flex w-full min-w-[320px] max-w-[720px] flex-col gap-4 overflow-hidden rounded-[20px] border-border bg-card px-4 py-5 shadow-xl sm:min-w-0 sm:gap-5 sm:p-8"
      >
        <div className="flex items-center gap-6">
          <div className="flex min-w-0 flex-1 items-start gap-2">
            <img
              src={coverSrc}
              alt=""
              className="size-16 shrink-0 rounded-md border border-border bg-muted object-cover"
              onError={(event) => {
                event.currentTarget.src = "/audiobook-fallback.png";
              }}
            />
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-2xl leading-8 font-semibold text-foreground">
                {audiobook.title}
              </h2>
              <p className="truncate text-base leading-6 font-medium text-muted-foreground">
                {audiobook.author}
              </p>
            </div>
          </div>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="size-11 shrink-0 rounded-[10px] border-border bg-background text-foreground shadow-xs hover:bg-background"
            aria-label="Close chapters modal"
            onClick={onClose}
          >
            <HugeiconsIcon
              icon={MultiplicationSignIcon}
              size={24}
              strokeWidth={1.5}
              data-icon-name="hugeicons/cancel-01"
            />
          </Button>
        </div>

        <ScrollArea className="h-[360px] w-full sm:h-[408px] [&_[data-slot=scroll-area-scrollbar]]:w-1.5 [&_[data-slot=scroll-area-scrollbar]]:border-0 [&_[data-slot=scroll-area-scrollbar]]:p-0 [&_[data-slot=scroll-area-thumb]]:bg-muted-foreground">
          <div className="flex flex-col gap-1 pr-6">
            {tracks.map((track) => {
              const current = track.id === currentTrackId;
              const completed = track.isListened && !current;
              const actionLabel = completed
                ? `Replay ${track.title}`
                : current && playing
                  ? `Pause ${track.title}`
                  : `Play ${track.title}`;
              const actionIcon = completed
                ? ReplayIcon
                : current && playing
                  ? PauseIcon
                  : PlayIcon;
              const elapsedLabel = formatDuration(track.positionSeconds);
              const totalLabel = formatDuration(
                current
                  ? currentDurationSeconds || track.duration
                  : track.duration
              );
              const durationLabel = current
                ? [elapsedLabel, totalLabel].filter(Boolean).join(" / ")
                : totalLabel;

              return (
                <div
                  key={track.id}
                  className={cn(
                    "flex h-[70px] shrink-0 items-center gap-3 rounded-sm px-1 text-foreground shadow-xs",
                    current ? "bg-accent" : "bg-card"
                  )}
                  data-current={current ? "true" : undefined}
                  data-completed={completed ? "true" : undefined}
                >
                  <div className="flex min-w-0 flex-1 items-center gap-1">
                    <HugeiconsIcon
                      icon={AudioBook01Icon}
                      className="size-6 shrink-0 text-primary"
                    />
                    <span
                      className={cn(
                        "truncate text-sm leading-5 font-semibold",
                        completed
                          ? "text-muted-foreground"
                          : "text-foreground"
                      )}
                    >
                      {track.title}
                    </span>
                  </div>
                  {!completed && durationLabel ? (
                    <span className="w-20 shrink-0 whitespace-nowrap text-right text-sm leading-5">
                      {durationLabel}
                    </span>
                  ) : null}
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="size-11 shrink-0 rounded-[10px] border-border bg-background text-primary shadow-xs hover:bg-background hover:text-primary"
                    aria-label={actionLabel}
                    onClick={() => void onPlayTrack(track)}
                  >
                    <HugeiconsIcon
                      icon={actionIcon}
                      size={24}
                      strokeWidth={1.5}
                      className="size-6"
                    />
                  </Button>
                </div>
              );
            })}
          </div>
        </ScrollArea>
      </Card>
    </ModalScreen>
  );
}
