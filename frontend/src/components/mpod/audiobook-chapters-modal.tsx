import { HugeiconsIcon } from "@hugeicons/react";
import {
  AudioBook01Icon,
  MultiplicationSignIcon,
  PlayListAddIcon,
  PlayListRemoveIcon,
} from "@hugeicons/core-free-icons";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
  isMobile = false,
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
          "w-full overflow-hidden border-border bg-card shadow-xl",
          isMobile ? "max-w-[340px] p-4" : "max-w-[720px] p-6",
          className
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-4 border-b border-border pb-4">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <img
              src={coverSrc}
              alt={audiobook.title}
              className="size-12 rounded-lg object-cover bg-muted shrink-0 border border-border"
              onError={(e) => {
                e.currentTarget.src = "/audiobook-fallback.png";
              }}
            />
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-base font-bold text-foreground sm:text-lg">
                {audiobook.title}
              </h2>
              <p className="truncate text-xs text-muted-foreground sm:text-sm">
                {audiobook.author}
              </p>
            </div>
          </div>

          <Button
            type="button"
            variant="outline"
            size="icon"
            className="size-9 rounded-lg border-border text-foreground hover:bg-accent shrink-0 sm:size-10"
            aria-label="Close chapters modal"
            onClick={onClose}
          >
            <HugeiconsIcon
              icon={MultiplicationSignIcon}
              size={18}
              strokeWidth={1.5}
              data-icon-name="hugeicons/cancel-01"
            />
          </Button>
        </div>

        {/* Chapters List */}
        <div className="mt-4 flex max-h-[420px] flex-col gap-2 overflow-y-auto pr-1">
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
                  className="flex items-center justify-between gap-3 rounded-lg border border-transparent p-3 text-foreground transition-colors hover:bg-accent/40"
                >
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <HugeiconsIcon
                      icon={AudioBook01Icon}
                      size={20}
                      strokeWidth={1.5}
                      data-icon-name="hugeicons/audio-book-01"
                      className="text-primary shrink-0"
                    />
                    <span className="truncate text-sm font-semibold text-foreground">
                      {track.title}
                    </span>
                  </div>

                  <div className="flex shrink-0 items-center gap-3">
                    {trackDurationFormatted && (
                      <span className="text-xs text-muted-foreground whitespace-nowrap sm:text-sm">
                        {trackDurationFormatted}
                      </span>
                    )}

                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="size-9 rounded-lg border-border bg-card text-primary hover:bg-accent hover:text-primary sm:size-10"
                      aria-label={
                        inPlaylist
                          ? `Remove ${track.title} from playlist`
                          : `Add ${track.title} to playlist`
                      }
                      onClick={() => onToggleTrackPlaylist?.(track)}
                    >
                      <HugeiconsIcon
                        icon={inPlaylist ? PlayListRemoveIcon : PlayListAddIcon}
                        size={18}
                        strokeWidth={1.5}
                        data-icon-name={
                          inPlaylist
                            ? "hugeicons/play-list-remove"
                            : "hugeicons/play-list-add"
                        }
                      />
                    </Button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </Card>
    </ModalScreen>
  );
}
