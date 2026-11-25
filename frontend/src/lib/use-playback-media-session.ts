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
  sourceReadyRef?: RefObject<boolean>;
  seekForward?: () => void;
  seekBackward?: () => void;
  seekTo?: (seconds: number) => void;
  positionSeconds?: number;
  duration?: number | null;
  speedLabel?: string;
};

function getEpisodeArtworkUrl(episode: QueueEpisode): string {
  const isAudiobook =
    episode.type === "audiobook" || Boolean(episode.audiobookId);
  const bookId = episode.audiobookId ?? episode.id;

  if (isAudiobook && bookId) {
    if (episode.hasCover) {
      return `/api/audiobooks/${bookId}/cover`;
    }
    return "/audiobook-fallback.png";
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

  return [
    { src: absoluteUrl, sizes: "512x512" },
    { src: absoluteUrl, sizes: "256x256" },
    { src: absoluteUrl, sizes: "192x192" },
    { src: absoluteUrl, sizes: "128x128" },
    { src: absoluteUrl, sizes: "96x96" },
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
  sourceReadyRef,
  seekForward,
  seekBackward,
  seekTo,
  positionSeconds,
  duration,
  speedLabel,
}: UsePlaybackMediaSessionOptions) {
  const handlePlayRef = useRef<(() => void) | null>(null);
  const handlePauseRef = useRef<(() => void) | null>(null);
  const handleSeekForwardRef = useRef<(() => void) | undefined>(seekForward);
  const handleSeekBackwardRef = useRef<(() => void) | undefined>(seekBackward);
  const handleSeekToRef = useRef<((seconds: number) => void) | undefined>(seekTo);

  useEffect(() => {
    handleSeekForwardRef.current = seekForward;
    handleSeekBackwardRef.current = seekBackward;
    handleSeekToRef.current = seekTo;
  }, [seekForward, seekBackward, seekTo]);

  useEffect(() => {
    handlePlayRef.current = () => {
      const audio = audioRef.current;
      if (!audio || !currentEpisodeRef.current || !audio.src) {
        return;
      }

      // If audio is already playing, Play is an idempotent no-op.
      if (!audio.paused) {
        return;
      }

      // Play is idempotent while a source is still preparing or buffering.
      const isBuffering = sourceReadyRef ? !sourceReadyRef.current : false;
      if (playingRef.current && isBuffering) {
        playingRef.current = true;
        userInitiatedPlayRef.current = false;
        setPlaying(true);
        return;
      }

      // Audio is paused and source is ready (or paused by OS/Chrome).
      // Reset playingRef to false so playToggle can initiate resume.
      if (playingRef.current) {
        playingRef.current = false;
        setPlaying(false);
      }

      playToggle();

      // Synchronously signal to MediaSession the actual state after playToggle
      // (avoiding stale "playing" state if playToggle was an early no-op).
      if (
        typeof navigator !== "undefined" &&
        "mediaSession" in navigator &&
        navigator.mediaSession
      ) {
        try {
          if (playingRef.current || userInitiatedPlayRef.current) {
            navigator.mediaSession.playbackState = "playing";
          } else {
            navigator.mediaSession.playbackState = "paused";
          }
        } catch {
          // Ignore partial MediaSession support
        }
      }
    };

    handlePauseRef.current = () => {
      const audio = audioRef.current;
      if (!audio) {
        return;
      }

      if (
        typeof navigator !== "undefined" &&
        "mediaSession" in navigator &&
        navigator.mediaSession
      ) {
        try {
          navigator.mediaSession.playbackState = "paused";
        } catch {
          // Ignore partial MediaSession support
        }
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
    sourceReadyRef,
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
    registerAction("seekforward", () => handleSeekForwardRef.current?.());
    registerAction("seekbackward", () => handleSeekBackwardRef.current?.());
    registerAction("seekto", (details) => {
      if (details.seekTime !== undefined && Number.isFinite(details.seekTime)) {
        handleSeekToRef.current?.(details.seekTime);
      }
    });

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

  useEffect(() => {
    if (
      typeof navigator === "undefined" ||
      !("mediaSession" in navigator) ||
      !navigator.mediaSession ||
      typeof navigator.mediaSession.setPositionState !== "function"
    ) {
      return;
    }

    const audio = audioRef.current;
    if (!currentEpisode || !audio) {
      return;
    }

    const dur = duration ?? audio.duration;
    if (!Number.isFinite(dur) || dur <= 0) {
      return;
    }

    const rawPos = positionSeconds ?? audio.currentTime;
    if (!Number.isFinite(rawPos) || rawPos < 0) {
      return;
    }
    const pos = Math.min(rawPos, dur);

    const rawRate = audio.playbackRate;
    const rate = Number.isFinite(rawRate) && rawRate > 0 ? rawRate : 1;

    try {
      navigator.mediaSession.setPositionState({
        duration: dur,
        playbackRate: rate,
        position: pos,
      });
    } catch {
      // Browsers may throw if position > duration or inputs are invalid.
    }
  }, [audioRef, currentEpisode, duration, positionSeconds, speedLabel]);
}
