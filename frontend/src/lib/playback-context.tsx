/* eslint-disable react-refresh/only-export-components */
import {
  createContext,
  type Dispatch,
  type SetStateAction,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import {
  defaultPlaybackSpeed,
  isPlaybackSpeedLabel,
  type PlaybackSpeedLabel,
} from "@/components/mpod/playback";
import {
  api,
  type PlaybackQueueEpisode,
  type PlaybackState,
  type PlaybackUpdateResponse,
} from "./api";
import {
  applyPlaybackRate,
  attemptAudioPlay,
  clampPosition,
  describeAudioError,
  describeMediaError,
  getPositiveDuration,
  primeAudioSource,
  readAudioDuration,
  setAudioPosition,
} from "./playback-audio";

export type QueueEpisode = PlaybackQueueEpisode;

type PlaybackContextType = {
  queue: QueueEpisode[];
  currentEpisode: QueueEpisode | null;
  playing: boolean;
  playbackError: string | null;
  positionSeconds: number;
  durationSeconds: number;
  speedLabel: PlaybackSpeedLabel;
  loading: boolean;
  setSpeedLabel: (label: PlaybackSpeedLabel) => void;
  clearPlaybackError: () => void;
  playToggle: () => void;
  playEpisode: (episodeId: number) => void;
  seekTo: (positionSeconds: number) => void;
  seekForward: () => void;
  seekBackward: () => void;
  reloadQueue: () => Promise<void>;
  updateQueue: Dispatch<SetStateAction<QueueEpisode[]>>;
};

type PlaybackStateContextType = Omit<
  PlaybackContextType,
  | "positionSeconds"
  | "durationSeconds"
  | "setSpeedLabel"
  | "clearPlaybackError"
  | "playToggle"
  | "playEpisode"
  | "seekTo"
  | "seekForward"
  | "seekBackward"
  | "reloadQueue"
  | "updateQueue"
>;

type PlaybackProgressContextType = Pick<
  PlaybackContextType,
  "positionSeconds" | "durationSeconds"
>;

type PlaybackDispatchContextType = Pick<
  PlaybackContextType,
  | "setSpeedLabel"
  | "clearPlaybackError"
  | "playToggle"
  | "playEpisode"
  | "seekTo"
  | "seekForward"
  | "seekBackward"
  | "reloadQueue"
  | "updateQueue"
>;

const PlaybackStateContext = createContext<PlaybackStateContextType | null>(null);
const PlaybackProgressContext =
  createContext<PlaybackProgressContextType | null>(null);
const PlaybackDispatchContext =
  createContext<PlaybackDispatchContextType | null>(null);

export function PlaybackProvider({ children }: { children: ReactNode }) {
  const [queue, setQueue] = useState<QueueEpisode[]>([]);
  const [activeEpisodeId, setActiveEpisodeId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [positionSeconds, setPositionSeconds] = useState(0);
  const [audioDuration, setAudioDuration] = useState<{
    episodeId: number;
    durationSeconds: number;
  } | null>(null);
  const [speedLabel, setSpeedLabel] =
    useState<PlaybackSpeedLabel>(defaultPlaybackSpeed);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const sourcePrimedRef = useRef(false);
  const sourceReadyRef = useRef(false);
  const userInitiatedPlayRef = useRef(false);
  const queueRef = useRef<QueueEpisode[]>([]);
  const playingRef = useRef(false);
  const activeEpisode =
    activeEpisodeId !== null
      ? queue.find((episode) => episode.id === activeEpisodeId) ?? null
      : null;
  const currentEpisode = activeEpisode ?? queue[0] ?? null;
  const currentEpisodeRef = useRef<QueueEpisode | null>(null);
  const currentEpisodeDurationRef = useRef(0);
  const pendingPlayEpisodeIdRef = useRef<number | null>(null);
  const speedLabelRef = useRef<PlaybackSpeedLabel>(speedLabel);
  const currentEpisodeId = currentEpisode?.id;
  const currentAudioDuration =
    audioDuration && audioDuration.episodeId === currentEpisodeId
      ? audioDuration.durationSeconds
      : 0;
  const currentEpisodeDuration = getPositiveDuration(
    currentEpisode?.duration,
    currentAudioDuration
  );

  function writePlaybackState(episodeId: number, playback: PlaybackState | null) {
    setQueue((current) =>
      current.map((episode) =>
        episode.id === episodeId ? { ...episode, playback } : episode
      )
    );
  }

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

  const commitPlayback = useCallback(
    async (
      nextPositionSeconds: number,
      options: { completed?: boolean; didSeek?: boolean } = {}
    ) => {
      const episode = currentEpisodeRef.current;
      if (!episode) return null;

      try {
        const durationSeconds = currentEpisodeDurationRef.current;
        return await api.playback.update({
          episodeId: episode.id,
          positionSeconds: Math.round(
            clampPosition(nextPositionSeconds, durationSeconds)
          ),
          durationSeconds: Math.round(durationSeconds),
          completed: options.completed ?? false,
          didSeek: options.didSeek ?? false,
          clientUpdatedAt: new Date().toISOString(),
        });
      } catch {
        // silently fail for background sync
        return null;
      }
    },
    []
  );

  const commitPlaybackBeacon = useCallback((nextPositionSeconds: number) => {
    const episode = currentEpisodeRef.current;
    if (!episode || typeof navigator === "undefined" || !navigator.sendBeacon) {
      return false;
    }

    const durationSeconds = currentEpisodeDurationRef.current;
    const body = JSON.stringify({
      episodeId: episode.id,
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
  }, []);

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
    [commitPlayback, commitPlaybackBeacon]
  );

  const commitActivePlayback = useCallback(async (episodeId: number) => {
    try {
      await api.playback.setActive(episodeId);
    } catch (error) {
      console.error("Failed to update active playback", error);
    }
  }, []);

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
    []
  );

  const loadPlaybackSettings = useCallback(async () => {
    try {
      const response = await api.settings.get();
      const nextSpeed = response.settings.playbackSpeed;
      setSpeedLabel(
        isPlaybackSpeedLabel(nextSpeed) ? nextSpeed : defaultPlaybackSpeed
      );
    } catch (error) {
      console.error("Failed to load playback settings", error);
    }
  }, []);

  const loadQueue = useCallback(async () => {
    try {
      const response = await api.playback.queue();
      setQueue(response.queue);
      const nextActiveEpisodeId = response.activePlayback?.episodeId ?? null;
      setActiveEpisodeId(
        nextActiveEpisodeId !== null &&
          response.queue.some((episode) => episode.id === nextActiveEpisodeId)
          ? nextActiveEpisodeId
          : null
      );
    } catch (err) {
      console.error("Failed to load queue", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    queueRef.current = queue;
  }, [queue]);

  useEffect(() => {
    playingRef.current = playing;
  }, [playing]);

  useEffect(() => {
    speedLabelRef.current = speedLabel;
  }, [speedLabel]);

  useEffect(() => {
    currentEpisodeRef.current = currentEpisode;
  }, [currentEpisode]);

  useEffect(() => {
    currentEpisodeDurationRef.current = currentEpisodeDuration;
  }, [currentEpisodeDuration]);

  useEffect(() => {
    const syncVisiblePlaybackState = () => {
      if (document.visibilityState !== "visible") {
        return;
      }

      void loadPlaybackSettings();

      if (playingRef.current) {
        return;
      }

      const episode = currentEpisodeRef.current;
      if (!episode) {
        return;
      }

      void refreshPlaybackState(episode);
    };

    window.addEventListener("focus", syncVisiblePlaybackState);
    document.addEventListener("visibilitychange", syncVisiblePlaybackState);

    return () => {
      window.removeEventListener("focus", syncVisiblePlaybackState);
      document.removeEventListener("visibilitychange", syncVisiblePlaybackState);
    };
  }, [loadPlaybackSettings, refreshPlaybackState]);

  useEffect(() => {
    const pendingEpisodeId = pendingPlayEpisodeIdRef.current;
    if (pendingEpisodeId === null) {
      return;
    }

    const episodeIndex = queue.findIndex(
      (episode) => episode.id === pendingEpisodeId
    );
    if (episodeIndex < 0) {
      return;
    }

    pendingPlayEpisodeIdRef.current = null;
    setActiveEpisodeId(pendingEpisodeId);
  }, [queue]);

  // Setup audio element
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
        return;
      }

      const fallbackEpisode = queueRef.current.find(
        (episode) => episode.id === response.nextEpisodeId
      );
      if (!fallbackEpisode) {
        return;
      }

      const syncedEpisode = await refreshPlaybackState(fallbackEpisode, {
        applyEvenIfNotNewer: true,
      });
      startQueuedEpisode(syncedEpisode);
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
          }
          await loadQueue();
        }
      );
    };

    const onError = () => {
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
      sourcePrimedRef.current = false;
      sourceReadyRef.current = false;
    };
  }, [
    commitActivePlayback,
    commitCurrentPlayback,
    commitPlayback,
    loadQueue,
    refreshPlaybackState,
  ]);

  // Initial load
  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadQueue();
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [loadQueue]);

  useEffect(() => {
    let cancelled = false;

    const loadInitialPlaybackSettings = async () => {
      try {
        const response = await api.settings.get();
        if (cancelled) {
          return;
        }

        const nextSpeed = response.settings.playbackSpeed;
        if (isPlaybackSpeedLabel(nextSpeed)) {
          setSpeedLabel(nextSpeed);
        } else {
          setSpeedLabel(defaultPlaybackSpeed);
        }
      } catch (error) {
        console.error("Failed to load playback settings", error);
      }
    };

    void loadInitialPlaybackSettings();

    return () => {
      cancelled = true;
    };
  }, []);

  // Sync audio source when episode changes
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
      const initialPos = currentEpisode.playback?.positionSeconds ?? 0;
      if (!shouldPrimeSource) {
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

  }, [commitActivePlayback, currentEpisode, playing]);

  // Sync playing state to audio element
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    if (!playing) {
      audio.pause();
    }
  }, [playing]);

  // Sync speed
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    applyPlaybackRate(audio, speedLabel);
  }, [speedLabel]);

  // Periodic sync to backend
  useEffect(() => {
    if (!playing || !currentEpisodeId) return;

    const intervalId = window.setInterval(() => {
      if (audioRef.current) {
        void commitPlayback(audioRef.current.currentTime);
      }
    }, 15000);

    return () => window.clearInterval(intervalId);
  }, [playing, currentEpisodeId, commitPlayback]);

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
    commitCurrentPlayback,
    commitActivePlayback,
    currentEpisode,
    playing,
    positionSeconds,
    refreshPlaybackState,
    speedLabel,
  ]);

  const playEpisode = useCallback((episodeId: number) => {
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
  }, [commitActivePlayback, queue, refreshPlaybackState, speedLabel]);

  const seekForward = useCallback(() => {
    if (!audioRef.current || !currentEpisode) return;
    const nextPos = clampPosition(
      audioRef.current.currentTime + 30,
      currentEpisodeDuration
    );
    if (setAudioPosition(audioRef.current, nextPos)) {
      setPositionSeconds(nextPos);
      void commitPlayback(nextPos, { didSeek: true });
    }
  }, [currentEpisode, currentEpisodeDuration, commitPlayback]);

  const seekBackward = useCallback(() => {
    if (!audioRef.current || !currentEpisode) return;
    const nextPos = clampPosition(
      audioRef.current.currentTime - 15,
      currentEpisodeDuration
    );
    if (setAudioPosition(audioRef.current, nextPos)) {
      setPositionSeconds(nextPos);
      void commitPlayback(nextPos, { didSeek: true });
    }
  }, [currentEpisode, currentEpisodeDuration, commitPlayback]);

  const seekTo = useCallback((positionSeconds: number) => {
    if (!audioRef.current || !currentEpisode) return;
    const nextPos = clampPosition(positionSeconds, currentEpisodeDuration);
    if (setAudioPosition(audioRef.current, nextPos)) {
      setPositionSeconds(nextPos);
      void commitPlayback(nextPos, { didSeek: true });
    }
  }, [currentEpisode, currentEpisodeDuration, commitPlayback]);

  const updateSpeedLabel = useCallback((label: PlaybackSpeedLabel) => {
    setSpeedLabel(label);
    void api.settings.update({ playbackSpeed: label }).catch((error) => {
      console.error("Failed to update playback speed", error);
    });
  }, []);

  const clearPlaybackError = useCallback(() => {
    setPlaybackError(null);
  }, []);

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
      navigator.mediaSession.playbackState = currentEpisode
        ? playing
          ? "playing"
          : "paused"
        : "none";
    } catch {
      // Playback still works when the browser exposes only partial Media Session support.
    }
  }, [currentEpisode, playing]);

  const stateValue = useMemo(
    () => ({
      queue,
      currentEpisode,
      playing,
      playbackError,
      speedLabel,
      loading,
    }),
    [queue, currentEpisode, playing, playbackError, speedLabel, loading]
  );

  const progressValue = useMemo(
    () => ({
      positionSeconds,
      durationSeconds: currentEpisodeDuration,
    }),
    [positionSeconds, currentEpisodeDuration]
  );

  const dispatchValue = useMemo(
    () => ({
      setSpeedLabel: updateSpeedLabel,
      clearPlaybackError,
      playToggle,
      playEpisode,
      seekTo,
      seekForward,
      seekBackward,
      reloadQueue: loadQueue,
      updateQueue: setQueue,
    }),
    [
      loadQueue,
      updateSpeedLabel,
      clearPlaybackError,
      playToggle,
      playEpisode,
      seekTo,
      seekForward,
      seekBackward,
    ]
  );

  return (
    <PlaybackStateContext.Provider value={stateValue}>
      <PlaybackProgressContext.Provider value={progressValue}>
        <PlaybackDispatchContext.Provider value={dispatchValue}>
          {children}
        </PlaybackDispatchContext.Provider>
      </PlaybackProgressContext.Provider>
    </PlaybackStateContext.Provider>
  );
}

export function usePlaybackState() {
  const context = useContext(PlaybackStateContext);
  if (!context) {
    throw new Error("usePlaybackState must be used within PlaybackProvider");
  }
  return context;
}

export function usePlaybackProgress() {
  const context = useContext(PlaybackProgressContext);
  if (!context) {
    throw new Error("usePlaybackProgress must be used within PlaybackProvider");
  }
  return context;
}

export function usePlaybackDispatch() {
  const context = useContext(PlaybackDispatchContext);
  if (!context) {
    throw new Error("usePlaybackDispatch must be used within PlaybackProvider");
  }
  return context;
}

export function usePlayback(): PlaybackContextType {
  return {
    ...usePlaybackState(),
    ...usePlaybackProgress(),
    ...usePlaybackDispatch(),
  };
}
