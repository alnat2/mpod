import {
  useCallback,
  useEffect,
  useRef,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";

import type { PlaybackSpeedLabel } from "@/components/mpod/playback";
import { api, type PlaybackUpdateResponse } from "./api";
import {
  applyPlaybackRate,
  attemptAudioPlay,
  clampPosition,
  describeAudioError,
  describeMediaError,
  primeAudioSource,
  readAudioDuration,
  reloadAudioSourceAtPosition,
  setAudioPosition,
} from "./playback-audio";
import type { QueueEpisode } from "./playback-context-types";

type CommitPlayback = (
  nextPositionSeconds: number,
  options?: { completed?: boolean; didSeek?: boolean }
) => Promise<PlaybackUpdateResponse | null>;

const DOWNLOADED_SOURCE_POLL_MS = 5000;

type UsePlaybackAudioOptions = {
  audioRef: RefObject<HTMLAudioElement | null>;
  sourcePrimedRef: RefObject<boolean>;
  sourceReadyRef: RefObject<boolean>;
  userInitiatedPlayRef: RefObject<boolean>;
  queueRef: RefObject<QueueEpisode[]>;
  playingRef: RefObject<boolean>;
  currentEpisodeRef: RefObject<QueueEpisode | null>;
  pendingPlayEpisodeIdRef: RefObject<number | null>;
  speedLabelRef: RefObject<PlaybackSpeedLabel>;
  queue: QueueEpisode[];
  currentEpisode: QueueEpisode | null;
  currentEpisodeDuration: number;
  playing: boolean;
  positionSeconds: number;
  speedLabel: PlaybackSpeedLabel;
  setActiveEpisodeId: Dispatch<SetStateAction<number | null>>;
  setQueue: Dispatch<SetStateAction<QueueEpisode[]>>;
  setPlaying: Dispatch<SetStateAction<boolean>>;
  setPlaybackError: Dispatch<SetStateAction<string | null>>;
  setPositionSeconds: Dispatch<SetStateAction<number>>;
  setAudioDuration: Dispatch<
    SetStateAction<{
      episodeId: number;
      durationSeconds: number;
    } | null>
  >;
  commitPlayback: CommitPlayback;
  commitCurrentPlayback: (options?: { beacon?: boolean }) => void;
  commitActivePlayback: (episodeId: number) => Promise<void>;
  refreshPlaybackState: (
    episode: QueueEpisode,
    options?: { applyEvenIfNotNewer?: boolean }
  ) => Promise<QueueEpisode>;
  loadQueue: () => Promise<{
    queue: QueueEpisode[];
    activePlayback?: { episodeId: number } | null;
  } | null>;
};

export function usePlaybackAudio({
  audioRef,
  sourcePrimedRef,
  sourceReadyRef,
  userInitiatedPlayRef,
  queueRef,
  playingRef,
  currentEpisodeRef,
  pendingPlayEpisodeIdRef,
  speedLabelRef,
  queue,
  currentEpisode,
  currentEpisodeDuration,
  playing,
  positionSeconds,
  speedLabel,
  setActiveEpisodeId,
  setQueue,
  setPlaying,
  setPlaybackError,
  setPositionSeconds,
  setAudioDuration,
  commitPlayback,
  commitCurrentPlayback,
  commitActivePlayback,
  refreshPlaybackState,
  loadQueue,
}: UsePlaybackAudioOptions) {
  const sourceSwitchingRef = useRef(false);
  const sourceReloadCleanupRef = useRef<(() => void) | null>(null);
  // Track the source that is actually loaded, independently from fresher queue data.
  const sourceDownloadStateRef = useRef<{
    episodeId: number;
    downloaded: boolean;
  } | null>(null);

  useEffect(() => {
    const audio = new Audio();
    audioRef.current = audio;
    sourcePrimedRef.current = false;
    sourceReadyRef.current = false;

    const onTimeUpdate = () => {
      setPositionSeconds(audio.currentTime);
      const nextDuration = readAudioDuration(audio);
      const episodeId = currentEpisodeRef.current?.id;
      if (nextDuration && episodeId) {
        setAudioDuration({ episodeId, durationSeconds: nextDuration });
      }
    };

    const onPlaying = () => {
      playingRef.current = true;
      setPlaying(true);
      userInitiatedPlayRef.current = false;
      setPlaybackError(null);
    };

    const onPause = () => {
      if (sourceSwitchingRef.current) {
        return;
      }
      const shouldCommitPlayback = playingRef.current;
      playingRef.current = false;
      setPlaying(false);
      if (shouldCommitPlayback) {
        commitCurrentPlayback();
      }
    };

    const startQueuedEpisode = (episode: QueueEpisode) => {
      const nextPosition = episode.playback?.positionSeconds ?? 0;
      setActiveEpisodeId(episode.id);
      void commitActivePlayback(episode.id);
      sourceReadyRef.current = false;
      primeAudioSource(
        audio,
        episode,
        speedLabelRef.current,
        nextPosition,
        setPositionSeconds,
        () => {
          sourcePrimedRef.current = true;
        },
        () => {
          sourceReadyRef.current = true;
          setPlaying(true);
          void attemptAudioPlay(audio, (error) => {
            setPlaying(false);
            setPlaybackError(describeAudioError(error));
          });
        }
      );
      setPlaybackError(null);
    };

    const startBackendFallbackEpisode = async (
      response: PlaybackUpdateResponse | null
    ) => {
      if (response?.nextEpisodeId == null) {
        await loadQueue();
        return;
      }

      const refreshedQueue = await loadQueue();
      const fallbackEpisode =
        refreshedQueue?.queue.find(
          (episode) => episode.id === response.nextEpisodeId
        ) ??
        queueRef.current.find(
          (episode) => episode.id === response.nextEpisodeId
        );
      if (!fallbackEpisode) {
        return;
      }

      startQueuedEpisode(fallbackEpisode);
    };

    const onEnded = () => {
      const finishedEpisode = currentEpisodeRef.current;
      const currentQueue = queueRef.current;
      const currentIndex = finishedEpisode
        ? currentQueue.findIndex((episode) => episode.id === finishedEpisode.id)
        : -1;
      const nextEpisode =
        currentIndex >= 0 ? currentQueue[currentIndex + 1] ?? null : null;

      if (nextEpisode) {
        startQueuedEpisode(nextEpisode);
      } else {
        playingRef.current = false;
        setPlaying(false);
      }

      void commitPlayback(audio.currentTime, { completed: true }).then(
        async (response) => {
          if (!nextEpisode) {
            await startBackendFallbackEpisode(response);
            return;
          }
          await loadQueue();
        }
      );
    };

    const onError = () => {
      sourceSwitchingRef.current = false;
      sourceReadyRef.current = false;
      playingRef.current = false;
      setPlaying(false);
      if (!userInitiatedPlayRef.current) {
        return;
      }
      userInitiatedPlayRef.current = false;
      setPlaybackError(describeMediaError(audio.error));
    };

    const onDurationAvailable = () => {
      const nextDuration = readAudioDuration(audio);
      const episodeId = currentEpisodeRef.current?.id;
      if (nextDuration && episodeId) {
        setAudioDuration({ episodeId, durationSeconds: nextDuration });
      }
    };

    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("loadedmetadata", onDurationAvailable);
    audio.addEventListener("durationchange", onDurationAvailable);
    audio.addEventListener("playing", onPlaying);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("error", onError);

    return () => {
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("loadedmetadata", onDurationAvailable);
      audio.removeEventListener("durationchange", onDurationAvailable);
      audio.removeEventListener("playing", onPlaying);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("error", onError);
      audio.pause();
      audio.src = "";
      sourceReloadCleanupRef.current?.();
      sourceReloadCleanupRef.current = null;
      sourceSwitchingRef.current = false;
      sourcePrimedRef.current = false;
      sourceReadyRef.current = false;
    };
  }, [
    audioRef,
    commitActivePlayback,
    commitCurrentPlayback,
    commitPlayback,
    currentEpisodeRef,
    loadQueue,
    playingRef,
    queueRef,
    setActiveEpisodeId,
    setAudioDuration,
    setPlaybackError,
    setPlaying,
    setPositionSeconds,
    sourcePrimedRef,
    sourceReadyRef,
    speedLabelRef,
    userInitiatedPlayRef,
  ]);

  useEffect(() => {
    if (sourceDownloadStateRef.current?.episodeId === currentEpisode?.id) {
      return;
    }
    sourceReloadCleanupRef.current?.();
    sourceReloadCleanupRef.current = null;
    sourceSwitchingRef.current = false;
    sourceDownloadStateRef.current = currentEpisode
      ? {
          episodeId: currentEpisode.id,
          downloaded: currentEpisode.downloaded,
        }
      : null;
  }, [currentEpisode]);

  const currentEpisodeId = currentEpisode?.id ?? null;

  useEffect(() => {
    const sourceDownloadState = sourceDownloadStateRef.current;
    if (
      currentEpisodeId === null ||
      !playing ||
      sourceDownloadState?.episodeId !== currentEpisodeId ||
      sourceDownloadState.downloaded
    ) {
      return;
    }

    const episodeId = currentEpisodeId;
    let cancelled = false;
    let checking = false;

    const checkDownloadedSource = async () => {
      if (checking || sourceSwitchingRef.current || !playingRef.current) {
        return;
      }

      checking = true;
      try {
        const { episode } = await api.episodes.get(episodeId);
        if (
          cancelled ||
          !episode.downloaded ||
          !playingRef.current ||
          currentEpisodeRef.current?.id !== episodeId
        ) {
          return;
        }

        const audio = audioRef.current;
        const targetSrc = `${window.location.origin}/api/episodes/${episodeId}/audio`;
        if (!audio || !audio.src.includes(targetSrc)) {
          return;
        }

        const savedPosition = audio.currentTime;
        sourceDownloadStateRef.current = {
          episodeId,
          downloaded: true,
        };
        sourceSwitchingRef.current = true;
        audio.pause();
        void commitPlayback(savedPosition);
        sourceReadyRef.current = false;
        setQueue((current) =>
          current.map((item) =>
            item.id === episodeId ? { ...item, downloaded: true } : item
          )
        );

        sourceReloadCleanupRef.current?.();
        sourceReloadCleanupRef.current = reloadAudioSourceAtPosition(
          audio,
          savedPosition,
          setPositionSeconds,
          () => {
            sourceReloadCleanupRef.current = null;
            if (currentEpisodeRef.current?.id !== episodeId) {
              sourceSwitchingRef.current = false;
              return;
            }

            sourceSwitchingRef.current = false;
            sourceReadyRef.current = true;
            if (playingRef.current) {
              void attemptAudioPlay(audio, (error) => {
                playingRef.current = false;
                setPlaying(false);
                setPlaybackError(describeAudioError(error));
              });
            }
          },
          () => {
            sourceReloadCleanupRef.current = null;
            sourceSwitchingRef.current = false;
            playingRef.current = false;
            sourceReadyRef.current = false;
            setPlaying(false);
            setPlaybackError(describeMediaError(audio.error));
          }
        );
      } catch {
        // Download completion polling is best effort; playback keeps streaming.
      } finally {
        checking = false;
      }
    };

    void checkDownloadedSource();
    const intervalId = window.setInterval(
      () => void checkDownloadedSource(),
      DOWNLOADED_SOURCE_POLL_MS
    );

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [
    audioRef,
    commitPlayback,
    currentEpisodeId,
    currentEpisodeRef,
    playing,
    playingRef,
    setPlaybackError,
    setPlaying,
    setPositionSeconds,
    setQueue,
    sourceReadyRef,
  ]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }

    const pendingEpisodeId = pendingPlayEpisodeIdRef.current;
    if (!currentEpisode) {
      if (pendingEpisodeId !== null) {
        return;
      }

      audio.pause();
      audio.src = "";
      sourcePrimedRef.current = false;
      sourceReadyRef.current = false;
      setPlaying(false);
      return;
    }

    if (pendingEpisodeId !== null && currentEpisode.id !== pendingEpisodeId) {
      return;
    }

    const targetSrc = `${window.location.origin}/api/episodes/${currentEpisode.id}/audio`;
    const currentSrc = audio.src;
    const shouldPrimeSource =
      pendingEpisodeId !== null || playing || sourcePrimedRef.current;

    if (!currentSrc.includes(targetSrc)) {
      const initialPos = clampPosition(
        currentEpisode.playback?.positionSeconds ?? 0,
        currentEpisodeDuration
      );
      if (!shouldPrimeSource) {
        setPositionSeconds(initialPos);
        setPlaybackError(null);
        return;
      }

      sourceReadyRef.current = false;
      primeAudioSource(
        audio,
        currentEpisode,
        speedLabelRef.current,
        initialPos,
        setPositionSeconds,
        () => {
          sourcePrimedRef.current = true;
        },
        () => {
          sourceReadyRef.current = true;
          if (playingRef.current) {
            void attemptAudioPlay(audio, (error) => {
              setPlaying(false);
              setPlaybackError(describeAudioError(error));
            });
          }
        }
      );
    }
  }, [
    audioRef,
    currentEpisode,
    currentEpisodeDuration,
    pendingPlayEpisodeIdRef,
    playing,
    playingRef,
    setPlaybackError,
    setPlaying,
    setPositionSeconds,
    sourcePrimedRef,
    sourceReadyRef,
    speedLabelRef,
  ]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    if (!playing) {
      audio.pause();
    }
  }, [audioRef, playing]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    applyPlaybackRate(audio, speedLabel);
  }, [audioRef, speedLabel]);

  const playToggle = useCallback(() => {
    setPlaybackError(null);
    userInitiatedPlayRef.current = true;
    const audio = audioRef.current;

    if (playing) {
      playingRef.current = false;
      commitCurrentPlayback();
      setPlaying(false);
      return;
    }

    if (audio && currentEpisode) {
      void (async () => {
        const syncedEpisode = await refreshPlaybackState(currentEpisode);
        void commitActivePlayback(syncedEpisode.id);
        const nextPosition =
          syncedEpisode.playback?.positionSeconds ?? positionSeconds ?? 0;
        sourceReadyRef.current = false;
        primeAudioSource(
          audio,
          syncedEpisode,
          speedLabel,
          nextPosition,
          setPositionSeconds,
          () => {
            sourcePrimedRef.current = true;
          },
          () => {
            sourceReadyRef.current = true;
            setPlaying(true);
            void attemptAudioPlay(audio, (error) => {
              setPlaying(false);
              setPlaybackError(describeAudioError(error));
            });
          }
        );
      })();
      return;
    }

    setPlaying(true);
  }, [
    audioRef,
    commitActivePlayback,
    commitCurrentPlayback,
    currentEpisode,
    playing,
    playingRef,
    positionSeconds,
    refreshPlaybackState,
    setPlaybackError,
    setPlaying,
    setPositionSeconds,
    sourcePrimedRef,
    sourceReadyRef,
    speedLabel,
    userInitiatedPlayRef,
  ]);

  const playEpisode = useCallback(
    (episodeId: number) => {
      setPlaybackError(null);
      userInitiatedPlayRef.current = true;
      const queuedEpisode =
        queue.find((episode) => episode.id === episodeId) ?? null;
      void (async () => {
        const syncedEpisode = queuedEpisode
          ? await refreshPlaybackState(queuedEpisode)
          : null;
        pendingPlayEpisodeIdRef.current = syncedEpisode ? null : episodeId;
        setActiveEpisodeId(episodeId);
        void commitActivePlayback(episodeId);
        const audio = audioRef.current;
        if (!audio) {
          setPlaying(true);
          return;
        }

        const initialPos = syncedEpisode?.playback?.positionSeconds ?? 0;
        sourceReadyRef.current = false;
        primeAudioSource(
          audio,
          syncedEpisode ?? queuedEpisode ?? { id: episodeId },
          speedLabel,
          initialPos,
          setPositionSeconds,
          () => {
            sourcePrimedRef.current = true;
          },
          () => {
            sourceReadyRef.current = true;
            setPlaying(true);
            void attemptAudioPlay(audio, (error) => {
              setPlaying(false);
              setPlaybackError(describeAudioError(error));
            });
          }
        );
      })();
    },
    [
      audioRef,
      commitActivePlayback,
      pendingPlayEpisodeIdRef,
      queue,
      refreshPlaybackState,
      setActiveEpisodeId,
      setPlaybackError,
      setPlaying,
      setPositionSeconds,
      sourcePrimedRef,
      sourceReadyRef,
      speedLabel,
      userInitiatedPlayRef,
    ]
  );

  const seekForward = useCallback(() => {
    if (!audioRef.current || !currentEpisode) return;
    const nextPosition = clampPosition(
      audioRef.current.currentTime + 30,
      currentEpisodeDuration
    );
    if (setAudioPosition(audioRef.current, nextPosition)) {
      setPositionSeconds(nextPosition);
      void commitPlayback(nextPosition, { didSeek: true });
    }
  }, [
    audioRef,
    commitPlayback,
    currentEpisode,
    currentEpisodeDuration,
    setPositionSeconds,
  ]);

  const seekBackward = useCallback(() => {
    if (!audioRef.current || !currentEpisode) return;
    const nextPosition = clampPosition(
      audioRef.current.currentTime - 15,
      currentEpisodeDuration
    );
    if (setAudioPosition(audioRef.current, nextPosition)) {
      setPositionSeconds(nextPosition);
      void commitPlayback(nextPosition, { didSeek: true });
    }
  }, [
    audioRef,
    commitPlayback,
    currentEpisode,
    currentEpisodeDuration,
    setPositionSeconds,
  ]);

  const seekTo = useCallback(
    (nextPositionSeconds: number) => {
      if (!audioRef.current || !currentEpisode) return;
      const nextPosition = clampPosition(
        nextPositionSeconds,
        currentEpisodeDuration
      );
      if (setAudioPosition(audioRef.current, nextPosition)) {
        setPositionSeconds(nextPosition);
        void commitPlayback(nextPosition, { didSeek: true });
      }
    },
    [
      audioRef,
      commitPlayback,
      currentEpisode,
      currentEpisodeDuration,
      setPositionSeconds,
    ]
  );

  return { playToggle, playEpisode, seekForward, seekBackward, seekTo };
}
