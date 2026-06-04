import { useState } from "react";

import { cn } from "@/lib/utils";

type ArtworkProps = {
  alt?: string;
  className?: string;
  imageClassName?: string;
  src?: string | null;
  title?: string;
};

const FALLBACK_ARTWORK_SRC = "/podcast_fallback.png";

export function Artwork({
  alt = "",
  className,
  imageClassName,
  src,
}: ArtworkProps) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  const showRemoteImage = Boolean(src && failedSrc !== src);
  const remoteImageLoaded = Boolean(src && loadedSrc === src);

  return (
    <div
      className={cn(
        "relative flex shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-muted text-muted-foreground",
        className
      )}
    >
      <img
        className={cn("size-full object-cover", imageClassName)}
        src={FALLBACK_ARTWORK_SRC}
        alt={showRemoteImage ? "" : alt}
      />
      {showRemoteImage ? (
        <img
          className={cn(
            "absolute inset-0 size-full object-cover transition-opacity duration-150",
            remoteImageLoaded ? "opacity-100" : "opacity-0",
            imageClassName
          )}
          src={src ?? undefined}
          alt={alt}
          onLoad={() => setLoadedSrc(src ?? null)}
          onError={() => setFailedSrc(src ?? null)}
        />
      ) : null}
    </div>
  );
}
