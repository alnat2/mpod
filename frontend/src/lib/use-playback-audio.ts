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
    durationSeconds?: number;
    target?: QueueEpisode;
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
  allowPlaybackProgress: (episode: QueueEpisode) => void;
  commitActivePlayback: (episode: QueueEpisode) => Promise<void>;
  refreshPlaybackState: (
    episode: QueueEpisode,
    options?: { applyEvenIfNotNewer?: boolean }
  ) => Promise<QueueEpisode>;
  loadQueue: (shouldApply?: () => boolean) => Promise<{
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
  allowPlaybackProgress,
  commitActivePlayback,
  refreshPlaybackState,
  loadQueue,
}: UsePlaybackAudioOptions) {
  const sourceSwitchingRef = useRef(false);
  const sourceReloadCleanupRef = useRef<(() => void) | null>(null);
  const completionInProgressEpisodeIdRef = useRef<QueueItemKey | null>(null);
  const completedAudioSourceRef = useRef<string | null>(null);
  const playbackGenerationRef = useRef(0);
  const pendingNextItemRef = useRef<{
    generation: number;
    item: QueueEpisode;
  } | null>(null);
  const retryPendingNextRef = useRef<(() => void) | null>(null);
  // Track the source that is actually loaded, independently from fresher queue data.
  const sourceDownloadStateRef = useRef<{
    itemKey: QueueItemKey;
    downloaded: boolean;
  } | null>(null);
  const positionSecondsRef = useRef(positionSeconds);

  useEffect(() => {
    positionSecondsRef.current = positionSeconds;
  }, [positionSeconds]);

  const invalidatePlaybackGeneration = useCallback(() => {
    playbackGenerationRef.current += 1;
    pendingNextItemRef.current = null;
    completionInProgressEpisodeIdRef.current = null;
  }, []);

  useEffect(() => {
    const audio = new Audio();
    audioRef.current = audio;
    sourcePrimedRef.current = false;
    sourceReadyRef.current = false;

    const onPlaying = () => {
      playingRef.current = true;
      pendingNextItemRef.current = null;
      setPlaying(true);
      userInitiatedPlayRef.current = false;
      setPlaybackError(null);
    };

    const startQueuedEpisode = (
      episode: QueueEpisode,
      options: { pendingOnFailure?: boolean } = {}
    ) => {
      const nextPosition = episode.playback?.positionSeconds ?? 0;
      pendingNextItemRef.current = options.pendingOnFailure
        ? { generation: playbackGenerationRef.current, item: episode }
        : null;
      currentEpisodeRef.current = episode;
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

    retryPendingNextRef.current = () => {
      const pending = pendingNextItemRef.current;
      if (pending && pending.generation === playbackGenerationRef.current) {
        startQueuedEpisode(pending.item, { pendingOnFailure: true });
      }
    };

    const startAfterCompletion = async (
      completedItemKey: QueueItemKey,
      completedItem: QueueEpisode,
      queuedNextItem: QueueEpisode | null,
      response: PlaybackUpdateResponse | null,
      completionGeneration: number
    ) => {
      const isCurrentGeneration = () =>
        playbackGenerationRef.current === completionGeneration;
      const isCurrentCompletion = () =>
        isCurrentGeneration() &&
        completionInProgressEpisodeIdRef.current === completedItemKey;
      if (!isCurrentCompletion()) {
        return;
      }

      const directNextItem = response?.nextItem
        ? (() => {
            const next = response.nextItem;
            const common = {
              id: next.type === "audiobook" ? next.audiobookId! : next.episodeId!,
              podcastId: next.podcastId,
              title: next.title,
              description: next.description ?? undefined,
              audioUrl: next.audioUrl,
              duration: next.duration,
              downloaded: next.downloaded,
              isListened: next.isListened,
              publishedAt: next.publishedAt,
              podcastTitle: next.podcastTitle,
              podcastImageUrl: next.podcastImageUrl ?? null,
              playback: {
                ...(next.type === "audiobook"
                  ? { audiobookId: next.audiobookId, trackId: next.trackId }
                  : { episodeId: next.episodeId }),
                positionSeconds: next.positionSeconds,
                lastUpdated: next.lastUpdated,
              },
            };
            return next.type === "audiobook"
              ? ({
                  ...common,
                  type: "audiobook",
                  audiobookId: next.audiobookId,
                  trackId: next.trackId,
                  trackNumber: next.trackNumber,
                  author: next.author,
                  coverUrl: next.coverUrl ?? null,
                  trackCount: next.trackCount,
                  hasChapters: next.hasChapters,
                  hasCover: next.hasCover,
                } satisfies QueueEpisode)
              : ({ ...common, type: "episode" } satisfies QueueEpisode);
          })()
        : null;
      if (directNextItem) {
        const directTrackId =
          directNextItem.type === "audiobook"
            ? directNextItem.trackId
            : undefined;
        setQueue((current) => {
          const merged = current.map((item) =>
            sameQueueItem(item, directNextItem) ? directNextItem : item
          );
          return merged.some((item) => sameQueueItem(item, directNextItem))
            ? merged
            : [...merged, directNextItem];
        });
        if (!isCurrentCompletion()) {
          return;
        }
        startQueuedEpisode(directNextItem, { pendingOnFailure: true });
        void loadQueue(isCurrentGeneration).then((refreshedQueue) => {
          if (!refreshedQueue || !isCurrentGeneration()) {
            return;
          }
          setQueue(() => {
            const refreshedItems = refreshedQueue.queue;
            const hasExactTarget = refreshedItems.some(
              (item) =>
                sameQueueItem(item, directNextItem) &&
                (directTrackId === undefined || item.trackId === directTrackId)
            );
            if (hasExactTarget) {
              return refreshedItems;
            }
            const replaced = refreshedItems.map((item) =>
              sameQueueItem(item, directNextItem) ? directNextItem : item
            );
            return replaced.some((item) => sameQueueItem(item, directNextItem))
              ? replaced
              : [...replaced, directNextItem];
          });
          setActiveItemKey(queueItemKey(directNextItem));
        });
        return;
      }

      const refreshedQueue = await loadQueue(isCurrentGeneration);
      if (!isCurrentCompletion()) {
        return;
      }
      const availableQueue = refreshedQueue?.queue ?? queueRef.current;
      const nextTarget = response?.nextTarget;
      const nextItem =
        (nextTarget?.type === "episode"
          ? availableQueue.find(
              (episode) =>
                !isAudiobookQueueItem(episode) &&
                episode.id === nextTarget.episodeId
            )
          : nextTarget?.type === "audiobook"
            ? availableQueue.find(
                (episode) =>
                  isAudiobookQueueItem(episode) &&
                  (episode.audiobookId ?? episode.id) ===
                    nextTarget.audiobookId &&
                  episode.trackId === nextTarget.trackId
              )
            : undefined) ??
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
      if (!isCurrentCompletion()) {
        return;
      }

      startQueuedEpisode(nextItem);
    };

    const completeCurrentPlayback = () => {
      const finishedEpisode = currentEpisodeRef.current;
      if (!finishedEpisode) {
        return;
      }
      const finishedSource = audio.currentSrc || audio.src;
      if (
        finishedSource &&
        completedAudioSourceRef.current === finishedSource
      ) {
        return;
      }
      const finishedPosition = audio.currentTime;
      const finishedDuration = getPositiveDuration(
        readAudioDuration(audio),
        finishedEpisode.duration
      );
      const currentQueue = queueRef.current;
      const finishedItemKey = queueItemKey(finishedEpisode);
      const completionGeneration = ++playbackGenerationRef.current;
      const currentIndex = currentQueue.findIndex(
        (episode) => queueItemKey(episode) === finishedItemKey
      );
      const nextQueueItem =
        currentIndex >= 0 ? (currentQueue[currentIndex + 1] ?? null) : null;

      playingRef.current = false;
      setPlaying(false);
      completionInProgressEpisodeIdRef.current = finishedItemKey;
      completedAudioSourceRef.current = finishedSource;

      void commitPlayback(finishedPosition, {
        completed: true,
        durationSeconds: finishedDuration,
        target: finishedEpisode,
      })
        .then(async (response) => {
          await startAfterCompletion(
            finishedItemKey,
            finishedEpisode,
            nextQueueItem,
            response,
            completionGeneration
          );
        })
        .finally(() => {
          if (completionInProgressEpisodeIdRef.current === finishedItemKey) {
            completionInProgressEpisodeIdRef.current = null;
          }
        });
    };

    const onTimeUpdate = () => {
      positionSecondsRef.current = audio.currentTime;
      setPositionSeconds(audio.currentTime);
      const nextDuration = readAudioDuration(audio);
      const current = currentEpisodeRef.current;
      if (nextDuration && current) {
        setAudioDuration({
          itemKey: queueItemKey(current),
          durationSeconds: nextDuration,
        });
      }
      if (audio.ended) {
        completeCurrentPlayback();
      }
    };

    const onPause = () => {
      if (audio.ended) {
        completeCurrentPlayback();
        return;
      }
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

    const onEnded = () => {
      completeCurrentPlayback();
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
      retryPendingNextRef.current = null;
    };
  }, [
    audioRef,
    allowPlaybackProgress,
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
    setQueue,
    setPositionSeconds,
    sourcePrimedRef,
    sourceReadyRef,
    speedLabelRef,
    userInitiatedPlayRef,
  ]);

  useEffect(() => {
    const recoverPendingNext = () => {
      if (
        document.visibilityState !== "visible" ||
        playingRef.current ||
        !pendingNextItemRef.current
      ) {
        return;
      }
      retryPendingNextRef.current?.();
    };

    window.addEventListener("focus", recoverPendingNext);
    document.addEventListener("visibilitychange", recoverPendingNext);
    return () => {
      window.removeEventListener("focus", recoverPendingNext);
      document.removeEventListener("visibilitychange", recoverPendingNext);
    };
  }, [playingRef]);

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

    if (!playing && pendingNextItemRef.current) {
      retryPendingNextRef.current?.();
      return;
    }

    if (
      currentEpisode &&
      completionInProgressEpisodeIdRef.current === queueItemKey(currentEpisode)
    ) {
      return;
    }

    invalidatePlaybackGeneration();

    if (audio && currentEpisode) {
      completedAudioSourceRef.current = null;
      allowPlaybackProgress(currentEpisode);
      void (async () => {
        const syncedEpisode = await refreshPlaybackState(currentEpisode);
        void commitActivePlayback(syncedEpisode);
        const nextPosition =
          syncedEpisode.playback?.positionSeconds ?? positionSecondsRef.current ?? 0;
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
    allowPlaybackProgress,
    commitActivePlayback,
    commitCurrentPlayback,
    currentEpisode,
    invalidatePlaybackGeneration,
    playing,
    playingRef,
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
      invalidatePlaybackGeneration();
      completedAudioSourceRef.current = null;
      setPlaybackError(null);
      userInitiatedPlayRef.current = true;
      const queuedEpisode =
        queue.find(
          (episode) =>
            !isAudiobookQueueItem(episode) && episode.id === episodeId
        ) ?? null;
      if (queuedEpisode) {
        allowPlaybackProgress(queuedEpisode);
      }
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
      allowPlaybackProgress,
      commitActivePlayback,
      invalidatePlaybackGeneration,
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

      invalidatePlaybackGeneration();
      completedAudioSourceRef.current = null;
      allowPlaybackProgress(item);
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
      allowPlaybackProgress,
      commitActivePlayback,
      invalidatePlaybackGeneration,
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

      invalidatePlaybackGeneration();
      allowPlaybackProgress({ ...queuedBook, trackId: track.id });
      completedAudioSourceRef.current = null;
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
      allowPlaybackProgress,
      commitCurrentPlayback,
      invalidatePlaybackGeneration,
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
