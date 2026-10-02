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
import { prepareNextAudio } from "./prepared-audio";
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
    onError?: (error: unknown) => void;
  }
) => Promise<PlaybackUpdateResponse | null>;

const DOWNLOADED_SOURCE_POLL_MS = 5000;
const AUTO_START_TIMEOUT_MS = 30_000;

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
  const confirmedTransitionRef = useRef<{ generation: number; sourceKey: string } | null>(null);
  const autoPlayRecoveryRef = useRef<{
    generation: number;
    isCurrent: () => boolean;
    canRecover: () => boolean;
    recover: () => boolean;
  } | null>(null);
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
  const cacheRevisionRef = useRef(-1);
  const cacheRequestRef = useRef(0);
  const preparedRef = useRef<{
    controller: ReturnType<typeof prepareNextAudio>;
    ownerGeneration: number;
    revision: number;
    sourceKey: string;
  } | null>(null);
  const prepareNextRef = useRef<(() => void) | null>(null);
  const cancelPrepared = useCallback(() => {
    const prepared = preparedRef.current;
    preparedRef.current = null;
    if (!prepared) return;
    prepared.controller.cancel();
  }, []);
  const cancelAutoAdvance = useCallback(() => {
    autoAdvanceIntentRef.current = false;
    retryCleanupRef.current?.();
    cancelPrepared();
  }, [cancelPrepared]);

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
                prepareNextRef.current?.();
              }
            })
            .catch(() => {});
        }
      }
    }
  }, [queue, queueRevisionRef]);

  useEffect(() => {
    prepareNextRef.current?.();
  }, [queue, playing]);

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
    cancelPrepared();
    retryCleanupRef.current?.();
    sourceReloadCleanupRef.current?.();
    sourceReloadCleanupRef.current = null;
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
    cancelPrepared,
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
    let audio = new Audio();
    audioRef.current = audio;
    sourcePrimedRef.current = false;
    sourceReadyRef.current = false;

    const prepareNext = () => {
      if (preparedRef.current && (preparedRef.current.revision !== queueRevisionRef.current ||
        preparedRef.current.ownerGeneration !== sourceGenerationRef.current)) cancelPrepared();
      const current = currentEpisodeRef.current;
      if (!current || !playingRef.current || audio.paused || sourceSwitchingRef.current) {
        if (!playingRef.current) cancelPrepared();
        return;
      }
      const currentQueue = queueRef.current;
      const index = currentQueue.findIndex((item) => sameQueueItem(item, current));
      if (index < 0) { cancelPrepared(); return; }
      const revision = queueRevisionRef.current;
      const tracks = cacheRevisionRef.current === revision ? audiobookTracksCacheRef.current : new Map();
      const next = (isAudiobookQueueItem(current) ? getNextAudiobookChapter(current, tracks) : null) ??
        currentQueue.slice(index + 1).concat(currentQueue.slice(0, index))
          .find((item) => !item.isListened && Boolean(item.audioUrl));
      if (!next) { cancelPrepared(); return; }
      const sourceKey = playbackMediaSourceKey(next);
      const position = Math.max(0, next.playback?.positionSeconds ?? 0);
      const existing = preparedRef.current;
      if (existing?.sourceKey === sourceKey && existing.ownerGeneration === sourceGenerationRef.current &&
        existing.revision === revision && existing.controller.position === position) return;
      cancelPrepared();
      const controller = prepareNextAudio(next, speedLabelRef.current);
      preparedRef.current = { controller, ownerGeneration: sourceGenerationRef.current, revision, sourceKey };
    };
    prepareNextRef.current = prepareNext;

    const onPlaying = () => {
      if (!playingRef.current && !userInitiatedPlayRef.current) {
        audioRef.current?.pause();
        return;
      }
      playingRef.current = true;
      setPlaying(true);
      userInitiatedPlayRef.current = false;
      setPlaybackError(null);
      prepareNext();
    };

    const startQueuedEpisode = (episode: QueueEpisode) => {
      const prepared = preparedRef.current;
      const nextPosition = episode.playback?.positionSeconds ?? 0;
      const preparedAudio = prepared?.ownerGeneration === sourceGenerationRef.current &&
        prepared.revision === queueRevisionRef.current && prepared.sourceKey === playbackMediaSourceKey(episode) &&
        prepared.controller.position === nextPosition ? prepared.controller.take() : null;
      if (preparedAudio) {
        preparedRef.current = null;
      } else {
        cancelPrepared();
      }
      retryCleanupRef.current?.();
      sourcePrimeCleanupRef.current?.();
      sourcePrimeCleanupRef.current = null;
      sourceReloadCleanupRef.current?.();
      sourceReloadCleanupRef.current = null;
      selectionGenerationRef.current += 1;
      sourceSwitchingRef.current = true;
      sourceGenerationRef.current += 1;
      const currentGen = sourceGenerationRef.current;
      const currentSelection = selectionGenerationRef.current;
      const sourceKey = playbackMediaSourceKey(episode);
      resetActiveDuration();
      if (preparedAudio) switchAudio(preparedAudio);
      setPlaying(playingRef.current);
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
      let startTimeout: ReturnType<typeof setTimeout> | null = null;
      let attemptGeneration = 0;
      let reloadAttempts = 0;

      // Queue refreshes may keep this source; removing or replacing it invalidates the operation.
      const isCurrentAutoPlay = () => !canceled &&
        sourceGenerationRef.current === currentGen &&
        selectionGenerationRef.current === currentSelection &&
        audioRef.current === audio &&
        playbackMediaSourceKey(currentEpisodeRef.current) === sourceKey &&
        queueRef.current.some((item) => sameQueueItem(item, episode)) &&
        matchesMediaSource(audio.src, getAudioSourceUrl(episode));

      const clearStartTimeout = () => {
        if (startTimeout !== null) {
          clearTimeout(startTimeout);
        }
        startTimeout = null;
      };

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
        attemptGeneration += 1;
        clearRetryWait();
        clearStartTimeout();
        if (autoPlayRecoveryRef.current?.generation === currentGen) {
          autoPlayRecoveryRef.current = null;
        }
        if (retryCleanupRef.current === cancelAutoPlay) {
          retryCleanupRef.current = null;
        }
      };
      retryCleanupRef.current = cancelAutoPlay;

      const stopAutoPlay = (message: string) => {
        cancelAutoPlay();
        sourcePrimeCleanupRef.current?.();
        sourcePrimeCleanupRef.current = null;
        sourceReloadCleanupRef.current?.();
        sourceReloadCleanupRef.current = null;
        autoAdvanceIntentRef.current = false;
        userInitiatedPlayRef.current = false;
        sourceSwitchingRef.current = false;
        playingRef.current = false;
        setPlaying(false);
        setPlaybackError(message);
        audio.pause();
      };

      const armStartTimeout = () => {
        clearStartTimeout();
        startTimeout = setTimeout(() => {
          startTimeout = null;
          if (!isCurrentAutoPlay() || !playingRef.current) return;
          if (!recoverAutoPlay()) stopAutoPlay("Timeout waiting for audio to become ready");
        }, AUTO_START_TIMEOUT_MS);
      };

      const recoverAutoPlay = () => {
        if (!isCurrentAutoPlay() || !playingRef.current || reloadAttempts >= 1) return false;
        const resumePosition = playSucceeded ? audio.currentTime : nextPosition;
        reloadAttempts += 1;
        attemptGeneration += 1;
        playPending = false;
        playSucceeded = false;
        playAttempts = 0;
        clearRetryWait();
        clearStartTimeout();
        // Detach the old prime/error handlers before reloading this source.
        sourcePrimeCleanupRef.current?.();
        sourcePrimeCleanupRef.current = null;
        sourceReloadCleanupRef.current?.();
        sourceSwitchingRef.current = true;
        sourceReadyRef.current = false;
        audio.pause();
        sourceReloadCleanupRef.current = reloadAudioSourceAtPosition(
          audio,
          resumePosition,
          (position) => { if (isCurrentAutoPlay()) setPositionSeconds(position); },
          () => {
            sourceReloadCleanupRef.current = null;
            if (!isCurrentAutoPlay() || !playingRef.current) return;
            sourceSwitchingRef.current = false;
            sourceReadyRef.current = true;
            updateActiveDuration(currentGen);
            setPlaybackError(null);
            void tryPlay();
          },
          () => {
            sourceReloadCleanupRef.current = null;
            if (!isCurrentAutoPlay()) return;
            stopAutoPlay(describeMediaError(audio.error));
          }
        );
        armStartTimeout();
        return true;
      };
      autoPlayRecoveryRef.current = {
        generation: currentGen,
        isCurrent: isCurrentAutoPlay,
        canRecover: () => isCurrentAutoPlay() && reloadAttempts < 1,
        recover: recoverAutoPlay,
      };

      const tryPlay = async () => {
        if (!isCurrentAutoPlay() || !playingRef.current || playSucceeded) return;
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
        const attempt = ++attemptGeneration;
        setPlaying(true);

        const audio = audioRef.current;
        if (!audio) {
          playPending = false;
          cancelAutoPlay();
          return;
        }

        clearRetryWait();
        const playPromise = attemptAudioPlay(audio, () => {});
        const error = await playPromise;
        if (sourceGenerationRef.current !== currentGen) return;
        if (canceled || attempt !== attemptGeneration) {
          if (!playingRef.current && !audio.paused) audio.pause();
          return;
        }
        if (!isCurrentAutoPlay()) return;
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
                if (isCurrentAutoPlay() && playingRef.current) {
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
          clearRetryWait();
          clearStartTimeout();
        }
      };

      if (preparedAudio) {
        sourcePrimedRef.current = true;
        sourceReadyRef.current = true;
        sourceSwitchingRef.current = false;
        applyPlaybackRate(audio, speedLabelRef.current);
        updateActiveDuration(currentGen);
      } else sourcePrimeCleanupRef.current = primeAudioSource(
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
          if (!isCurrentAutoPlay()) {
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
          if (!isCurrentAutoPlay()) return;
          sourceSwitchingRef.current = false;
          sourceReadyRef.current = false;
          setPlaying(false);
          setPlaybackError(describeMediaError(audio.error));
        },
        isCurrentAutoPlay
      );

      if (preparedAudio || nextPosition === 0) {
        setPositionSeconds(nextPosition);
        if (playingRef.current) {
          void tryPlay();
        }
      }

      setPlaybackError(null);
      armStartTimeout();
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

      if (response && predictedSourceKey === playbackMediaSourceKey(nextItem)) {
        confirmedTransitionRef.current = {
          generation: expectedSourceGeneration,
          sourceKey: predictedSourceKey,
        };
      }
      playingRef.current = autoAdvanceIntentRef.current;
      if (predictedSourceKey !== playbackMediaSourceKey(nextItem)) {
        startQueuedEpisode(nextItem);
      } else {
        setActiveItemKey(queueItemKey(nextItem));
      }
      if (refreshedQueue) {
        queueRevisionRef.current += 1;
        setQueue(refreshedQueue.queue.map((item) =>
          sameQueueItem(item, nextItem!) ? nextItem! : item
        ));
      }
    };

    const reconcileFailedCompletion = async (
      finishedEpisode: QueueEpisode,
      finishedPosition: number,
      finishedDuration: number,
      expectedSourceGeneration: number,
      selectionGeneration: number
    ): Promise<PlaybackUpdateResponse | null> => {
      const isCurrent = () =>
        sourceGenerationRef.current === expectedSourceGeneration &&
        selectionGenerationRef.current === selectionGeneration;
      if (!isCurrent()) return null;

      try {
        if (isAudiobookQueueItem(finishedEpisode)) {
          const bookId = finishedEpisode.audiobookId ?? finishedEpisode.id;
          const { audiobook } = await api.audiobooks.get(bookId);
          if (!isCurrent()) return null;
          const finishedTrack = audiobook.tracks?.find((track) => track.id === finishedEpisode.trackId);
          if (!finishedTrack) return null;
          if (finishedTrack.isListened) {
            const next = getNextAudiobookChapter(
              finishedEpisode,
              new Map([[bookId, audiobook.tracks ?? []]])
            );
            return {
              playback: {
                audiobookId: bookId,
                trackId: finishedTrack.id,
                positionSeconds: finishedPosition,
                lastUpdated: finishedTrack.lastUpdated ?? new Date().toISOString(),
              },
              nextTarget: next?.trackId != null
                ? { type: "audiobook", audiobookId: bookId, trackId: next.trackId }
                : null,
              nextTrackId: next?.trackId ?? null,
              nextEpisodeId: null,
            };
          }
        } else {
          const { episode } = await api.episodes.get(finishedEpisode.id);
          if (!isCurrent()) return null;
          if (episode.isListened) {
            const refreshed = await loadQueue({ apply: false });
            if (!isCurrent() || !refreshed) return null;
            const finishedIndex = refreshed.queue.findIndex((item) =>
              !isAudiobookQueueItem(item) && item.id === finishedEpisode.id
            );
            // The server only supplies a fallback target when the completed
            // episode was last in the playlist. Otherwise the queued next item
            // is selected by startAfterCompletion.
            const fallback = finishedIndex === refreshed.queue.length - 1
              ? refreshed.queue.slice(0, finishedIndex).find((item) =>
                  isAudiobookQueueItem(item)
                    ? item.trackId != null
                    : !item.isListened && Boolean(item.audioUrl)
                )
              : null;
            const nextTarget = fallback
              ? isAudiobookQueueItem(fallback)
                ? { type: "audiobook" as const,
                    audiobookId: fallback.audiobookId ?? fallback.id,
                    trackId: fallback.trackId! }
                : { type: "episode" as const, episodeId: fallback.id }
              : null;
            return {
              playback: {
                episodeId: finishedEpisode.id,
                positionSeconds: finishedPosition,
                lastUpdated: new Date().toISOString(),
              },
              nextTarget,
              nextEpisodeId: nextTarget?.type === "episode" ? nextTarget.episodeId : null,
              nextTrackId: nextTarget?.type === "audiobook" ? nextTarget.trackId : null,
            };
          }
        }
        if (!isCurrent()) return null;
        return await commitPlayback(finishedPosition, {
          completed: true,
          durationSeconds: finishedDuration,
          target: finishedEpisode,

        });
      } catch {
        return null;
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
      // Keep completed tracks out of local predictions while their API response is pending.
      if (hasKnownTracks) {
        audiobookTracksCacheRef.current.set(
          bookId,
          audiobookTracksCacheRef.current.get(bookId)!.map((track) =>
            track.id === finishedEpisode.trackId
              ? { ...track, isListened: true }
              : track
          )
        );
      }
      const nextAudiobookChapter = hasKnownTracks
        ? getNextAudiobookChapter(
            finishedEpisode,
            audiobookTracksCacheRef.current,
          )
        : null;

      const hasPotentialNext =
        nextQueueItem != null || preparedRef.current != null ||
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

      // Prime the predicted source without awaiting completion/queue requests.
      // Loading can still stall in the background; the start watchdog handles it.
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
      let transportFailure = false;
      void commitPlayback(finishedPosition, {
        completed: true,
        durationSeconds: finishedDuration,
        target: finishedEpisode,

        onError: (error) => {
          transportFailure = error instanceof TypeError ||
            (error instanceof DOMException && error.name === "AbortError");
        },
      })
        .then(async (response) => {
          if (!response && transportFailure) {
            response = await reconcileFailedCompletion(
              finishedEpisode,
              finishedPosition,
              finishedDuration,
              expectedSourceGeneration,
              selectionGeneration
            );
          }
          if (response && synchronousNextItem) {
            const target = response.nextTarget;
            const matchesPrediction = target?.type === "audiobook"
              ? isAudiobookQueueItem(synchronousNextItem) &&
                (synchronousNextItem.audiobookId ?? synchronousNextItem.id) === target.audiobookId &&
                synchronousNextItem.trackId === target.trackId
              : target?.type === "episode"
                ? !isAudiobookQueueItem(synchronousNextItem) && synchronousNextItem.id === target.episodeId
                : false;
            if (
              matchesPrediction &&
              sourceGenerationRef.current === expectedSourceGeneration &&
              selectionGenerationRef.current === selectionGeneration
            ) {
              confirmedTransitionRef.current = {
                generation: expectedSourceGeneration,
                sourceKey: playbackMediaSourceKey(synchronousNextItem),
              };
            }
          }
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
      if (!audio.ended) prepareNext();
      if (audio.ended) {
        completeCurrentPlayback();
      }
    };

    const onPause = () => {
      // A retired load can queue pause after the queue has selected a new, unready source.
      if (sourceSwitchingRef.current || !sourceReadyRef.current) {
        if (!playingRef.current) {
          retryCleanupRef.current?.();
        }
        return;
      }
      if (audio.ended) {
        completeCurrentPlayback();
        return;
      }
      updateActiveDuration(sourceGenerationRef.current);
      const shouldCommitPlayback = playingRef.current;
      playingRef.current = false;
      retryCleanupRef.current?.();
      cancelPrepared();
      setPlaying(false);
      if (shouldCommitPlayback) {
        commitCurrentPlayback();
      }
    };

    const onEnded = () => {
      completeCurrentPlayback();
    };

    const onError = () => {
      const current = currentEpisodeRef.current;
      const generation = sourceGenerationRef.current;
      const confirmed = confirmedTransitionRef.current;
      const recovery = autoPlayRecoveryRef.current;
      if (
        audio.error?.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED &&
        current &&
        confirmed?.generation === generation &&
        confirmed.sourceKey === playbackMediaSourceKey(current) &&
        autoAdvanceIntentRef.current &&
        playingRef.current &&
        recovery?.generation === generation &&
        recovery.canRecover()
      ) {
        sourcePrimeCleanupRef.current?.();
        sourcePrimeCleanupRef.current = null;
        sourceSwitchingRef.current = true;
        sourceReadyRef.current = false;
        // The replacement error listener must not see this same error event.
        queueMicrotask(() => {
          if (sourceGenerationRef.current !== generation || !playingRef.current) return;
          recovery.recover();
        });
        return;
      }
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

    const onVisibilityChanged = () => {
      prepareNext();
    };

    const audioHandlers = {
      timeupdate: onTimeUpdate, loadedmetadata: onLoadedMetadata, durationchange: onDurationAvailable,
      playing: onPlaying, pause: onPause, ended: onEnded, error: onError,
    };
    let detachAudio = () => {};
    const bindAudio = (element: HTMLAudioElement) => {
      const handlers = Object.entries(audioHandlers).map(([event, handler]) => {
        const guarded = () => { if (audioRef.current === element) handler(); };
        element.addEventListener(event, guarded);
        return () => element.removeEventListener(event, guarded);
      });
      detachAudio = () => handlers.forEach((detach) => detach());
    };
    const switchAudio = (nextAudio: HTMLAudioElement) => {
      const previous = audio;
      detachAudio();
      audio = nextAudio;
      audioRef.current = nextAudio;
      bindAudio(nextAudio);
      previous.pause();
      if (typeof previous.removeAttribute === "function") previous.removeAttribute("src");
      else previous.src = "";
      previous.load();
    };
    bindAudio(audio);
    document.addEventListener("visibilitychange", onVisibilityChanged);

    return () => {
      prepareNextRef.current = null;
      cancelPrepared();
      detachAudio();
      document.removeEventListener("visibilitychange", onVisibilityChanged);
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
    cancelPrepared,
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
    const recovery = autoPlayRecoveryRef.current;
    if (!recovery || recovery.generation !== sourceGenerationRef.current || recovery.isCurrent()) return;
    cancelAutoAdvance();
    sourcePrimeCleanupRef.current?.();
    sourcePrimeCleanupRef.current = null;
    sourceReloadCleanupRef.current?.();
    sourceReloadCleanupRef.current = null;
    sourceGenerationRef.current += 1;
    selectionGenerationRef.current += 1;
    sourceReadyRef.current = false;
    // Keep playback intent for the new queue selection while retiring the old source.
    sourceSwitchingRef.current = true;
    audioRef.current?.pause();
    sourceSwitchingRef.current = false;
  }, [audioRef, cancelAutoAdvance, currentEpisode, queue, selectionGenerationRef, sourceReadyRef]);

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
