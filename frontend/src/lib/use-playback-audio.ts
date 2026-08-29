import {
  useCallback,
  useEffect,
  useRef,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";

import type { PlaybackSpeedLabel } from "@/components/mpod/playback";
import {
  api,
  type ActivePlaybackState,
  type AudiobookTrack,
  type PlaybackUpdateResponse,
} from "./api";
import {
  applyPlaybackRate,
  attemptAudioPlay,
  clampPosition,
  describeAudioError,
  describeMediaError,
  getAudioSourceUrl,
  getPositiveDuration,
  primeAudioSource,
  readAudioDuration,
  reloadAudioSourceAtPosition,
  setAudioPosition,
} from "./playback-audio";
import type { QueueEpisode } from "./playback-context-types";
import {
  isAudiobookQueueItem,
  queueItemKey,
  sameQueueItem,
  type QueueItemKey,
} from "./playback-queue";

type CommitPlayback = (
  nextPositionSeconds: number,
  options?: {
    completed?: boolean;
    didSeek?: boolean;
    episodeId?: number;
    durationSeconds?: number;
  }
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
  setActiveItemKey: Dispatch<SetStateAction<QueueItemKey | null>>;
  setQueue: Dispatch<SetStateAction<QueueEpisode[]>>;
  setPlaying: Dispatch<SetStateAction<boolean>>;
  setPlaybackError: Dispatch<SetStateAction<string | null>>;
  setPositionSeconds: Dispatch<SetStateAction<number>>;
  setAudioDuration: Dispatch<
    SetStateAction<{
      itemKey: QueueItemKey;
      durationSeconds: number;
    } | null>
  >;
  commitPlayback: CommitPlayback;
  commitCurrentPlayback: (options?: { beacon?: boolean }) => void;
  commitActivePlayback: (episode: QueueEpisode) => Promise<void>;
  refreshPlaybackState: (
    episode: QueueEpisode,
    options?: { applyEvenIfNotNewer?: boolean }
  ) => Promise<QueueEpisode>;
  loadQueue: () => Promise<{
    queue: QueueEpisode[];
    activePlayback?: ActivePlaybackState | null;
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
  setActiveItemKey,
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
  const completionInProgressEpisodeIdRef = useRef<QueueItemKey | null>(null);
  // Track the source that is actually loaded, independently from fresher queue data.
  const sourceDownloadStateRef = useRef<{
    itemKey: QueueItemKey;
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
      const current = currentEpisodeRef.current;
      if (nextDuration && current) {
        setAudioDuration({
          itemKey: queueItemKey(current),
          durationSeconds: nextDuration,
        });
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
      setActiveItemKey(queueItemKey(episode));
	  void commitActivePlayback(episode);
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

    const startAfterCompletion = async (
      completedItemKey: QueueItemKey,
      completedItem: QueueEpisode,
      queuedNextItem: QueueEpisode | null,
      response: PlaybackUpdateResponse | null
    ) => {
      if (completionInProgressEpisodeIdRef.current !== completedItemKey) {
        return;
      }

      const refreshedQueue = await loadQueue();
      const availableQueue = refreshedQueue?.queue ?? queueRef.current;
      const nextItem =
        (response?.nextTrackId != null
          ? availableQueue.find(
              (episode) =>
                sameQueueItem(episode, completedItem) &&
                episode.trackId === response.nextTrackId
            )
          : undefined) ??
        (queuedNextItem
          ? availableQueue.find((episode) =>
              sameQueueItem(episode, queuedNextItem)
            )
          : undefined) ??
        (response?.nextEpisodeId != null
          ? availableQueue.find(
              (episode) =>
                episode.type !== "audiobook" &&
                episode.id === response.nextEpisodeId
            )
          : undefined);
      if (!nextItem) {
        return;
      }
      if (completionInProgressEpisodeIdRef.current !== completedItemKey) {
        return;
      }

	  startQueuedEpisode(nextItem);
    };

    const onEnded = () => {
      const finishedEpisode = currentEpisodeRef.current;
      if (!finishedEpisode) {
        return;
      }
      const finishedPosition = audio.currentTime;
      const finishedDuration = getPositiveDuration(
        readAudioDuration(audio),
        finishedEpisode.duration
      );
      const currentQueue = queueRef.current;
	  const finishedItemKey = queueItemKey(finishedEpisode);
      const currentIndex = currentQueue.findIndex(
        (episode) => queueItemKey(episode) === finishedItemKey
      );
	  const nextQueueItem =
		currentIndex >= 0 ? (currentQueue[currentIndex + 1] ?? null) : null;

	  playingRef.current = false;
	  setPlaying(false);
	  completionInProgressEpisodeIdRef.current = finishedItemKey;

      void commitPlayback(finishedPosition, {
        completed: true,
        episodeId: finishedEpisode.id,
        durationSeconds: finishedDuration,
	  }).then(async (response) => {
		await startAfterCompletion(
		  finishedItemKey,
		  finishedEpisode,
		  nextQueueItem,
		  response
		);
	  }).finally(() => {
        if (completionInProgressEpisodeIdRef.current === finishedItemKey) {
          completionInProgressEpisodeIdRef.current = null;
        }
      });
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
      const current = currentEpisodeRef.current;
      if (nextDuration && current) {
        setAudioDuration({
          itemKey: queueItemKey(current),
          durationSeconds: nextDuration,
        });
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
    setActiveItemKey,
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
    const itemKey = currentEpisode ? queueItemKey(currentEpisode) : null;
    if (sourceDownloadStateRef.current?.itemKey === itemKey) {
      return;
    }
    sourceReloadCleanupRef.current?.();
    sourceReloadCleanupRef.current = null;
    sourceSwitchingRef.current = false;
    sourceDownloadStateRef.current = currentEpisode
      ? {
          itemKey: queueItemKey(currentEpisode),
          downloaded: currentEpisode.downloaded,
        }
      : null;
  }, [currentEpisode]);

  const currentEpisodeId = currentEpisode?.id ?? null;
  const currentItemKey = currentEpisode ? queueItemKey(currentEpisode) : null;

  useEffect(() => {
    const sourceDownloadState = sourceDownloadStateRef.current;
    if (
      currentEpisodeId === null ||
      !playing ||
      sourceDownloadState?.itemKey !== currentItemKey ||
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
          itemKey: `episode:${episodeId}`,
          downloaded: true,
        };
        sourceSwitchingRef.current = true;
        audio.pause();
        void commitPlayback(savedPosition);
        sourceReadyRef.current = false;
        setQueue((current) =>
          current.map((item) =>
            queueItemKey(item) === `episode:${episodeId}`
              ? { ...item, downloaded: true }
              : item
          )
        );

        sourceReloadCleanupRef.current?.();
        sourceReloadCleanupRef.current = reloadAudioSourceAtPosition(
          audio,
          savedPosition,
          setPositionSeconds,
          () => {
            sourceReloadCleanupRef.current = null;
            if (
              !currentEpisodeRef.current ||
              queueItemKey(currentEpisodeRef.current) !== `episode:${episodeId}`
            ) {
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
    currentItemKey,
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

    const targetSrc = getAudioSourceUrl(currentEpisode);
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

    if (
      currentEpisode &&
      completionInProgressEpisodeIdRef.current === queueItemKey(currentEpisode)
    ) {
      return;
    }

    if (audio && currentEpisode) {
      void (async () => {
        const syncedEpisode = await refreshPlaybackState(currentEpisode);
        void commitActivePlayback(syncedEpisode);
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
      completionInProgressEpisodeIdRef.current = null;
      setPlaybackError(null);
      userInitiatedPlayRef.current = true;
      const queuedEpisode =
        queue.find(
          (episode) =>
            !isAudiobookQueueItem(episode) && episode.id === episodeId
        ) ?? null;
      void (async () => {
        const syncedEpisode = queuedEpisode
          ? await refreshPlaybackState(queuedEpisode)
          : null;
        pendingPlayEpisodeIdRef.current = syncedEpisode ? null : episodeId;
        setActiveItemKey(`episode:${episodeId}`);
        const activeItem = syncedEpisode ?? queuedEpisode;
        if (activeItem) {
          void commitActivePlayback(activeItem);
        } else {
          void api.playback.setActive(episodeId);
        }
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
      setActiveItemKey,
      setPlaybackError,
      setPlaying,
      setPositionSeconds,
      sourcePrimedRef,
      sourceReadyRef,
      speedLabel,
      userInitiatedPlayRef,
    ]
  );

  const playQueueItem = useCallback(
    (item: QueueEpisode) => {
      if (!isAudiobookQueueItem(item)) {
        playEpisode(item.id);
        return;
      }

      completionInProgressEpisodeIdRef.current = null;
      setPlaybackError(null);
      userInitiatedPlayRef.current = true;
      void (async () => {
        const syncedItem = await refreshPlaybackState(item);
        setActiveItemKey(queueItemKey(syncedItem));
        void commitActivePlayback(syncedItem);
        const audio = audioRef.current;
        if (!audio) {
          setPlaying(true);
          return;
        }

        const initialPosition = syncedItem.playback?.positionSeconds ?? 0;
        sourceReadyRef.current = false;
        primeAudioSource(
          audio,
          syncedItem,
          speedLabel,
          initialPosition,
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
      playEpisode,
      refreshPlaybackState,
      setActiveItemKey,
      setPlaybackError,
      setPlaying,
      setPositionSeconds,
      sourcePrimedRef,
      sourceReadyRef,
      speedLabel,
      userInitiatedPlayRef,
    ]
  );

  const playAudiobookTrack = useCallback(
    async (audiobookId: number, track: AudiobookTrack) => {
      const queuedBook = queue.find(
        (episode) =>
          (episode.type === "audiobook" || episode.audiobookId !== undefined) &&
          (episode.audiobookId ?? episode.id) === audiobookId
      );
      if (!queuedBook) {
        return;
      }

      completionInProgressEpisodeIdRef.current = null;
      setPlaybackError(null);
      userInitiatedPlayRef.current = true;
      commitCurrentPlayback();

      const initialPosition = track.isListened ? 0 : track.positionSeconds;
      if (track.isListened) {
        await api.playback.update({
          audiobookId,
          trackId: track.id,
          positionSeconds: 0,
          durationSeconds: track.duration,
          completed: false,
          didSeek: true,
          clientUpdatedAt: new Date().toISOString(),
        });
      }
      await api.playback.setActive({ audiobookId, trackId: track.id });

      const nextEpisode: QueueEpisode = {
        ...queuedBook,
        trackId: track.id,
        trackNumber: track.trackNumber,
        duration: track.duration,
        audioUrl: `/api/audiobooks/${audiobookId}/tracks/${track.id}/audio`,
        isListened: false,
        playback: {
          audiobookId,
          trackId: track.id,
          positionSeconds: initialPosition,
          lastUpdated: new Date().toISOString(),
        },
      };
      setQueue((current) =>
        current.map((episode) =>
          (episode.type === "audiobook" || episode.audiobookId !== undefined) &&
          (episode.audiobookId ?? episode.id) === audiobookId
            ? nextEpisode
            : episode
        )
      );
      setActiveItemKey(queueItemKey(nextEpisode));

      const audio = audioRef.current;
      if (!audio) {
        setPlaying(true);
        return;
      }
      sourceReadyRef.current = false;
      primeAudioSource(
        audio,
        nextEpisode,
        speedLabel,
        initialPosition,
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
    },
    [
      audioRef,
      commitCurrentPlayback,
      queue,
      setActiveItemKey,
      setPlaybackError,
      setPlaying,
      setPositionSeconds,
      setQueue,
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

	return {
	  playToggle,
	  playEpisode,
	  playQueueItem,
	  playAudiobookTrack,
	  seekForward,
	  seekBackward,
	  seekTo,
	};
}
