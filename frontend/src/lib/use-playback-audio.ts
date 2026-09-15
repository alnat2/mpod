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
    options?: { applyEvenIfNotNewer?: boolean }
  ) => Promise<QueueEpisode>;
  loadQueue: () => Promise<{
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

function getNextAudiobookChapter(
  episode: QueueEpisode,
  tracksCache: Map<number, AudiobookTrack[]>,
  nextQueueItem: QueueEpisode | null
): QueueEpisode | null {
  const bookId = episode.audiobookId ?? episode.id;
  if (!bookId) {
    return nextQueueItem;
  }
  const tracks = tracksCache.get(bookId);
  if (!tracks || tracks.length === 0) {
    return null;
  }

  const playlistTracks = tracks.filter(
    (t) => (t.inPlaylist ?? t.isInPlaylist) !== false
  );
  const eligibleTracks = playlistTracks.length > 0 ? playlistTracks : tracks;
  const sortedTracks = [...eligibleTracks].sort((a, b) => {
    if (a.trackNumber !== b.trackNumber) {
      return a.trackNumber - b.trackNumber;
    }
    return a.id - b.id;
  });

  const currentTrackId = episode.trackId;
  const currentIndex = sortedTracks.findIndex(
    (t) =>
      t.id === currentTrackId ||
      (episode.trackNumber != null && t.trackNumber === episode.trackNumber)
  );

  if (currentIndex >= 0 && currentIndex + 1 < sortedTracks.length) {
    const nextTrack = sortedTracks[currentIndex + 1];
    if (nextTrack) {
      return {
        ...episode,
        trackId: nextTrack.id,
        trackNumber: nextTrack.trackNumber,
        duration: nextTrack.duration ?? null,
        audioUrl: `/api/audiobooks/${bookId}/tracks/${nextTrack.id}/audio`,
        playback: {
          audiobookId: bookId,
          trackId: nextTrack.id,
          positionSeconds: 0,
          lastUpdated: new Date().toISOString(),
        },
      };
    }
  }

  return nextQueueItem;
}

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
  const completionInProgressEpisodeIdRef = useRef<QueueItemKey | null>(null);
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

  useEffect(() => {
    if (!currentEpisode || !isAudiobookQueueItem(currentEpisode)) {
      return;
    }
    const bookId = currentEpisode.audiobookId ?? currentEpisode.id;
    if (!bookId || audiobookTracksCacheRef.current.has(bookId)) {
      return;
    }
    let cancelled = false;
    void api.audiobooks
      .get(bookId)
      .then((res) => {
        if (!cancelled && res?.audiobook?.tracks) {
          audiobookTracksCacheRef.current.set(bookId, res.audiobook.tracks);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [currentEpisode]);

  useEffect(() => {
    for (const item of queue) {
      if (isAudiobookQueueItem(item)) {
        const bookId = item.audiobookId ?? item.id;
        if (bookId && !audiobookTracksCacheRef.current.has(bookId)) {
          void api.audiobooks
            .get(bookId)
            .then((res) => {
              if (res?.audiobook?.tracks) {
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
  }, [queue]);

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
      playingRef.current = true;
      setPlaying(true);
      userInitiatedPlayRef.current = false;
      setPlaybackError(null);
    };

    const startQueuedEpisode = (episode: QueueEpisode) => {
      sourceSwitchingRef.current = true;
      sourceGenerationRef.current += 1;
      const currentGen = sourceGenerationRef.current;
      resetActiveDuration();
      const nextPosition = episode.playback?.positionSeconds ?? 0;
      currentEpisodeRef.current = episode;
      setActiveItemKey(queueItemKey(episode));
      void commitActivePlayback(episode);
      sourceReadyRef.current = false;

      let playInitiated = false;
      let playFailedWithNotSupported = false;
      const playOnce = (isRetry = false) => {
        if (sourceGenerationRef.current !== currentGen) {
          return;
        }
        if (playInitiated && !isRetry) {
          return;
        }
        playInitiated = true;
        setPlaying(true);
        void attemptAudioPlay(audio, (error) => {
          if (error instanceof DOMException && error.name === "NotSupportedError") {
            if (!isRetry && !sourceReadyRef.current) {
              // Note: There is no practical race condition between this asynchronous
              // rejection and the `onReady` callback. If `onReady` fired synchronously
              // because the browser was already prepared, `audio.play()` would not have
              // been rejected with `NotSupportedError` in the first place.
              playFailedWithNotSupported = true;
              return;
            }
          }
          setPlaying(false);
          setPlaybackError(describeAudioError(error));
        });
      };

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
          if (sourceGenerationRef.current !== currentGen) {
            return;
          }
          sourceSwitchingRef.current = false;
          sourceReadyRef.current = true;
          updateActiveDuration(currentGen);
          if (playFailedWithNotSupported) {
            playOnce(true);
          } else {
            playOnce();
          }
        }
      );

      if (nextPosition === 0) {
        setPositionSeconds(0);
        playOnce();
      }

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
      const nextTarget = response?.nextTarget;
      let nextItem =
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

      const nextTrackId =
        nextTarget?.type === "audiobook"
          ? nextTarget.trackId
          : (response?.nextTrackId ?? null);

      if (!nextItem && nextTrackId != null && isAudiobookQueueItem(completedItem)) {
        const abId = completedItem.audiobookId ?? completedItem.id;
        nextItem = {
          ...completedItem,
          trackId: nextTrackId,
          duration: null,
          audioUrl: `/api/audiobooks/${abId}/tracks/${nextTrackId}/audio`,
          playback: {
            audiobookId: abId,
            trackId: nextTrackId,
            positionSeconds: 0,
            lastUpdated: new Date().toISOString(),
          },
        };
        setQueue((current) =>
          current.map((episode) =>
            sameQueueItem(episode, completedItem) ? nextItem! : episode
          )
        );
      }

      if (!nextItem) {
        playingRef.current = false;
        setPlaying(false);
        return;
      }

      if (completionInProgressEpisodeIdRef.current !== completedItemKey) {
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
      const currentIndex = currentQueue.findIndex(
        (episode) => queueItemKey(episode) === finishedItemKey
      );
      const nextQueueItem =
        currentIndex >= 0 ? (currentQueue[currentIndex + 1] ?? null) : null;

      const hasPotentialNext =
        nextQueueItem != null ||
        isAudiobookQueueItem(finishedEpisode);

      if (!hasPotentialNext) {
        playingRef.current = false;
        setPlaying(false);
      }
      completionInProgressEpisodeIdRef.current = finishedItemKey;
      completedAudioSourceRef.current = finishedSource;

      // Synchronous auto-advance for seamless transition on mobile / locked screen.
      // On Android Chromium, awaiting network promises when audio ends suspends Chrome
      // and blocks audio.play() due to background autoplay policy.
      // Starting the next item immediately in memory retains media continuation privileges.
      let synchronousNextItem: QueueEpisode | null = null;
      if (isAudiobookQueueItem(finishedEpisode)) {
        synchronousNextItem = getNextAudiobookChapter(
          finishedEpisode,
          audiobookTracksCacheRef.current,
          nextQueueItem
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

        void commitPlayback(finishedPosition, {
          completed: true,
          durationSeconds: finishedDuration,
          target: finishedEpisode,
        })
          .then(async () => {
            await loadQueue();
          })
          .catch(() => {})
          .finally(() => {
            if (completionInProgressEpisodeIdRef.current === finishedItemKey) {
              completionInProgressEpisodeIdRef.current = null;
            }
          });
        return;
      }

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
            response
          );
        })
        .catch(() => {
          void startAfterCompletion(
            finishedItemKey,
            finishedEpisode,
            nextQueueItem,
            null
          );
        })
        .finally(() => {
          if (completionInProgressEpisodeIdRef.current === finishedItemKey) {
            completionInProgressEpisodeIdRef.current = null;
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
        return;
      }
      updateActiveDuration(sourceGenerationRef.current);
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
      audio.pause();
      audio.src = "";
      sourceReloadCleanupRef.current?.();
      sourceReloadCleanupRef.current = null;
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
    resetActiveDuration,
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
    } else if (!playing && !userInitiatedPlayRef.current) {
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
            updateActiveDuration(sourceGenerationRef.current);
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
      completionInProgressEpisodeIdRef.current = null;
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
            if (sourceGenerationRef.current !== currentGen) {
              return;
            }
            sourceSwitchingRef.current = false;
            sourceReadyRef.current = true;
            updateActiveDuration(currentGen);
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
      completionInProgressEpisodeIdRef.current = null;
      completedAudioSourceRef.current = null;
      allowPlaybackProgress(item);
      setPlaybackError(null);
      userInitiatedPlayRef.current = true;
      void (async () => {
        const syncedItem = await refreshPlaybackState(item);
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
            if (sourceGenerationRef.current !== currentGen) {
              return;
            }
            sourceSwitchingRef.current = false;
            sourceReadyRef.current = true;
            updateActiveDuration(currentGen);
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
      completionInProgressEpisodeIdRef.current = null;
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
          if (sourceGenerationRef.current !== currentGen) {
            return;
          }
          sourceSwitchingRef.current = false;
          sourceReadyRef.current = true;
          updateActiveDuration(currentGen);
          setPlaying(true);
          void attemptAudioPlay(audio, (error) => {
            setPlaying(false);
            setPlaybackError(describeAudioError(error));
          });
        }
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
	  playToggle,
	  playEpisode,
	  playQueueItem,
	  playAudiobookTrack,
	  seekForward,
	  seekBackward,
	  seekTo,
	};
}
