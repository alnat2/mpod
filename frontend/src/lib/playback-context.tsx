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
import type { PlaybackSpeedLabel } from "@/components/mpod/playback";
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
  positionSeconds: number;
  durationSeconds: number;
  speedLabel: PlaybackSpeedLabel;
  loading: boolean;
  setSpeedLabel: (label: PlaybackSpeedLabel) => void;
  playToggle: () => void;
  seekForward: () => void;
  seekBackward: () => void;
  reloadQueue: () => Promise<void>;
  updateQueue: (newQueue: QueueEpisode[]) => void;
};

const PlaybackContext = createContext<PlaybackContextType | null>(null);

function playbackRateFromLabel(label: PlaybackSpeedLabel) {
  return Number(label.replace("Speed ", "").replace("x", "")) || 1;
}

function clampPosition(positionSeconds: number, durationSeconds?: number | null) {
  const nonNegativePosition = Math.max(0, positionSeconds);
  if (!durationSeconds) {
    return nonNegativePosition;
  }
  return Math.min(durationSeconds, nonNegativePosition);
}

export function PlaybackProvider({ children }: { children: ReactNode }) {
  const [queue, setQueue] = useState<QueueEpisode[]>([]);
  const [loading, setLoading] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [positionSeconds, setPositionSeconds] = useState(0);
  const [speedLabel, setSpeedLabel] = useState<PlaybackSpeedLabel>("Speed 1x");

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const currentEpisode = queue[0] ?? null;
  const currentEpisodeRef = useRef<QueueEpisode | null>(null);
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
          podcastImageUrl: podcast?.imageUrl,
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
    currentEpisodeRef.current = currentEpisode;
  }, [currentEpisode]);

  // Setup audio element
  useEffect(() => {
    const audio = new Audio();
    audioRef.current = audio;

    const onTimeUpdate = () => {
      setPositionSeconds(audio.currentTime);
    };

    const onEnded = () => {
      setPlaying(false);
      void commitPlayback(audio.currentTime, { completed: true }).then(() =>
        loadQueue()
      );
    };

    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("ended", onEnded);

    return () => {
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("ended", onEnded);
      audio.pause();
      audio.src = "";
    };
  }, [commitPlayback, loadQueue]);

  // Initial load
  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadQueue();
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [loadQueue]);

  // Sync audio source when episode changes
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !currentEpisode) {
      if (audio) {
        audio.pause();
        audio.src = "";
      }
      setPlaying(false);
      return;
    }

    const currentSrc = audio.src;
    const targetSrc = `${window.location.origin}/api/episodes/${currentEpisode.id}/audio`;

    if (!currentSrc.includes(targetSrc)) {
      audio.src = targetSrc;
      const initialPos = currentEpisode.playback?.positionSeconds ?? 0;
      audio.currentTime = initialPos;
      setPositionSeconds(initialPos);
      if (playing) {
        audio.play().catch(() => setPlaying(false));
      }
    }
  }, [currentEpisode, playing]);

  // Sync playing state to audio element
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    if (playing) {
      audio.play().catch(() => setPlaying(false));
    } else {
      audio.pause();
    }
  }, [playing]);

  // Sync speed
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.playbackRate = playbackRateFromLabel(speedLabel);
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
    setPlaying((p) => !p);
  }, []);

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

  const contextValue = useMemo(
    () => ({
      queue,
      currentEpisode,
      playing,
      positionSeconds,
      durationSeconds: currentEpisodeDuration,
      speedLabel,
      loading,
      setSpeedLabel,
      playToggle,
      seekForward,
      seekBackward,
      reloadQueue: loadQueue,
      updateQueue: setQueue,
    }),
    [
      queue,
      currentEpisode,
      playing,
      positionSeconds,
      currentEpisodeDuration,
      speedLabel,
      loading,
      loadQueue,
      playToggle,
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
