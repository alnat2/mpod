/* eslint-disable react-refresh/only-export-components */
import {
  createContext,
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
import { api, type Episode, type PlaybackState } from "./api";

export type QueueEpisode = Episode & {
  podcastTitle: string;
  podcastImageUrl?: string | null;
  playback: PlaybackState | null;
};

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
  updateQueue: (newQueue: QueueEpisode[]) => void;
};

const PlaybackContext = createContext<PlaybackContextType | null>(null);

function playbackRateFromLabel(label: PlaybackSpeedLabel) {
  return Number(label.replace("Speed ", "").replace("x", "")) || 1;
}

function applyPlaybackRate(
  audio: HTMLAudioElement,
  speedLabel: PlaybackSpeedLabel
) {
  const nextRate = playbackRateFromLabel(speedLabel);
  audio.defaultPlaybackRate = nextRate;
  audio.playbackRate = nextRate;
}

function clampPosition(positionSeconds: number, durationSeconds?: number | null) {
  const nonNegativePosition = Math.max(0, positionSeconds);
  if (!durationSeconds) {
    return nonNegativePosition;
  }
  return Math.min(durationSeconds, nonNegativePosition);
}

async function attemptAudioPlay(
  audio: HTMLAudioElement,
  onFailure: (error: unknown) => void
) {
  try {
    await audio.play();
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return;
    }
    onFailure(error);
  }
}

