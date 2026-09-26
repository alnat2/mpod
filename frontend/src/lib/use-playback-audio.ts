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
  playbackMediaSourceKey,
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
  queueRevisionRef: RefObject<number>;
  selectionGenerationRef: RefObject<number>;
  playingRef: RefObject<boolean>;
  currentEpisodeRef: RefObject<QueueEpisode | null>;
  pendingPlayEpisodeIdRef: RefObject<number | null>;
  speedLabelRef: RefObject<PlaybackSpeedLabel>;
  queue: QueueEpisode[];
  currentEpisode: QueueEpisode | null;
  currentEpisodeDuration: number;
  activeMediaDurationRef: RefObject<{
    sourceKey: string;
    durationSeconds: number;
  } | null>;
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
      sourceKey: string;
      durationSeconds: number;
    } | null>
  >;
  commitPlayback: CommitPlayback;
  commitCurrentPlayback: (options?: { beacon?: boolean }) => void;
  allowPlaybackProgress: (episode: QueueEpisode) => void;
  commitActivePlayback: (episode: QueueEpisode) => Promise<void>;
  refreshPlaybackState: (
    episode: QueueEpisode,
    options?: {
      applyEvenIfNotNewer?: boolean;
      isActive?: () => boolean;
    }
  ) => Promise<QueueEpisode>;
  loadQueue: (options?: {
    preserveActiveItemKey?: boolean;
    shouldApply?: () => boolean;
    apply?: boolean;
  }) => Promise<{
    queue: QueueEpisode[];
    activePlayback?: ActivePlaybackState | null;
  } | null>;
};

function matchesMediaSource(actualSrc: string, expectedSrc: string): boolean {
  if (!actualSrc || !expectedSrc) {
    return true;
  }
  if (
    actualSrc === expectedSrc ||
    actualSrc.includes(expectedSrc) ||
    expectedSrc.includes(actualSrc)
  ) {
    return true;
  }
  try {
    const actualPath = new URL(actualSrc, window.location.origin).pathname;
    const expectedPath = new URL(expectedSrc, window.location.origin).pathname;
    return actualPath === expectedPath;
  } catch {
    return false;
  }
}

export function getNextAudiobookChapter(
  episode: QueueEpisode,
  tracksCache: Map<number, AudiobookTrack[]>
): QueueEpisode | null {
  const bookId = episode.audiobookId ?? episode.id;
  if (!bookId) {
    return null;
  }
  const tracks = tracksCache.get(bookId);
  if (!tracks || tracks.length === 0) {
    return null;
  }

  const currentTrack = tracks.find((track) => track.id === episode.trackId);
  if (!currentTrack || !(currentTrack.inPlaylist ?? currentTrack.isInPlaylist)) {
    return null;
  }

  const sortedTracks = tracks.filter(
    (track) =>
      track.id !== currentTrack.id &&
      Boolean(track.inPlaylist ?? track.isInPlaylist) &&
      !track.isListened
  ).sort((a, b) => {
    if (a.trackNumber !== b.trackNumber) {
      return a.trackNumber - b.trackNumber;
    }
    return a.id - b.id;
  });

  const nextTrack =
    sortedTracks.find((track) => track.trackNumber > currentTrack.trackNumber) ??
    sortedTracks[0];
  if (!nextTrack) {
    return null;
  }

  return {
    ...episode,
    trackId: nextTrack.id,
    trackNumber: nextTrack.trackNumber,
    duration: nextTrack.duration ?? null,
    audioUrl: `/api/audiobooks/${bookId}/tracks/${nextTrack.id}/audio`,
    playback: {
      audiobookId: bookId,
      trackId: nextTrack.id,
      positionSeconds: nextTrack.positionSeconds,
      lastUpdated: nextTrack.lastUpdated ?? new Date().toISOString(),
    },
  };
}

