import { useEffect, useRef, type RefObject } from "react";

import type { QueueEpisode } from "./playback-context-types";

type UsePlaybackMediaSessionOptions = {
  audioRef: RefObject<HTMLAudioElement | null>;
  currentEpisodeRef: RefObject<QueueEpisode | null>;
  currentEpisode: QueueEpisode | null;
  playing: boolean;
  playingRef: RefObject<boolean>;
  userInitiatedPlayRef: RefObject<boolean>;
  commitCurrentPlayback: () => void;
  setPlaying: (playing: boolean) => void;
  playToggle: () => void;
};

export type MediaSessionTrackItem = {
  id: number;
  type?: "episode" | "audiobook" | string;
  audiobookId?: number;
  title?: string;
  author?: string;
  podcastTitle?: string;
  podcastImageUrl?: string | null;
  coverUrl?: string | null;
  hasCover?: boolean;
};

export function updateMediaSessionMetadata(
  item: MediaSessionTrackItem | QueueEpisode | null | undefined
) {
  if (
    typeof navigator === "undefined" ||
    !("mediaSession" in navigator) ||
    !navigator.mediaSession
  ) {
    return;
  }

  if (!item) {
    try {
      navigator.mediaSession.metadata = null;
    } catch {
      // Ignore unsupported operations
    }
    return;
  }

  const isAudiobook =
    item.type === "audiobook" || Boolean("audiobookId" in item && item.audiobookId);
  const title = item.title || "";
  const artist = isAudiobook
    ? item.author || item.podcastTitle || "Audiobook"
    : item.podcastTitle || item.author || "";
  const album = isAudiobook
    ? item.title || "Audiobook"
    : item.podcastTitle || "";

  let artworkUrl: string | null = null;
  if (isAudiobook) {
    if (item.hasCover) {
      artworkUrl =
        item.coverUrl ||
        `/api/audiobooks/${("audiobookId" in item && item.audiobookId) ? item.audiobookId : item.id}/cover`;
    } else if (item.coverUrl) {
      artworkUrl = item.coverUrl;
    }
  } else if (item.podcastImageUrl) {
    artworkUrl = item.podcastImageUrl;
  }

  const artwork: MediaImage[] =
    artworkUrl && typeof artworkUrl === "string" && artworkUrl.trim().length > 0
      ? [{ src: artworkUrl }]
      : [];

  try {
    if (typeof MediaMetadata !== "undefined") {
      navigator.mediaSession.metadata = new MediaMetadata({
        title,
        artist,
        album,
        artwork,
      });
    } else {
      navigator.mediaSession.metadata = {
        title,
        artist,
        album,
        artwork,
      } as unknown as MediaMetadata;
    }
  } catch {
    // Gracefully handle environments with partial MediaSession support
  }
}

export function usePlaybackMediaSession({
  audioRef,
  currentEpisodeRef,
  currentEpisode,
  playing,
  playingRef,
  userInitiatedPlayRef,
  commitCurrentPlayback,
  setPlaying,
  playToggle,
}: UsePlaybackMediaSessionOptions) {
  const handlePlayRef = useRef<(() => void) | null>(null);
  const handlePauseRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    handlePlayRef.current = () => {
      const audio = audioRef.current;
      if (!audio || !currentEpisodeRef.current || !audio.src) {
        return;
      }

      if (!audio.paused) {
        playingRef.current = true;
        userInitiatedPlayRef.current = false;
        setPlaying(true);
        return;
      }

      playToggle();
    };

    handlePauseRef.current = () => {
      const audio = audioRef.current;
      if (!audio) {
        return;
      }

      const wasPlaying = playingRef.current || !audio.paused;
      audio.pause();
      if (wasPlaying && playingRef.current) {
        commitCurrentPlayback();
        playingRef.current = false;
        setPlaying(false);
      }
    };
  }, [
    audioRef,
    currentEpisodeRef,
    commitCurrentPlayback,
    playingRef,
    setPlaying,
    userInitiatedPlayRef,
    playToggle,
  ]);

  useEffect(() => {
    if (
      typeof navigator === "undefined" ||
      !("mediaSession" in navigator) ||
      !navigator.mediaSession
    ) {
      return;
    }

    const mediaSession = navigator.mediaSession;

    const registeredActions: MediaSessionAction[] = [];
    const registerAction = (
      action: MediaSessionAction,
      handler: MediaSessionActionHandler
    ) => {
      try {
        mediaSession.setActionHandler(action, handler);
        registeredActions.push(action);
      } catch {
        // Ignore individual actions unsupported by this browser.
      }
    };

    registerAction("play", () => handlePlayRef.current?.());
    registerAction("pause", () => handlePauseRef.current?.());

    return () => {
      for (const action of registeredActions) {
        try {
          mediaSession.setActionHandler(action, null);
        } catch {
          // The browser may remove Media Session support while the page is inactive.
        }
      }
    };
  }, []);

  useEffect(() => {
    if (
      typeof navigator === "undefined" ||
      !("mediaSession" in navigator) ||
      !navigator.mediaSession
    ) {
      return;
    }

    try {
      navigator.mediaSession.playbackState = currentEpisode
        ? playing
          ? "playing"
          : "paused"
        : "none";
    } catch {
      // Playback still works when the browser exposes only partial Media Session support.
    }
  }, [currentEpisode, playing]);

  useEffect(() => {
    updateMediaSessionMetadata(currentEpisode);
  }, [currentEpisode]);
}
