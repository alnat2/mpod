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
  cancelAutoAdvance: () => void;
};

function getEpisodeArtworkUrl(episode: QueueEpisode): string {
  if (episode.audiobookId) {
    return `/api/audiobooks/${episode.audiobookId}/cover`;
  }
  if (episode.podcastImageUrl) {
    return episode.podcastImageUrl;
  }
  if (episode.podcastId) {
    return `/api/podcasts/${episode.podcastId}/image`;
  }
  if (episode.coverUrl) {
    return episode.coverUrl;
  }
  return "/icon-512.png";
}

function createArtworkList(artworkUrl: string): MediaImage[] {
  const origin =
    typeof window !== "undefined" && window.location?.origin
      ? window.location.origin
      : "";
  const absoluteUrl = origin ? new URL(artworkUrl, origin).href : artworkUrl;
  const fallbackIcon = origin
    ? new URL("/icon-512.png", origin).href
    : "/icon-512.png";

  return [
    { src: absoluteUrl, sizes: "512x512", type: "image/png" },
    { src: absoluteUrl, sizes: "256x256", type: "image/png" },
    { src: absoluteUrl, sizes: "192x192", type: "image/png" },
    { src: absoluteUrl, sizes: "128x128", type: "image/png" },
    { src: absoluteUrl, sizes: "96x96", type: "image/png" },
    { src: fallbackIcon, sizes: "512x512", type: "image/png" },
  ];
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
  cancelAutoAdvance,
}: UsePlaybackMediaSessionOptions) {
  const handlePlayRef = useRef<(() => void) | null>(null);
  const handlePauseRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    handlePlayRef.current = () => {
      const audio = audioRef.current;
      if (!audio || !currentEpisodeRef.current || !audio.src) {
        return;
      }

      // Play is idempotent while a source is still preparing or buffering.
      if (!audio.paused || playingRef.current) {
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
      cancelAutoAdvance();
      userInitiatedPlayRef.current = false;
      playingRef.current = false;
      setPlaying(false);
      audio.pause();
      if (wasPlaying && !audio.ended) {
        commitCurrentPlayback();
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
    cancelAutoAdvance,
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
      if (!currentEpisode) {
        navigator.mediaSession.metadata = null;
        return;
      }

      if (typeof MediaMetadata !== "undefined") {
        const artworkUrl = getEpisodeArtworkUrl(currentEpisode);
        const isAudiobook =
          currentEpisode.type === "audiobook" ||
          Boolean(currentEpisode.audiobookId);
        const artist =
          currentEpisode.author || currentEpisode.podcastTitle || "mpod";
        const album =
          currentEpisode.podcastTitle ||
          (isAudiobook ? "Audiobook" : "Podcast");

        navigator.mediaSession.metadata = new MediaMetadata({
          title: currentEpisode.title || "mpod",
          artist,
          album,
          artwork: createArtworkList(artworkUrl),
        });
      }
    } catch {
      // Ignore if MediaMetadata is not supported
    }
  }, [currentEpisode]);

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
}
