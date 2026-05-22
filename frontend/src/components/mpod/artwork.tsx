import { useMemo, useState } from "react";

import { cn } from "@/lib/utils";

type ArtworkProps = {
  alt?: string;
  className?: string;
  imageClassName?: string;
  src?: string | null;
  title?: string;
};

function getArtworkInitials(title?: string) {
  if (!title?.trim()) {
    return "mp";
  }

  return title
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase();
}

export function Artwork({
  alt = "",
  className,
  imageClassName,
  src,
  title,
}: ArtworkProps) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const initials = useMemo(() => getArtworkInitials(title), [title]);
  const showImage = Boolean(src && failedSrc !== src);

  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-muted text-muted-foreground",
        className
      )}
    >
      {showImage ? (
        <img
          className={cn("size-full object-cover", imageClassName)}
          src={src ?? undefined}
          alt={alt}
          onError={() => setFailedSrc(src ?? null)}
        />
      ) : (
        <span className="text-xs font-medium leading-none">{initials}</span>
      )}
    </div>
  );
}
