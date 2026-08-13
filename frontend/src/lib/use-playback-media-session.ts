import { useEffect, useRef, type RefObject } from "react";

import { describeAudioError } from "./playback-audio";
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
  setPlaybackError: (error: string | null) => void;
};

export function usePlaybackMediaSession({
  audioRef,
  currentEpisodeRef,
  currentEpisode,
  playing,
  playingRef,
  userInitiatedPlayRef,
  commitCurrentPlayback,
  setPlaying,
  setPlaybackError,
}: UsePlaybackMediaSessionOptions) {
  const playRequestPendingRef = useRef(false);

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

      if (!audio.paused) {
        playingRef.current = true;
        userInitiatedPlayRef.current = false;
        setPlaying(true);
        return;
      }
      if (playRequestPendingRef.current) {
        return;
      }

      playRequestPendingRef.current = true;
      userInitiatedPlayRef.current = true;
      setPlaybackError(null);
      void (async () => {
        try {
          await audio.play();
          if (audioRef.current !== audio || audio.paused) {
            return;
          }
          playingRef.current = true;
          userInitiatedPlayRef.current = false;
          setPlaying(true);
        } catch (error) {
          playingRef.current = false;
          setPlaying(false);
          setPlaybackError(describeAudioError(error));
        } finally {
          playRequestPendingRef.current = false;
        }
      })();
    };
    const handlePause = () => {
      const audio = audioRef.current;
      if (!audio) {
        return;
      }

      const wasPlaying = playingRef.current || !audio.paused;
      audio.pause();
      if (wasPlaying && playingRef.current) {
        // Some background browser paths do not dispatch a pause event promptly.
        commitCurrentPlayback();
        playingRef.current = false;
        setPlaying(false);
      }
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
    commitCurrentPlayback,
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
