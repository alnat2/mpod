import { HugeiconsIcon } from "@hugeicons/react";
import {
  AudioBook01Icon,
  MultiplicationSignIcon,
  PlayListAddIcon,
  PlayListRemoveIcon,
} from "@hugeicons/core-free-icons";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ModalScreen } from "./modal-screen";
import { cn } from "@/lib/utils";
import { api, type Audiobook, type AudiobookTrack } from "@/lib/api";
import { formatDuration } from "@/screens/screen-utils";

export type AudiobookChaptersModalProps = {
  audiobook: Audiobook;
  onToggleTrackPlaylist?: (track: AudiobookTrack) => void | Promise<void>;
  onClose: () => void;
  isMobile?: boolean;
  className?: string;
};

export function AudiobookChaptersModal({
  audiobook,
  onToggleTrackPlaylist,
  onClose,
  className,
}: AudiobookChaptersModalProps) {
  const tracks = audiobook.tracks ?? [];
  const coverSrc = audiobook.hasCover
    ? api.audiobooks.coverUrl(audiobook.id)
    : "/audiobook-fallback.png";

  return (
    <ModalScreen title={audiobook.title} onClose={onClose}>
      <Card
        data-slot="abook-chapters-modal"
        className={cn(
          "flex w-full min-w-[320px] max-w-[720px] flex-col gap-4 overflow-hidden rounded-[20px] border-0 bg-card px-4 py-5 shadow-xl ring-1 ring-border sm:min-w-0 sm:gap-5 sm:p-8",
          className
        )}
      >
        <div className="flex items-center gap-6">
          <div className="flex min-w-0 flex-1 items-start gap-2 overflow-hidden">
            <img
              src={coverSrc}
              alt={audiobook.title}
              className="size-16 shrink-0 rounded-md border border-border bg-muted object-cover"
              onError={(e) => {
                e.currentTarget.src = "/audiobook-fallback.png";
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

        <ScrollArea className="h-[360px] w-full sm:h-[408px] [&_[data-slot=scroll-area-scrollbar]]:w-1.5 [&_[data-slot=scroll-area-scrollbar]]:border-0 [&_[data-slot=scroll-area-scrollbar]]:p-0 [&_[data-slot=scroll-area-thumb]]:bg-muted-foreground [&_[data-slot=scroll-area-viewport]>div]:!block [&_[data-slot=scroll-area-viewport]>div]:!min-w-0 [&_[data-slot=scroll-area-viewport]>div]:!w-full">
          <div className="flex w-full min-w-0 flex-col gap-1 overflow-hidden pr-6">
            {tracks.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No chapters found.
              </p>
            ) : (
              tracks.map((track) => {
                const inPlaylist = Boolean(track.inPlaylist ?? track.isInPlaylist);
                const trackDurationFormatted = formatDuration(track.duration);

                return (
                  <div
                    key={track.id}
                    data-slot="chapter-item"
                    data-in-playlist={inPlaylist ? "true" : undefined}
                    className="flex h-[70px] w-full min-w-0 shrink-0 items-center gap-3 overflow-hidden rounded-sm bg-card px-1 text-foreground shadow-xs"
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-1">
                      <HugeiconsIcon
                        icon={AudioBook01Icon}
                        size={24}
                        strokeWidth={1.5}
                        data-icon-name="hugeicons/audio-book-01"
                        className="shrink-0 text-primary"
                      />
                      <span className="truncate text-sm leading-5 font-semibold text-foreground">
                        {track.title}
                      </span>
                    </div>

                    {trackDurationFormatted && (
                      <span className="w-20 shrink-0 whitespace-nowrap text-right text-sm leading-5 text-foreground">
                        {trackDurationFormatted}
                      </span>
                    )}

                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="size-11 shrink-0 rounded-[10px] border-border bg-background text-primary shadow-xs hover:bg-background hover:text-primary"
                      aria-label={
                        inPlaylist
                          ? `Remove ${track.title} from playlist`
                          : `Add ${track.title} to playlist`
                      }
                      onClick={() => onToggleTrackPlaylist?.(track)}
                    >
                      <HugeiconsIcon
                        icon={inPlaylist ? PlayListRemoveIcon : PlayListAddIcon}
                        size={24}
                        strokeWidth={1.5}
                        data-icon-name={
                          inPlaylist
                            ? "hugeicons/play-list-remove"
                            : "hugeicons/play-list-add"
                        }
                      />
                    </Button>
                  </div>
                );
              })
            )}
          </div>
        </ScrollArea>
      </Card>
    </ModalScreen>
  );
}