function describeAudioError(error: unknown) {
  if (error instanceof DOMException) {
    return `${error.name}: ${error.message || "Playback was blocked."}`;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Playback failed.";
}

function describeMediaError(error: MediaError | null) {
  if (!error) {
    return "Media failed to load.";
  }

  switch (error.code) {
    case MediaError.MEDIA_ERR_ABORTED:
      return "Media loading was aborted.";
    case MediaError.MEDIA_ERR_NETWORK:
      return "Network error while loading audio.";
    case MediaError.MEDIA_ERR_DECODE:
      return "Audio could not be decoded.";
    case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
      return "Audio source is not supported.";
    default:
      return error.message || "Media failed to load.";
  }
}

function primeAudioSource(
  audio: HTMLAudioElement,
  episode: QueueEpisode,
  speedLabel: PlaybackSpeedLabel,
  positionSeconds: number,
  setPositionSeconds: (positionSeconds: number) => void,
  markPrimed: () => void
) {
  const targetSrc = `${window.location.origin}/api/episodes/${episode.id}/audio`;
  if (!audio.src.includes(targetSrc)) {
    audio.pause();
    audio.src = targetSrc;
    markPrimed();
  }
  applyPlaybackRate(audio, speedLabel);
  audio.currentTime = positionSeconds;
  setPositionSeconds(positionSeconds);
}

export function PlaybackProvider({ children }: { children: ReactNode }) {
  const [queue, setQueue] = useState<QueueEpisode[]>([]);
  const [activeEpisodeId, setActiveEpisodeId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [positionSeconds, setPositionSeconds] = useState(0);
  const [speedLabel, setSpeedLabel] =
    useState<PlaybackSpeedLabel>(defaultPlaybackSpeed);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const sourcePrimedRef = useRef(false);
  const userInitiatedPlayRef = useRef(false);
  const queueRef = useRef<QueueEpisode[]>([]);
  const activeEpisode =
    activeEpisodeId !== null
      ? queue.find((episode) => episode.id === activeEpisodeId) ?? null
      : null;
  const currentEpisode = activeEpisode ?? queue[0] ?? null;
  const currentEpisodeRef = useRef<QueueEpisode | null>(null);
  const pendingPlayEpisodeIdRef = useRef<number | null>(null);
  const currentEpisodeId = currentEpisode?.id;
  const currentEpisodeDuration = currentEpisode?.duration ?? 0;

  const commitPlayback = useCallback(
    async (
      nextPositionSeconds: number,
      options: { completed?: boolean; didSeek?: boolean } = {}
    ) => {
      const episode = currentEpisodeRef.current;
      if (!episode) return;

      try {
        await api.playback.update({
          episodeId: episode.id,
          positionSeconds: Math.round(
            clampPosition(nextPositionSeconds, episode.duration)
          ),
          durationSeconds: episode.duration ?? 0,
          completed: options.completed ?? false,
          didSeek: options.didSeek ?? false,
          clientUpdatedAt: new Date().toISOString(),
        });
      } catch {
        // silently fail for background sync
      }
    },
    []
  );

  const loadQueue = useCallback(async () => {
    try {
      const [playlistResponse, podcastResponse] = await Promise.all([
        api.playlist.list(),
        api.podcasts.list(),
      ]);
      const items = playlistResponse.items ?? [];
      const podcasts = podcastResponse.podcasts ?? [];
      const fullEpisodes = await Promise.all(
        items.map((item) => api.episodes.get(item.episodeId))
      );
      const playbackResults = await Promise.all(
        items.map((item) => api.playback.get(item.episodeId))
      );
      const nextQueue = fullEpisodes.map(({ episode }, index) => {
        const podcast = podcasts.find((p) => p.id === episode.podcastId);
        return {
          ...episode,
          podcastTitle: podcast?.title ?? "Podcast",
          podcastImageUrl: podcast?.imageUrl
            ? api.podcasts.imagePath(podcast.id)
            : null,
          playback: playbackResults[index].playback,
        };
      });

      setQueue(nextQueue);
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
    currentEpisodeRef.current = currentEpisode;
  }, [currentEpisode]);

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

    const onTimeUpdate = () => {
      setPositionSeconds(audio.currentTime);
    };

    const onPlaying = () => {
      userInitiatedPlayRef.current = false;
      setPlaybackError(null);
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
        const nextPosition = nextEpisode.playback?.positionSeconds ?? 0;
        setActiveEpisodeId(nextEpisode.id);
        primeAudioSource(
          audio,
          nextEpisode,
          speedLabel,
          nextPosition,
          setPositionSeconds,
          () => {
            sourcePrimedRef.current = true;
          }
        );
        setPlaybackError(null);
        setPlaying(true);
      } else {
        setPlaying(false);
      }

      void commitPlayback(audio.currentTime, { completed: true }).then(() =>
        loadQueue()
      );
    };

    const onError = () => {
      setPlaying(false);
      if (!userInitiatedPlayRef.current) {
        return;
      }
      userInitiatedPlayRef.current = false;
      setPlaybackError(describeMediaError(audio.error));
    };

    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("playing", onPlaying);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("error", onError);

    return () => {
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("playing", onPlaying);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("error", onError);
      audio.pause();
      audio.src = "";
      sourcePrimedRef.current = false;
    };
  }, [commitPlayback, loadQueue, speedLabel]);

  // Initial load
  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadQueue();
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [loadQueue]);

  useEffect(() => {
    let cancelled = false;

    const loadPlaybackSettings = async () => {
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

    void loadPlaybackSettings();

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
      setPositionSeconds(initialPos);
      if (!shouldPrimeSource) {
        setPlaybackError(null);
        return;
      }

      primeAudioSource(
        audio,
        currentEpisode,
        speedLabel,
        initialPos,
        setPositionSeconds,
        () => {
          sourcePrimedRef.current = true;
        }
      );
    }

    if (playing) {
      void attemptAudioPlay(audio, (error) => {
        setPlaying(false);
        setPlaybackError(describeAudioError(error));
      });
    }
  }, [currentEpisode, playing, speedLabel]);

  // Sync playing state to audio element
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    if (playing) {
      void attemptAudioPlay(audio, (error) => {
        setPlaying(false);
        setPlaybackError(describeAudioError(error));
      });
    } else {
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

  const playToggle = useCallback(() => {
    setPlaybackError(null);
    userInitiatedPlayRef.current = true;
    const audio = audioRef.current;
    if (!playing && audio && currentEpisode) {
      const nextPosition = positionSeconds || currentEpisode.playback?.positionSeconds || 0;
      primeAudioSource(
        audio,
        currentEpisode,
        speedLabel,
        nextPosition,
        setPositionSeconds,
        () => {
          sourcePrimedRef.current = true;
        }
      );
    }
    setPlaying((p) => !p);
  }, [currentEpisode, playing, positionSeconds, speedLabel]);

  const playEpisode = useCallback((episodeId: number) => {
    setPlaybackError(null);
    userInitiatedPlayRef.current = true;
    const queuedEpisode =
      queue.find((episode) => episode.id === episodeId) ?? null;
    pendingPlayEpisodeIdRef.current = queuedEpisode ? null : episodeId;
    setActiveEpisodeId(episodeId);
    const audio = audioRef.current;
    if (audio) {
      const initialPos = queuedEpisode?.playback?.positionSeconds ?? 0;
      if (queuedEpisode) {
        primeAudioSource(
          audio,
          queuedEpisode,
          speedLabel,
          initialPos,
          setPositionSeconds,
          () => {
            sourcePrimedRef.current = true;
          }
        );
      } else {
        const targetSrc = `${window.location.origin}/api/episodes/${episodeId}/audio`;
        if (!audio.src.includes(targetSrc)) {
          audio.pause();
          audio.src = targetSrc;
          sourcePrimedRef.current = true;
        }
        applyPlaybackRate(audio, speedLabel);
        audio.currentTime = initialPos;
        setPositionSeconds(initialPos);
      }
      void attemptAudioPlay(audio, (error) => {
        setPlaying(false);
        setPlaybackError(describeAudioError(error));
      });
    }
    setPlaying(true);
  }, [queue, speedLabel]);

  const seekForward = useCallback(() => {
    if (!audioRef.current || !currentEpisode) return;
    const nextPos = clampPosition(audioRef.current.currentTime + 15, currentEpisode.duration);
    audioRef.current.currentTime = nextPos;
    setPositionSeconds(nextPos);
    void commitPlayback(nextPos, { didSeek: true });
  }, [currentEpisode, commitPlayback]);

  const seekBackward = useCallback(() => {
    if (!audioRef.current || !currentEpisode) return;
    const nextPos = clampPosition(audioRef.current.currentTime - 10, currentEpisode.duration);
    audioRef.current.currentTime = nextPos;
    setPositionSeconds(nextPos);
    void commitPlayback(nextPos, { didSeek: true });
  }, [currentEpisode, commitPlayback]);

  const seekTo = useCallback((positionSeconds: number) => {
    if (!audioRef.current || !currentEpisode) return;
    const nextPos = clampPosition(positionSeconds, currentEpisode.duration);
    audioRef.current.currentTime = nextPos;
    setPositionSeconds(nextPos);
    void commitPlayback(nextPos, { didSeek: true });
  }, [currentEpisode, commitPlayback]);

  const updateSpeedLabel = useCallback((label: PlaybackSpeedLabel) => {
    setSpeedLabel(label);
    void api.settings.update({ playbackSpeed: label }).catch((error) => {
      console.error("Failed to update playback speed", error);
    });
  }, []);

  const contextValue = useMemo(
    () => ({
      queue,
      currentEpisode,
      playing,
      playbackError,
      positionSeconds,
      durationSeconds: currentEpisodeDuration,
      speedLabel,
      loading,
      setSpeedLabel: updateSpeedLabel,
      clearPlaybackError: () => setPlaybackError(null),
      playToggle,
      playEpisode,
      seekTo,
      seekForward,
      seekBackward,
      reloadQueue: loadQueue,
      updateQueue: setQueue,
    }),
    [
      queue,
      currentEpisode,
      playing,
      playbackError,
      positionSeconds,
      currentEpisodeDuration,
      speedLabel,
      loading,
      loadQueue,
      updateSpeedLabel,
      playToggle,
      playEpisode,
      seekTo,
      seekForward,
      seekBackward,
    ]
  );

  return (
    <PlaybackContext.Provider value={contextValue}>
      {children}
    </PlaybackContext.Provider>
  );
}

export function usePlayback() {
  const context = useContext(PlaybackContext);
  if (!context) {
    throw new Error("usePlayback must be used within PlaybackProvider");
  }
  return context;
}
