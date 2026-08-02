import { useEffect, type RefObject } from "react";

import { attemptAudioPlay, describeAudioError } from "./playback-audio";
import type { QueueEpisode } from "./playback-context-types";

type UsePlaybackMediaSessionOptions = {
  audioRef: RefObject<HTMLAudioElement | null>;
  currentEpisodeRef: RefObject<QueueEpisode | null>;
  currentEpisode: QueueEpisode | null;
  playing: boolean;
  playingRef: RefObject<boolean>;
  userInitiatedPlayRef: RefObject<boolean>;
  setPlaying: (playing: boolean) => void;
  setPlaybackError: (error: string | null) => void;
};

export function usePlaybackMediaSession({
  audioRef,
  currentEpisodeRef,
  currentEpisode,
  playing,
  playingRef,
  userInitiatedPlayRef,
  setPlaying,
  setPlaybackError,
}: UsePlaybackMediaSessionOptions) {
  useEffect(() => {
    if (
      typeof navigator === "undefined" ||
      !("mediaSession" in navigator) ||
      !navigator.mediaSession
    ) {
      return;
    }

    const mediaSession = navigator.mediaSession;
    const handlePlay = () => {
      const audio = audioRef.current;
      if (!audio || !currentEpisodeRef.current || !audio.src) {
        return;
      }

      userInitiatedPlayRef.current = true;
      setPlaybackError(null);
      void attemptAudioPlay(audio, (error) => {
        playingRef.current = false;
        setPlaying(false);
        setPlaybackError(describeAudioError(error));
      });
    };
    const handlePause = () => {
      audioRef.current?.pause();
    };

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

    registerAction("play", handlePlay);
    registerAction("pause", handlePause);

    return () => {
      for (const action of registeredActions) {
        try {
          mediaSession.setActionHandler(action, null);
        } catch {
          // The browser may remove Media Session support while the page is inactive.
        }
      }
    };
  }, [
    audioRef,
    currentEpisodeRef,
    playingRef,
    setPlaybackError,
    setPlaying,
    userInitiatedPlayRef,
  ]);

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
