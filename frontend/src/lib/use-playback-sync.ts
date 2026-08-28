import {
  useCallback,
  useEffect,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";

import {
  defaultAudiobookPlaybackSpeed,
  defaultPlaybackSpeed,
  isPlaybackSpeedLabel,
  type PlaybackSpeedLabel,
} from "@/components/mpod/playback";
import { api, type PlaybackState } from "./api";
import { clampPosition, setAudioPosition } from "./playback-audio";
import type { QueueEpisode } from "./playback-context-types";
import { useLatestRequest } from "./use-latest-request";

type UsePlaybackSyncOptions = {
  audioRef: RefObject<HTMLAudioElement | null>;
  sourcePrimedRef: RefObject<boolean>;
  sourceReadyRef: RefObject<boolean>;
  currentEpisodeRef: RefObject<QueueEpisode | null>;
  currentEpisodeDurationRef: RefObject<number>;
  playingRef: RefObject<boolean>;
  queueRef?: RefObject<QueueEpisode[]>;
  playing: boolean;
  currentEpisodeId: number | undefined;
  setQueue: Dispatch<SetStateAction<QueueEpisode[]>>;
  setActiveEpisodeId: Dispatch<SetStateAction<number | null>>;
  setLoading: Dispatch<SetStateAction<boolean>>;
  setPositionSeconds: Dispatch<SetStateAction<number>>;
  setSpeedLabel: Dispatch<SetStateAction<PlaybackSpeedLabel>>;
  setAudiobookSpeedLabel: Dispatch<SetStateAction<PlaybackSpeedLabel>>;
};

function isNewerPlaybackState(
  nextPlayback: PlaybackState | null,
  currentPlayback: PlaybackState | null | undefined
) {
  if (!nextPlayback) {
    return false;
  }
  if (!currentPlayback) {
    return true;
  }

  return (
    new Date(nextPlayback.lastUpdated).getTime() >
    new Date(currentPlayback.lastUpdated).getTime()
  );
}

export function usePlaybackSync({
  audioRef,
  sourcePrimedRef,
  sourceReadyRef,
  currentEpisodeRef,
  currentEpisodeDurationRef,
  playingRef,
  queueRef,
  playing,
  currentEpisodeId,
  setQueue,
  setActiveEpisodeId,
  setLoading,
  setPositionSeconds,
  setSpeedLabel,
  setAudiobookSpeedLabel,
}: UsePlaybackSyncOptions) {
  const queueRequests = useLatestRequest();
  const settingsRequests = useLatestRequest();
  const writePlaybackState = useCallback(
    (episodeId: number, playback: PlaybackState | null) => {
      setQueue((current) =>
        current.map((episode) =>
          episode.id === episodeId ? { ...episode, playback } : episode
        )
      );
    },
    [setQueue]
  );

  const commitPlayback = useCallback(
    async (
      nextPositionSeconds: number,
      options: {
        completed?: boolean;
        didSeek?: boolean;
        episodeId?: number;
        durationSeconds?: number;
      } = {}
    ) => {
      const episode = currentEpisodeRef.current;
      const isAudiobook = episode?.type === "audiobook" || Boolean(episode?.audiobookId);
      const trackId = isAudiobook ? episode?.trackId : undefined;
      const episodeId = isAudiobook
        ? (episode?.audiobookId ?? episode?.id)
        : (options.episodeId ?? episode?.id);
      if (episodeId == null && trackId == null) return null;

      try {
        const durationSeconds =
          options.durationSeconds ?? currentEpisodeDurationRef.current;
        return await api.playback.update({
          episodeId,
          trackId,
          positionSeconds: Math.round(
            clampPosition(nextPositionSeconds, durationSeconds)
          ),
          durationSeconds: Math.round(durationSeconds),
          completed: options.completed ?? false,
          didSeek: options.didSeek ?? false,
          clientUpdatedAt: new Date().toISOString(),
        });
      } catch {
        // Silently fail for background sync.
        return null;
      }
    },
    [currentEpisodeDurationRef, currentEpisodeRef]
  );

  const commitPlaybackBeacon = useCallback(
    (nextPositionSeconds: number) => {
      const episode = currentEpisodeRef.current;
      if (
        !episode ||
        typeof navigator === "undefined" ||
        !navigator.sendBeacon
      ) {
        return false;
      }

      const isAudiobook = episode.type === "audiobook" || Boolean(episode.audiobookId);
      const durationSeconds = currentEpisodeDurationRef.current;
      const body = JSON.stringify({
        episodeId: isAudiobook ? (episode.audiobookId ?? episode.id) : episode.id,
        trackId: isAudiobook ? episode.trackId : undefined,
        positionSeconds: Math.round(
          clampPosition(nextPositionSeconds, durationSeconds)
        ),
        durationSeconds: Math.round(durationSeconds),
        completed: false,
        didSeek: false,
        clientUpdatedAt: new Date().toISOString(),
      });

      return navigator.sendBeacon(
        "/api/playback",
        new Blob([body], { type: "application/json" })
      );
    },
    [currentEpisodeDurationRef, currentEpisodeRef]
  );

  const commitCurrentPlayback = useCallback(
    (options: { beacon?: boolean } = {}) => {
      const audio = audioRef.current;
      if (!audio || !currentEpisodeRef.current) {
        return;
      }

      if (options.beacon && commitPlaybackBeacon(audio.currentTime)) {
        return;
      }

      void commitPlayback(audio.currentTime);
    },
    [audioRef, commitPlayback, commitPlaybackBeacon, currentEpisodeRef]
  );

  const commitActivePlayback = useCallback(
    async (episodeId: number) => {
      const queued = queueRef?.current?.find((item) => item.id === episodeId);
      const episode = queued ?? currentEpisodeRef.current;
      const isAudiobook =
        episode?.type === "audiobook" || Boolean(episode?.audiobookId);
      try {
        if (isAudiobook) {
          await api.playback.setActive({
            audiobookId: episode?.audiobookId ?? episodeId,
            trackId: episode?.trackId,
          });
        } else {
          await api.playback.setActive(episodeId);
        }
      } catch (error) {
        console.error("Failed to update active playback", error);
      }
    },
    [currentEpisodeRef, queueRef]
  );

  const refreshPlaybackState = useCallback(
    async (
      episode: QueueEpisode,
      options: { applyEvenIfNotNewer?: boolean } = {}
    ) => {
      try {
        const response = await api.playback.get(episode.id);
        const nextPlayback = response.playback;
        const shouldApply =
          options.applyEvenIfNotNewer ||
          isNewerPlaybackState(nextPlayback, episode.playback);

        if (!shouldApply) {
          return episode;
        }

        writePlaybackState(episode.id, nextPlayback);

        const current = currentEpisodeRef.current;
        if (current?.id === episode.id && nextPlayback) {
          const nextPosition = clampPosition(
            nextPlayback.positionSeconds,
            currentEpisodeDurationRef.current
          );
          const audio = audioRef.current;
          if (audio && sourcePrimedRef.current && sourceReadyRef.current) {
            const positionApplied = setAudioPosition(audio, nextPosition);
            setPositionSeconds(positionApplied ? nextPosition : 0);
          } else {
            setPositionSeconds(nextPosition);
          }
        }

        return { ...episode, playback: nextPlayback };
      } catch {
        return episode;
      }
    },
    [
      audioRef,
      currentEpisodeDurationRef,
      currentEpisodeRef,
      setPositionSeconds,
      sourcePrimedRef,
      sourceReadyRef,
      writePlaybackState,
    ]
  );

  const loadPlaybackSettings = useCallback(async () => {
    const requestGeneration = settingsRequests.beginRequest();
    try {
      const response = await api.settings.get();
      if (!settingsRequests.isLatestRequest(requestGeneration)) {
        return;
      }
      const nextSpeed = response.settings.playbackSpeed;
      setSpeedLabel(
        isPlaybackSpeedLabel(nextSpeed) ? nextSpeed : defaultPlaybackSpeed
      );
	  const nextAudiobookSpeed = response.settings.audiobookPlaybackSpeed;
	  setAudiobookSpeedLabel(
		nextAudiobookSpeed && isPlaybackSpeedLabel(nextAudiobookSpeed)
		  ? nextAudiobookSpeed
		  : defaultAudiobookPlaybackSpeed
	  );
    } catch (error) {
      console.error("Failed to load playback settings", error);
    }
  }, [setAudiobookSpeedLabel, setSpeedLabel, settingsRequests]);

  const loadQueue = useCallback(async () => {
    const requestGeneration = queueRequests.beginRequest();
    try {
      const response = await api.playback.queue();
      if (!queueRequests.isLatestRequest(requestGeneration)) {
        return null;
      }
      setQueue(response.queue);
      const nextActiveEpisodeId =
        response.activePlayback?.episodeId ??
        response.activePlayback?.audiobookId ??
        null;
      setActiveEpisodeId(
        nextActiveEpisodeId !== null &&
          response.queue.some((episode) => episode.id === nextActiveEpisodeId)
          ? nextActiveEpisodeId
          : null
      );
      return response;
    } catch (error) {
      console.error("Failed to load playback queue", error);
      return null;
    } finally {
      if (queueRequests.isLatestRequest(requestGeneration)) {
        setLoading(false);
      }
    }
  }, [queueRequests, setActiveEpisodeId, setLoading, setQueue]);

  const reloadQueue = useCallback(async () => {
    await loadQueue();
  }, [loadQueue]);

  useEffect(() => {
    const syncVisiblePlaybackState = (event: Event) => {
      if (
        event.type === "pageshow" &&
        !(event as PageTransitionEvent).persisted
      ) {
        return;
      }

      if (document.visibilityState !== "visible") {
        return;
      }

      void loadPlaybackSettings();

      if (playingRef.current) {
        return;
      }

      void loadQueue();
    };

    window.addEventListener("focus", syncVisiblePlaybackState);
    window.addEventListener("pageshow", syncVisiblePlaybackState);
    document.addEventListener("visibilitychange", syncVisiblePlaybackState);

    return () => {
      window.removeEventListener("focus", syncVisiblePlaybackState);
      window.removeEventListener("pageshow", syncVisiblePlaybackState);
      document.removeEventListener("visibilitychange", syncVisiblePlaybackState);
    };
  }, [loadPlaybackSettings, loadQueue, playingRef]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadQueue();
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [loadQueue]);

  useEffect(() => {
    void loadPlaybackSettings();
  }, [loadPlaybackSettings]);

  useEffect(() => {
    if (!playing || !currentEpisodeId) return;

    const intervalId = window.setInterval(() => {
      if (audioRef.current) {
        void commitPlayback(audioRef.current.currentTime);
      }
    }, 15000);

    return () => window.clearInterval(intervalId);
  }, [audioRef, commitPlayback, currentEpisodeId, playing]);

  useEffect(() => {
    const flushPlaybackState = () => {
      commitCurrentPlayback({ beacon: true });
    };

    window.addEventListener("pagehide", flushPlaybackState);
    document.addEventListener("visibilitychange", flushPlaybackState);

    return () => {
      window.removeEventListener("pagehide", flushPlaybackState);
      document.removeEventListener("visibilitychange", flushPlaybackState);
    };
  }, [commitCurrentPlayback]);

  return {
    commitPlayback,
    commitCurrentPlayback,
    commitActivePlayback,
    refreshPlaybackState,
    loadQueue,
    reloadQueue,
  };
}
