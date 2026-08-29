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

  return (
    <div
      data-slot="fm-item"
      className={cn(
        "flex h-[70px] w-full items-center gap-3 rounded-sm bg-card px-1 text-foreground shadow-xs transition-colors hover:bg-accent/40",
        onOpen && "cursor-pointer",
        className
      )}
      onClick={handleRowClick}
    >
      <div className="flex min-w-0 flex-1 items-center gap-1">
        {getIcon()}
        <span
          className={cn(
            "min-w-0 flex-1 text-sm leading-5 font-semibold text-foreground",
            isMobile ? "line-clamp-2" : "truncate"
          )}
        >
          {title}
        </span>
      </div>

      <div
        className="flex shrink-0 items-center gap-2"
        onClick={(event) => event.stopPropagation()}
      >
        {formattedDuration && (
          <span className="w-20 whitespace-nowrap text-right text-sm leading-5 text-foreground">
            {formattedDuration}
          </span>
        )}

        {isActionable && onTogglePlaylist && (
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="size-11 rounded-[10px] border-border bg-background text-primary shadow-xs hover:bg-background hover:text-primary"
            aria-label={inPlaylist ? "Remove from playlist" : "Add to playlist"}
            onClick={onTogglePlaylist}
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
        )}
      </div>
    </div>
  );
}