export function usePlaybackAudio({
  audioRef,
  sourcePrimedRef,
  sourceReadyRef,
  userInitiatedPlayRef,
  queueRef,
  queueRevisionRef,
  selectionGenerationRef,
  playingRef,
  currentEpisodeRef,
  pendingPlayEpisodeIdRef,
  speedLabelRef,
  queue,
  currentEpisode,
  currentEpisodeDuration,
  activeMediaDurationRef,
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
  const sourcePrimeCleanupRef = useRef<(() => void) | null>(null);
  const completionGenerationRef = useRef<number | null>(null);
  const retryCleanupRef = useRef<(() => void) | null>(null);
  const autoAdvanceIntentRef = useRef(false);
  const completedAudioSourceRef = useRef<string | null>(null);
  // Track the source that is actually loaded, independently from fresher queue data.
  const sourceDownloadStateRef = useRef<{
    itemKey: QueueItemKey;
    downloaded: boolean;
  } | null>(null);
  const positionSecondsRef = useRef(positionSeconds);
  const sourceGenerationRef = useRef(0);
  const audiobookTracksCacheRef = useRef<Map<number, AudiobookTrack[]>>(
    new Map()
  );
  const cancelAutoAdvance = useCallback(() => {
    autoAdvanceIntentRef.current = false;
    retryCleanupRef.current?.();
  }, []);
  const cacheRevisionRef = useRef(-1);
  const cacheRequestRef = useRef(0);

  useEffect(() => {
    const revision = queueRevisionRef.current;
    if (cacheRevisionRef.current === revision) {
      return;
    }
    cacheRevisionRef.current = revision;
    audiobookTracksCacheRef.current.clear();
    const request = ++cacheRequestRef.current;
    for (const item of queue) {
      if (isAudiobookQueueItem(item)) {
        const bookId = item.audiobookId ?? item.id;
        if (bookId && !audiobookTracksCacheRef.current.has(bookId)) {
          void api.audiobooks
            .get(bookId)
            .then((res) => {
              if (
                request === cacheRequestRef.current &&
                revision === queueRevisionRef.current &&
                res?.audiobook?.tracks
              ) {
                audiobookTracksCacheRef.current.set(
                  bookId,
                  res.audiobook.tracks
                );
              }
            })
            .catch(() => {});
        }
      }
    }
  }, [queue, queueRevisionRef]);

  useEffect(() => () => {
    cacheRequestRef.current += 1;
  }, []);

  const resetActiveDuration = useCallback(() => {
    activeMediaDurationRef.current = null;
    setAudioDuration(null);
  }, [activeMediaDurationRef, setAudioDuration]);

  const updateActiveDuration = useCallback(
    (expectedGen?: number) => {
      const audio = audioRef.current;
      if (!audio) {
        return;
      }
      const current = currentEpisodeRef.current;
      if (!current) {
        return;
      }
      if (
        expectedGen !== undefined &&
        expectedGen !== sourceGenerationRef.current
      ) {
        return;
      }
      const expectedSrc = getAudioSourceUrl(current);
      const currentSrc = audio.currentSrc || audio.src;
      if (currentSrc && !matchesMediaSource(currentSrc, expectedSrc)) {
        return;
      }
      const nextDuration = readAudioDuration(audio);
      if (!nextDuration) {
        return;
      }
      const sourceKey = playbackMediaSourceKey(current);
      activeMediaDurationRef.current = {
        sourceKey,
        durationSeconds: nextDuration,
      };
      setAudioDuration((prev) =>
        prev &&
        prev.sourceKey === sourceKey &&
        prev.durationSeconds === nextDuration
          ? prev
          : { sourceKey, durationSeconds: nextDuration }
      );
    },
    [
      activeMediaDurationRef,
      audioRef,
      currentEpisodeRef,
      setAudioDuration,
    ]
  );

  const getEffectiveDuration = useCallback(() => {
    const current = currentEpisodeRef.current;
    if (!current) return 0;
    const sourceKey = playbackMediaSourceKey(current);
    if (
      activeMediaDurationRef.current &&
      activeMediaDurationRef.current.sourceKey === sourceKey &&
      activeMediaDurationRef.current.durationSeconds > 0
    ) {
      return activeMediaDurationRef.current.durationSeconds;
    }
    return getPositiveDuration(current.duration);
  }, [activeMediaDurationRef, currentEpisodeRef]);

  const prepareSourceSwitch = useCallback(() => {
    retryCleanupRef.current?.();
    autoAdvanceIntentRef.current = false;
    selectionGenerationRef.current += 1;
    const previousTarget = currentEpisodeRef.current;
    const audio = audioRef.current;
    if (previousTarget && audio) {
      const prevPosition = audio.currentTime;
      const prevDuration = getEffectiveDuration();
      if (playingRef.current || prevPosition > 0) {
        void commitPlayback(prevPosition, {
          completed: false,
          durationSeconds: prevDuration,
          target: previousTarget,
        });
      }
    }
    sourcePrimeCleanupRef.current?.();
    sourcePrimeCleanupRef.current = null;
    sourceSwitchingRef.current = true;
    playingRef.current = false;
    setPlaying(false);
    sourceGenerationRef.current += 1;
    resetActiveDuration();
    return sourceGenerationRef.current;
  }, [
    audioRef,
    commitPlayback,
    currentEpisodeRef,
    getEffectiveDuration,
    playingRef,
    selectionGenerationRef,
    resetActiveDuration,
    setPlaying,
  ]);

  useEffect(() => {
    positionSecondsRef.current = positionSeconds;
  }, [positionSeconds]);

  useEffect(() => {
    const audio = new Audio();
    audioRef.current = audio;
    sourcePrimedRef.current = false;
    sourceReadyRef.current = false;

    const onPlaying = () => {
      if (!playingRef.current && !userInitiatedPlayRef.current) {
        audioRef.current?.pause();
        return;
      }
      playingRef.current = true;
      setPlaying(true);
      userInitiatedPlayRef.current = false;
      setPlaybackError(null);
    };

    const startQueuedEpisode = (episode: QueueEpisode) => {
      retryCleanupRef.current?.();
      selectionGenerationRef.current += 1;
      sourceSwitchingRef.current = true;
      sourceGenerationRef.current += 1;
      const currentGen = sourceGenerationRef.current;
      resetActiveDuration();
      const nextPosition = episode.playback?.positionSeconds ?? 0;
      currentEpisodeRef.current = episode;
      const key = queueItemKey(episode);
      setActiveItemKey(key);
      void commitActivePlayback(episode);
      sourceReadyRef.current = false;

      let playAttempts = 0;
      const MAX_PLAY_ATTEMPTS = 3;
      let playPending = false;
      let playSucceeded = false;
      let canceled = false;
      let retryListener: (() => void) | null = null;
      let retryTimeout: ReturnType<typeof setTimeout> | null = null;

      const clearRetryWait = () => {
        if (retryListener) {
          audio.removeEventListener("canplay", retryListener);
          retryListener = null;
        }
        if (retryTimeout !== null) {
          clearTimeout(retryTimeout);
          retryTimeout = null;
        }
      };
      const cancelAutoPlay = () => {
        canceled = true;
        clearRetryWait();
        if (retryCleanupRef.current === cancelAutoPlay) {
          retryCleanupRef.current = null;
        }
      };
      retryCleanupRef.current = cancelAutoPlay;

      const tryPlay = async () => {
        if (canceled || sourceGenerationRef.current !== currentGen || !playingRef.current || playSucceeded) return;
        if (playPending) return;

        if (playAttempts >= MAX_PLAY_ATTEMPTS) {
          playingRef.current = false;
          setPlaying(false);
          setPlaybackError("Failed to start playback after multiple attempts.");
          cancelAutoPlay();
          return;
        }

        playPending = true;
        playAttempts++;
        setPlaying(true);

        const audio = audioRef.current;
        if (!audio) {
          playPending = false;
          cancelAutoPlay();
          return;
        }

        clearRetryWait();
        const error = await attemptAudioPlay(audio, () => {});
        if (sourceGenerationRef.current !== currentGen) return;
        if (canceled) {
          if (!playingRef.current && !audio.paused) audio.pause();
          return;
        }
        playPending = false;
        if (!playingRef.current) {
          audio.pause();
          setPlaying(false);
          cancelAutoPlay();
          return;
        }

        if (error) {
          const isNotSupported = error instanceof Error ? error.name === "NotSupportedError" : (error as { name?: string })?.name === "NotSupportedError";
          if (isNotSupported && playAttempts < MAX_PLAY_ATTEMPTS) {
            if (audio.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) {
              void tryPlay();
            } else {
              retryListener = () => {
                clearRetryWait();
                void tryPlay();
              };
              audio.addEventListener("canplay", retryListener);
              retryTimeout = setTimeout(() => {
                clearRetryWait();
                if (!canceled && sourceGenerationRef.current === currentGen && playingRef.current) {
                  playingRef.current = false;
                  setPlaying(false);
                  setPlaybackError("Timeout waiting for audio to become ready");
                  cancelAutoPlay();
                }
              }, 5000);
            }
            return;
          }
          playingRef.current = false;
          setPlaying(false);
          setPlaybackError(describeAudioError(error));
          cancelAutoPlay();
        } else {
          if (audio.paused) {
            playingRef.current = false;
            setPlaying(false);
            setPlaybackError("Playback did not start.");
            cancelAutoPlay();
            return;
          }
          playSucceeded = true;
          cancelAutoPlay();
        }
      };

      sourcePrimeCleanupRef.current?.();
      sourcePrimeCleanupRef.current = primeAudioSource(
        audio,
        episode,
        speedLabelRef.current,
        nextPosition,
        setPositionSeconds,
        () => {
          sourcePrimedRef.current = true;
        },
        () => {
          sourcePrimeCleanupRef.current = null;
          if (sourceGenerationRef.current !== currentGen) {
            return;
          }
          sourceSwitchingRef.current = false;
          sourceReadyRef.current = true;
          updateActiveDuration(currentGen);
          // Re-evaluate play intent in case user explicitly paused
          if (playingRef.current) {
            void tryPlay();
          }
        },
        () => {
          sourcePrimeCleanupRef.current = null;
          if (sourceGenerationRef.current !== currentGen) return;
          sourceSwitchingRef.current = false;
          sourceReadyRef.current = false;
          setPlaying(false);
          setPlaybackError(describeMediaError(audio.error));
        },
        () => sourceGenerationRef.current === currentGen
      );

      if (nextPosition === 0) {
        setPositionSeconds(0);
        if (playingRef.current) {
          void tryPlay();
        }
      }

      setPlaybackError(null);
    };

    const startAfterCompletion = async (
      expectedSourceGeneration: number,
      completedItem: QueueEpisode,
      queuedNextItem: QueueEpisode | null,
      response: PlaybackUpdateResponse | null,
      predictedSourceKey: string | null,
      selectionGeneration: number
    ) => {
      const isCurrentCompletion = () =>
        sourceGenerationRef.current === expectedSourceGeneration &&
        selectionGenerationRef.current === selectionGeneration;
      if (!isCurrentCompletion()) {
        return;
      }

      const refreshedQueue = await loadQueue({ apply: false });
      if (!isCurrentCompletion()) {
        return;
      }
      const availableQueue = refreshedQueue?.queue ?? queueRef.current;
      const nextTarget = response?.nextTarget ??
        (response?.nextTrackId != null && isAudiobookQueueItem(completedItem)
          ? {
              type: "audiobook" as const,
              audiobookId: completedItem.audiobookId ?? completedItem.id,
              trackId: response.nextTrackId,
            }
          : response?.nextEpisodeId != null
            ? { type: "episode" as const, episodeId: response.nextEpisodeId }
            : null);

      let nextItem: QueueEpisode | null = null;
      if (nextTarget?.type === "episode") {
        nextItem = availableQueue.find(
          (item) => !isAudiobookQueueItem(item) && item.id === nextTarget.episodeId
        ) ?? null;
      } else if (nextTarget?.type === "audiobook") {
        const bookId = nextTarget.audiobookId;
        const bookItem = availableQueue.find(
          (item) => isAudiobookQueueItem(item) &&
            (item.audiobookId ?? item.id) === bookId
        );
        if (bookItem) {
          const track = audiobookTracksCacheRef.current.get(bookId)
            ?.find((item) => item.id === nextTarget.trackId);
          nextItem = bookItem.trackId === nextTarget.trackId
            ? bookItem
            : {
                ...bookItem,
                trackId: nextTarget.trackId,
                trackNumber: track?.trackNumber,
                duration: track?.duration ?? null,
                audioUrl: `/api/audiobooks/${bookId}/tracks/${nextTarget.trackId}/audio`,
                playback: null,
              };
          if (nextItem.playback?.trackId !== nextTarget.trackId) {
            try {
              const result = await api.playback.get({
                audiobookId: bookId,
                trackId: nextTarget.trackId,
              });
              nextItem = { ...nextItem, playback: result.playback };
            } catch {
              // The authoritative target still starts at 0 if no progress is available.
            }
          }
        }
      }
      if (!nextTarget && response && queuedNextItem) {
        nextItem = availableQueue.find((item) =>
          sameQueueItem(item, queuedNextItem)
        ) ?? null;
      }

      if (!isCurrentCompletion()) {
        return;
      }
      if (!nextItem) {
        autoAdvanceIntentRef.current = false;
        if (predictedSourceKey !== null) {
          audio.pause();
        }
        playingRef.current = false;
        sourceSwitchingRef.current = false;
        setPlaying(false);
        if (response === null) {
          setPlaybackError("Could not confirm playback completion.");
        }
        if (refreshedQueue) {
          queueRevisionRef.current += 1;
          setQueue(refreshedQueue.queue);
          setActiveItemKey(null);
        }
        return;
      }

      playingRef.current = autoAdvanceIntentRef.current;
      if (refreshedQueue) {
        queueRevisionRef.current += 1;
        setQueue(refreshedQueue.queue.map((item) =>
          sameQueueItem(item, nextItem!) ? nextItem! : item
        ));
      }
      if (predictedSourceKey !== playbackMediaSourceKey(nextItem)) {
        startQueuedEpisode(nextItem);
      } else {
        setActiveItemKey(queueItemKey(nextItem));
      }
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
      const completionGeneration = sourceGenerationRef.current;
      if (
        completionGenerationRef.current != null &&
        completionGenerationRef.current === completionGeneration
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
      const currentIndex = currentQueue.findIndex(
        (episode) => queueItemKey(episode) === finishedItemKey
      );
      const nextQueueItem =
        currentIndex >= 0 ? (currentQueue[currentIndex + 1] ?? null) : null;
      const bookId = finishedEpisode.audiobookId ?? finishedEpisode.id;
      const hasKnownTracks =
        isAudiobookQueueItem(finishedEpisode) &&
        bookId != null &&
        audiobookTracksCacheRef.current.has(bookId);
      const nextAudiobookChapter = hasKnownTracks
        ? getNextAudiobookChapter(
            finishedEpisode,
            audiobookTracksCacheRef.current,
          )
        : null;

      const hasPotentialNext =
        nextQueueItem != null ||
        (isAudiobookQueueItem(finishedEpisode) &&
          (!hasKnownTracks || nextAudiobookChapter != null));

      // Reaching the end starts a continuation even if the element already
      // emitted pause. A subsequent explicit Pause can cancel that intent.
      autoAdvanceIntentRef.current = true;
      playingRef.current = true;
      if (!hasPotentialNext) {
        sourceSwitchingRef.current = true;
        setPlaying(false);
      }
      completionGenerationRef.current = completionGeneration;
      completedAudioSourceRef.current = finishedSource;

      // Synchronous auto-advance for seamless transition on mobile / locked screen.
      // On Android Chromium, awaiting network promises when audio ends suspends Chrome
      // and blocks audio.play() due to background autoplay policy.
      // Starting the next item immediately in memory retains media continuation privileges.
      let synchronousNextItem: QueueEpisode | null = null;
      if (isAudiobookQueueItem(finishedEpisode)) {
        synchronousNextItem = getNextAudiobookChapter(
          finishedEpisode,
          cacheRevisionRef.current === queueRevisionRef.current
            ? audiobookTracksCacheRef.current
            : new Map()
        );
      } else if (nextQueueItem) {
        synchronousNextItem = nextQueueItem;
      }

      if (synchronousNextItem) {
        if (
          isAudiobookQueueItem(finishedEpisode) &&
          isAudiobookQueueItem(synchronousNextItem) &&
          sameQueueItem(synchronousNextItem, finishedEpisode)
        ) {
          setQueue((current) =>
            current.map((episode) =>
              sameQueueItem(episode, finishedEpisode)
                ? synchronousNextItem!
                : episode
            )
          );
        }

        startQueuedEpisode(synchronousNextItem);
      }

      const selectionGeneration = selectionGenerationRef.current;
      const expectedSourceGeneration = sourceGenerationRef.current;
      void commitPlayback(finishedPosition, {
        completed: true,
        durationSeconds: finishedDuration,
        target: finishedEpisode,
      })
        .then(async (response) => {
          await startAfterCompletion(
            expectedSourceGeneration,
            finishedEpisode,
            nextQueueItem,
            response,
            synchronousNextItem
              ? playbackMediaSourceKey(synchronousNextItem)
              : null,
            selectionGeneration
          );
        })
        .catch(() => {})
        .finally(() => {
          if (
            completionGenerationRef.current != null &&
            completionGenerationRef.current === completionGeneration
          ) {
            completionGenerationRef.current = null;
          }
        });
    };

    const onTimeUpdate = () => {
      if (!sourceReadyRef.current || audio.seeking) {
        return;
      }
      positionSecondsRef.current = audio.currentTime;
      setPositionSeconds(audio.currentTime);
      updateActiveDuration(sourceGenerationRef.current);
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
        if (!playingRef.current) {
          retryCleanupRef.current?.();
        }
        return;
      }
      updateActiveDuration(sourceGenerationRef.current);
      const shouldCommitPlayback = playingRef.current;
      playingRef.current = false;
      retryCleanupRef.current?.();
      setPlaying(false);
      if (shouldCommitPlayback) {
        commitCurrentPlayback();
      }
    };

    const onEnded = () => {
      completeCurrentPlayback();
    };

    const onError = () => {
      autoAdvanceIntentRef.current = false;
      sourceSwitchingRef.current = false;
      sourceReadyRef.current = false;

      const wasPlaying = playingRef.current;
      playingRef.current = false;
      retryCleanupRef.current?.();
      setPlaying(false);

      if (!userInitiatedPlayRef.current && !wasPlaying) {
        return;
      }
      userInitiatedPlayRef.current = false;
      setPlaybackError(describeMediaError(audio.error));
    };

    const onLoadedMetadata = () => {
      updateActiveDuration(sourceGenerationRef.current);
    };

    const onDurationAvailable = () => {
      updateActiveDuration(sourceGenerationRef.current);
    };

    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("loadedmetadata", onLoadedMetadata);
    audio.addEventListener("durationchange", onDurationAvailable);
    audio.addEventListener("playing", onPlaying);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("error", onError);

    return () => {
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("loadedmetadata", onLoadedMetadata);
      audio.removeEventListener("durationchange", onDurationAvailable);
      audio.removeEventListener("playing", onPlaying);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("error", onError);
      retryCleanupRef.current?.();
      audio.pause();
      audio.src = "";
      sourceReloadCleanupRef.current?.();
      sourceReloadCleanupRef.current = null;
      sourcePrimeCleanupRef.current?.();
      sourcePrimeCleanupRef.current = null;
      sourceGenerationRef.current += 1;
      sourceSwitchingRef.current = false;
      sourcePrimedRef.current = false;
      sourceReadyRef.current = false;
      resetActiveDuration();
    };
  }, [
    activeMediaDurationRef,
    allowPlaybackProgress,
    audioRef,
    commitActivePlayback,
    commitCurrentPlayback,
    commitPlayback,
    currentEpisodeRef,
    loadQueue,
    playingRef,
    queueRef,
    queueRevisionRef,
    resetActiveDuration,
    selectionGenerationRef,
    setActiveItemKey,
    setAudioDuration,
    setPlaybackError,
    setPlaying,
    setPositionSeconds,
    setQueue,
    sourcePrimedRef,
    sourceReadyRef,
    speedLabelRef,
    updateActiveDuration,
    userInitiatedPlayRef,
  ]);

  useEffect(() => {
    const itemKey = currentEpisode ? queueItemKey(currentEpisode) : null;
    if (sourceDownloadStateRef.current?.itemKey === itemKey) {
      return;
    }
    sourceReloadCleanupRef.current?.();
    sourceReloadCleanupRef.current = null;
    if (!sourcePrimeCleanupRef.current && completionGenerationRef.current !== sourceGenerationRef.current) {
      sourceSwitchingRef.current = false;
    }
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
        retryCleanupRef.current?.();
        sourceGenerationRef.current += 1;
        const currentGen = sourceGenerationRef.current;
        resetActiveDuration();
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
              queueItemKey(currentEpisodeRef.current) !== `episode:${episodeId}` ||
              sourceGenerationRef.current !== currentGen
            ) {
              sourceSwitchingRef.current = false;
              return;
            }

            sourceSwitchingRef.current = false;
            sourceReadyRef.current = true;
            updateActiveDuration(currentGen);
            if (playingRef.current) {
              void attemptAudioPlay(audio, (error) => {
                if (sourceGenerationRef.current !== currentGen) return;
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
    resetActiveDuration,
    setPlaybackError,
    setPlaying,
    setPositionSeconds,
    setQueue,
    sourceReadyRef,
    updateActiveDuration,
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

      sourcePrimeCleanupRef.current?.();
      sourcePrimeCleanupRef.current = null;
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

    if (sourceSwitchingRef.current) {
      return;
    }

    const targetSrc = getAudioSourceUrl(currentEpisode);
    const currentSrc = audio.src;
    const shouldPrimeSource =
      pendingEpisodeId !== null || playing || sourcePrimedRef.current;

    if (!currentSrc.includes(targetSrc)) {
      const currentGen = sourceGenerationRef.current;
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
      sourcePrimeCleanupRef.current?.();
      sourcePrimeCleanupRef.current = primeAudioSource(
        audio,
        currentEpisode,
        speedLabelRef.current,
        initialPos,
        setPositionSeconds,
        () => {
          sourcePrimedRef.current = true;
        },
        () => {
          sourcePrimeCleanupRef.current = null;
          sourceReadyRef.current = true;
          if (playingRef.current) {
            void attemptAudioPlay(
              audio,
              (error) => {
                setPlaying(false);
                setPlaybackError(describeAudioError(error));
              },
              () => sourceGenerationRef.current === currentGen
            );
          }
        },
        () => {
          sourcePrimeCleanupRef.current = null;
          sourceReadyRef.current = false;
          if (playingRef.current) {
            playingRef.current = false;
            setPlaying(false);
          }
          if (userInitiatedPlayRef.current) {
            userInitiatedPlayRef.current = false;
          }
          setPlaybackError(describeMediaError(audio.error));
        },
        () => sourceGenerationRef.current === currentGen
      );
    } else if (
      sourceReadyRef.current &&
      !playing &&
      !userInitiatedPlayRef.current
    ) {
      const initialPos = clampPosition(
        currentEpisode.playback?.positionSeconds ?? 0,
        currentEpisodeDuration
      );
      if (currentEpisode.playback?.positionSeconds !== undefined) {
        setAudioPosition(audio, initialPos);
        setPositionSeconds(initialPos);
      }
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
    userInitiatedPlayRef,
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
    const audio = audioRef.current;

    if (playing) {
      userInitiatedPlayRef.current = false;
      autoAdvanceIntentRef.current = false;
      playingRef.current = false;
      retryCleanupRef.current?.();
      commitCurrentPlayback();
      setPlaying(false);
      return;
    }

    if (
      currentEpisode &&
      completionGenerationRef.current === sourceGenerationRef.current
    ) {
      return;
    }

    userInitiatedPlayRef.current = true;
    if (audio && currentEpisode) {
        completedAudioSourceRef.current = null;
      allowPlaybackProgress(currentEpisode);
      sourcePrimeCleanupRef.current?.();
      sourcePrimeCleanupRef.current = null;
      sourceGenerationRef.current += 1;
      const currentGen = sourceGenerationRef.current;
      void (async () => {
        const syncedEpisode = await refreshPlaybackState(currentEpisode, {
          isActive: () => sourceGenerationRef.current === currentGen,
        });
        if (sourceGenerationRef.current !== currentGen) return;
        void commitActivePlayback(syncedEpisode);
        const nextPosition =
          syncedEpisode.playback?.positionSeconds ?? positionSecondsRef.current ?? 0;
        sourceReadyRef.current = false;
        sourcePrimeCleanupRef.current = primeAudioSource(
          audio,
          syncedEpisode,
          speedLabel,
          nextPosition,
          setPositionSeconds,
          () => {
            sourcePrimedRef.current = true;
          },
          () => {
            sourcePrimeCleanupRef.current = null;
            if (sourceGenerationRef.current !== currentGen) return;
            sourceReadyRef.current = true;
            updateActiveDuration(sourceGenerationRef.current);
            setPlaying(true);
            void attemptAudioPlay(
              audio,
              (error) => {
                if (sourceGenerationRef.current !== currentGen) return;
                setPlaying(false);
                setPlaybackError(describeAudioError(error));
              },
              () => sourceGenerationRef.current === currentGen
            );
          },
          () => {
            sourcePrimeCleanupRef.current = null;
            if (sourceGenerationRef.current !== currentGen) return;
            sourceReadyRef.current = false;
            setPlaying(false);
            setPlaybackError(describeMediaError(audio.error));
          },
          () => sourceGenerationRef.current === currentGen
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
    playing,
    playingRef,
    refreshPlaybackState,
    setPlaybackError,
    setPlaying,
    setPositionSeconds,
    sourcePrimedRef,
    sourceReadyRef,
    speedLabel,
    updateActiveDuration,
    userInitiatedPlayRef,
  ]);

  const playEpisode = useCallback(
    (episodeId: number) => {
      const currentGen = prepareSourceSwitch();
      completionGenerationRef.current = null;
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
          ? await refreshPlaybackState(queuedEpisode, {
              isActive: () => sourceGenerationRef.current === currentGen,
            })
          : null;
        if (sourceGenerationRef.current !== currentGen) {
          return;
        }
        pendingPlayEpisodeIdRef.current = syncedEpisode ? null : episodeId;
        setActiveItemKey(`episode:${episodeId}`);
        const activeItem = syncedEpisode ?? queuedEpisode;
        if (activeItem) {
          currentEpisodeRef.current = activeItem;
          void commitActivePlayback(activeItem);
        } else {
          void api.playback.setActive(episodeId);
        }
        const audio = audioRef.current;
        if (!audio) {
          sourceSwitchingRef.current = false;
          setPlaying(true);
          return;
        }

        const initialPos = syncedEpisode?.playback?.positionSeconds ?? 0;
        sourceReadyRef.current = false;
        sourcePrimeCleanupRef.current?.();
        sourcePrimeCleanupRef.current = primeAudioSource(
          audio,
          syncedEpisode ?? queuedEpisode ?? { id: episodeId },
          speedLabel,
          initialPos,
          setPositionSeconds,
          () => {
            sourcePrimedRef.current = true;
          },
          () => {
            sourcePrimeCleanupRef.current = null;
            if (sourceGenerationRef.current !== currentGen) {
              return;
            }
            sourceSwitchingRef.current = false;
            sourceReadyRef.current = true;
            updateActiveDuration(currentGen);
            setPlaying(true);
            void attemptAudioPlay(
              audio,
              (error) => {
                if (sourceGenerationRef.current !== currentGen) return;
                setPlaying(false);
                setPlaybackError(describeAudioError(error));
              },
              () => sourceGenerationRef.current === currentGen
            );
          },
          () => {
            sourcePrimeCleanupRef.current = null;
            if (sourceGenerationRef.current !== currentGen) return;
            sourceSwitchingRef.current = false;
            sourceReadyRef.current = false;
            setPlaying(false);
            setPlaybackError(describeMediaError(audio.error));
          },
          () => sourceGenerationRef.current === currentGen
        );
      })();
    },
    [
      allowPlaybackProgress,
      audioRef,
      commitActivePlayback,
      currentEpisodeRef,
      pendingPlayEpisodeIdRef,
      prepareSourceSwitch,
      queue,
      refreshPlaybackState,
      setActiveItemKey,
      setPlaybackError,
      setPlaying,
      setPositionSeconds,
      sourcePrimedRef,
      sourceReadyRef,
      speedLabel,
      updateActiveDuration,
      userInitiatedPlayRef,
    ]
  );

  const playQueueItem = useCallback(
    (item: QueueEpisode) => {
      if (!isAudiobookQueueItem(item)) {
        playEpisode(item.id);
        return;
      }

      const currentGen = prepareSourceSwitch();
      completionGenerationRef.current = null;
      completedAudioSourceRef.current = null;
      allowPlaybackProgress(item);
      setPlaybackError(null);
      userInitiatedPlayRef.current = true;
      void (async () => {
        const syncedItem = await refreshPlaybackState(item, {
          isActive: () => sourceGenerationRef.current === currentGen,
        });
        if (sourceGenerationRef.current !== currentGen) {
          return;
        }
        currentEpisodeRef.current = syncedItem;
        setActiveItemKey(queueItemKey(syncedItem));
        void commitActivePlayback(syncedItem);
        const audio = audioRef.current;
        if (!audio) {
          sourceSwitchingRef.current = false;
          setPlaying(true);
          return;
        }

        const initialPosition = syncedItem.playback?.positionSeconds ?? 0;
        sourceReadyRef.current = false;
        sourcePrimeCleanupRef.current?.();
        sourcePrimeCleanupRef.current = primeAudioSource(
          audio,
          syncedItem,
          speedLabel,
          initialPosition,
          setPositionSeconds,
          () => {
            sourcePrimedRef.current = true;
          },
          () => {
            sourcePrimeCleanupRef.current = null;
            if (sourceGenerationRef.current !== currentGen) {
              return;
            }
            sourceSwitchingRef.current = false;
            sourceReadyRef.current = true;
            updateActiveDuration(currentGen);
            setPlaying(true);
            void attemptAudioPlay(
              audio,
              (error) => {
                if (sourceGenerationRef.current !== currentGen) return;
                setPlaying(false);
                setPlaybackError(describeAudioError(error));
              },
              () => sourceGenerationRef.current === currentGen
            );
          },
          () => {
            sourcePrimeCleanupRef.current = null;
            if (sourceGenerationRef.current !== currentGen) return;
            sourceSwitchingRef.current = false;
            sourceReadyRef.current = false;
            setPlaying(false);
            setPlaybackError(describeMediaError(audio.error));
          },
          () => sourceGenerationRef.current === currentGen
        );
      })();
    },
    [
      allowPlaybackProgress,
      audioRef,
      commitActivePlayback,
      currentEpisodeRef,
      playEpisode,
      prepareSourceSwitch,
      refreshPlaybackState,
      setActiveItemKey,
      setPlaybackError,
      setPlaying,
      setPositionSeconds,
      sourcePrimedRef,
      sourceReadyRef,
      speedLabel,
      updateActiveDuration,
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

      allowPlaybackProgress({ ...queuedBook, trackId: track.id });
      const currentGen = prepareSourceSwitch();
      completionGenerationRef.current = null;
      completedAudioSourceRef.current = null;
      setPlaybackError(null);
      userInitiatedPlayRef.current = true;

      let initialPosition = track.isListened ? 0 : track.positionSeconds;
      let lastUpdated = new Date().toISOString();
      if (!track.isListened) {
        try {
          const res = await api.playback.get({
            audiobookId,
            trackId: track.id,
          });
          if (res.playback) {
            initialPosition = res.playback.positionSeconds;
            lastUpdated = res.playback.lastUpdated;
          }
        } catch {
          // fallback to track.positionSeconds
        }
      }
      if (sourceGenerationRef.current !== currentGen) {
        return;
      }
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
      if (sourceGenerationRef.current !== currentGen) {
        return;
      }
      await api.playback.setActive({ audiobookId, trackId: track.id });
      if (sourceGenerationRef.current !== currentGen) {
        return;
      }

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
          lastUpdated,
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
        sourceSwitchingRef.current = false;
        setPlaying(true);
        return;
      }
      sourceReadyRef.current = false;
      sourcePrimeCleanupRef.current?.();
      sourcePrimeCleanupRef.current = primeAudioSource(
        audio,
        nextEpisode,
        speedLabel,
        initialPosition,
        setPositionSeconds,
        () => {
          sourcePrimedRef.current = true;
        },
        () => {
          sourcePrimeCleanupRef.current = null;
          if (sourceGenerationRef.current !== currentGen) {
            return;
          }
          sourceSwitchingRef.current = false;
          sourceReadyRef.current = true;
          updateActiveDuration(currentGen);
          setPlaying(true);
          void attemptAudioPlay(
            audio,
            (error) => {
              if (sourceGenerationRef.current !== currentGen) return;
              setPlaying(false);
              setPlaybackError(describeAudioError(error));
            },
            () => sourceGenerationRef.current === currentGen
          );
        },
        () => {
          sourcePrimeCleanupRef.current = null;
          if (sourceGenerationRef.current !== currentGen) return;
          sourceSwitchingRef.current = false;
          sourceReadyRef.current = false;
          setPlaying(false);
          setPlaybackError(describeMediaError(audio.error));
        },
        () => sourceGenerationRef.current === currentGen
      );
    },
    [
      allowPlaybackProgress,
      audioRef,
      prepareSourceSwitch,
      queue,
      setActiveItemKey,
      setPlaybackError,
      setPlaying,
      setPositionSeconds,
      setQueue,
      sourcePrimedRef,
      sourceReadyRef,
      speedLabel,
      updateActiveDuration,
      userInitiatedPlayRef,
    ]
  );

  const seekForward = useCallback(() => {
    if (!audioRef.current || !currentEpisodeRef.current) return;
    const duration = getEffectiveDuration();
    const nextPosition = clampPosition(
      audioRef.current.currentTime + 30,
      duration
    );
    if (setAudioPosition(audioRef.current, nextPosition)) {
      setPositionSeconds(nextPosition);
      void commitPlayback(nextPosition, {
        didSeek: true,
        durationSeconds: duration,
      });
    }
  }, [
    audioRef,
    commitPlayback,
    currentEpisodeRef,
    getEffectiveDuration,
    setPositionSeconds,
  ]);

  const seekBackward = useCallback(() => {
    if (!audioRef.current || !currentEpisodeRef.current) return;
    const duration = getEffectiveDuration();
    const nextPosition = clampPosition(
      audioRef.current.currentTime - 15,
      duration
    );
    if (setAudioPosition(audioRef.current, nextPosition)) {
      setPositionSeconds(nextPosition);
      void commitPlayback(nextPosition, {
        didSeek: true,
        durationSeconds: duration,
      });
    }
  }, [
    audioRef,
    commitPlayback,
    currentEpisodeRef,
    getEffectiveDuration,
    setPositionSeconds,
  ]);

  const seekTo = useCallback(
    (nextPositionSeconds: number) => {
      if (!audioRef.current || !currentEpisodeRef.current) return;
      const duration = getEffectiveDuration();
      const nextPosition = clampPosition(
        nextPositionSeconds,
        duration
      );
      if (setAudioPosition(audioRef.current, nextPosition)) {
        setPositionSeconds(nextPosition);
        void commitPlayback(nextPosition, {
          didSeek: true,
          durationSeconds: duration,
        });
      }
    },
    [
      audioRef,
      commitPlayback,
      currentEpisodeRef,
      getEffectiveDuration,
      setPositionSeconds,
    ]
  );

	return {
	  cancelAutoAdvance,
	  playToggle,
	  playEpisode,
	  playQueueItem,
	  playAudiobookTrack,
	  seekForward,
	  seekBackward,
	  seekTo,
	};
}
