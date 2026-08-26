import * as React from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Folder03Icon,
  FolderAudioIcon,
  AudioBook01Icon,
  PlayListAddIcon,
  PlayListRemoveIcon,
} from "@hugeicons/core-free-icons";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { formatDuration } from "@/screens/screen-utils";

export type FileManagerItemType = "folder" | "audiobook" | "track";

export interface FileManagerItemProps {
  id?: number;
  type: FileManagerItemType;
  title: string;
  duration?: number | string;
  inPlaylist?: boolean;
  onOpen?: () => void;
  onTogglePlaylist?: (e: React.MouseEvent) => void;
  isMobile?: boolean;
  className?: string;
}

export function FileManagerItem({
  type,
  title,
  duration,
  inPlaylist = false,
  onOpen,
  onTogglePlaylist,
  isMobile = false,
  className,
}: FileManagerItemProps) {
  const formattedDuration =
    typeof duration === "string" ? duration : formatDuration(duration);

  const getIcon = () => {
    switch (type) {
      case "folder":
        return (
          <HugeiconsIcon
            icon={Folder03Icon}
            size={24}
            strokeWidth={1.5}
            data-icon-name="hugeicons/folder-03"
            className="text-primary shrink-0"
          />
        );
      case "audiobook":
        return (
          <HugeiconsIcon
            icon={FolderAudioIcon}
            size={24}
            strokeWidth={1.5}
            data-icon-name="hugeicons/folder-audio"
            className="text-primary shrink-0"
          />
        );
      case "track":
        return (
          <HugeiconsIcon
            icon={AudioBook01Icon}
            size={24}
            strokeWidth={1.5}
            data-icon-name="hugeicons/audio-book-01"
            className="text-primary shrink-0"
          />
        );
    }
  };

  const handleRowClick = () => {
    if (onOpen) {
      onOpen();
    }
  };

  const isActionable = type === "audiobook" || type === "track";

  if (isMobile) {
    return (
      <div
        data-slot="fm-item"
        className={cn(
          "flex w-full items-center justify-between gap-3 rounded-xl border border-border bg-card p-3 shadow-xs transition-colors hover:bg-accent/40 cursor-pointer",
          className
        )}
        onClick={handleRowClick}
      >
        <div className="flex min-w-0 flex-1 items-center gap-3">
          {getIcon()}
          <span className="truncate text-sm font-semibold text-foreground">
            {title}
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-2" onClick={(e) => e.stopPropagation()}>
          {formattedDuration && (
            <span className="text-xs text-muted-foreground whitespace-nowrap">
              {formattedDuration}
            </span>
          )}

          {isActionable && onTogglePlaylist && (
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="size-9 rounded-lg border-border text-primary hover:bg-accent hover:text-primary"
              aria-label={inPlaylist ? "Remove from playlist" : "Add to playlist"}
              onClick={onTogglePlaylist}
            >
              <HugeiconsIcon
                icon={inPlaylist ? PlayListRemoveIcon : PlayListAddIcon}
                size={20}
                strokeWidth={1.5}
                data-icon-name={inPlaylist ? "hugeicons/play-list-remove" : "hugeicons/play-list-add"}
              />
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      data-slot="fm-item"
      className={cn(
        "flex h-[70px] w-full items-center justify-between gap-4 border-b border-border bg-background px-4 transition-colors hover:bg-accent/30 cursor-pointer",
        className
      )}
      onClick={handleRowClick}
    >
      <div className="flex min-w-0 flex-1 items-center gap-3">
        {getIcon()}
        <span className="truncate text-sm font-semibold text-foreground">
          {title}
        </span>
      </div>

      <div className="flex shrink-0 items-center gap-4" onClick={(e) => e.stopPropagation()}>
        {formattedDuration && (
          <span className="text-sm text-muted-foreground whitespace-nowrap">
            {formattedDuration}
          </span>
        )}

        {isActionable && onTogglePlaylist && (
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="size-10 rounded-lg border-border text-primary hover:bg-accent hover:text-primary"
            aria-label={inPlaylist ? "Remove from playlist" : "Add to playlist"}
            onClick={onTogglePlaylist}
          >
            <HugeiconsIcon
              icon={inPlaylist ? PlayListRemoveIcon : PlayListAddIcon}
              size={20}
              strokeWidth={1.5}
              data-icon-name={inPlaylist ? "hugeicons/play-list-remove" : "hugeicons/play-list-add"}
            />
          </Button>
        )}
      </div>
    </div>
  );
}
