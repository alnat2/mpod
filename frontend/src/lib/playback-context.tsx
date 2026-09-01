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
  defaultPodcastPlaybackSpeed,
  defaultAudiobookPlaybackSpeed,
  type PlaybackSpeedLabel,
} from "@/components/mpod/playback";
import { api } from "./api";
import { getPositiveDuration } from "./playback-audio";
import {
  isAudiobookQueueItem,
  queueItemKey,
  type QueueItemKey,
} from "./playback-queue";
import type {
  PlaybackContextType,
  PlaybackDispatchContextType,
  PlaybackProgressContextType,
  PlaybackStateContextType,
  QueueEpisode,
} from "./playback-context-types";
import { usePlaybackAudio } from "./use-playback-audio";
import { usePlaybackMediaSession } from "./use-playback-media-session";
import { usePlaybackSync } from "./use-playback-sync";

export type { QueueEpisode } from "./playback-context-types";

const PlaybackStateContext = createContext<PlaybackStateContextType | null>(null);
const PlaybackProgressContext =
  createContext<PlaybackProgressContextType | null>(null);
const PlaybackDispatchContext =
  createContext<PlaybackDispatchContextType | null>(null);

export function PlaybackProvider({ children }: { children: ReactNode }) {
  const [queue, setQueue] = useState<QueueEpisode[]>([]);
  const [activeItemKey, setActiveItemKey] = useState<QueueItemKey | null>(null);
  const [loading, setLoading] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [positionSeconds, setPositionSeconds] = useState(0);
  const [audioDuration, setAudioDuration] = useState<{
    itemKey: QueueItemKey;
    durationSeconds: number;
  } | null>(null);
  const [podcastSpeed, setPodcastSpeed] =
    useState<PlaybackSpeedLabel>(defaultPodcastPlaybackSpeed);
  const [audiobookSpeed, setAudiobookSpeed] =
    useState<PlaybackSpeedLabel>(defaultAudiobookPlaybackSpeed);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const sourcePrimedRef = useRef(false);
  const sourceReadyRef = useRef(false);
  const userInitiatedPlayRef = useRef(false);
  const queueRef = useRef<QueueEpisode[]>([]);
  const playingRef = useRef(false);
  const currentEpisodeRef = useRef<QueueEpisode | null>(null);
  const currentEpisodeDurationRef = useRef(0);
  const pendingPlayEpisodeIdRef = useRef<number | null>(null);
  const activeEpisode =
    activeItemKey !== null
      ? queue.find((episode) => queueItemKey(episode) === activeItemKey) ?? null
      : null;
  const currentEpisode = activeEpisode ?? queue[0] ?? null;
  const isAudiobook =
    currentEpisode?.type === "audiobook" || Boolean(currentEpisode?.audiobookId);
  const speedLabel = isAudiobook ? audiobookSpeed : podcastSpeed;
  const speedLabelRef = useRef<PlaybackSpeedLabel>(speedLabel);
  const currentItemKey = currentEpisode ? queueItemKey(currentEpisode) : undefined;
  const currentAudioDuration =
    audioDuration && audioDuration.itemKey === currentItemKey
      ? audioDuration.durationSeconds
      : 0;
  const currentEpisodeDuration = getPositiveDuration(
    currentEpisode?.duration,
    currentAudioDuration
  );

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

  const {
    commitPlayback,
    commitCurrentPlayback,
    allowPlaybackProgress,
    commitActivePlayback,
    refreshPlaybackState,
    loadQueue,
    reloadQueue,
  } = usePlaybackSync({
    audioRef,
    sourcePrimedRef,
    sourceReadyRef,
    currentEpisodeRef,
    currentEpisodeDurationRef,
    playingRef,
    playing,
    currentItemKey,
    setQueue,
    setActiveItemKey,
    setLoading,
    setPositionSeconds,
    setSpeedLabel: setPodcastSpeed,
    setAudiobookSpeedLabel: setAudiobookSpeed,
  });

  useEffect(() => {
    const pendingEpisodeId = pendingPlayEpisodeIdRef.current;
    if (pendingEpisodeId === null) {
      return;
    }

    const episodeIndex = queue.findIndex(
      (episode) =>
        !isAudiobookQueueItem(episode) && episode.id === pendingEpisodeId
    );
    if (episodeIndex < 0) {
      return;
    }

    pendingPlayEpisodeIdRef.current = null;
    setActiveItemKey(`episode:${pendingEpisodeId}`);
  }, [queue]);

	const {
	  playToggle,
	  playEpisode,
	  playQueueItem,
	  playAudiobookTrack,
	  seekTo,
	  seekForward,
	  seekBackward,
	} =
    usePlaybackAudio({
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
    });

  const updateSpeedLabel = useCallback((label: PlaybackSpeedLabel) => {
    const isCurrentAudiobook =
      currentEpisodeRef.current?.type === "audiobook" ||
      Boolean(currentEpisodeRef.current?.audiobookId);
    if (isCurrentAudiobook) {
      setAudiobookSpeed(label);
	  void api.settings
		.update({ audiobookPlaybackSpeed: label })
		.catch((error) => {
		  console.error("Failed to update audiobook playback speed", error);
		});
    } else {
      setPodcastSpeed(label);
      void api.settings.update({ playbackSpeed: label }).catch((error) => {
        console.error("Failed to update playback speed", error);
      });
    }
  }, []);

  const clearPlaybackError = useCallback(() => {
    setPlaybackError(null);
  }, []);

  usePlaybackMediaSession({
    audioRef,
    currentEpisodeRef,
    currentEpisode,
    playing,
    playingRef,
    userInitiatedPlayRef,
    commitCurrentPlayback,
    setPlaying,
    playToggle,
  });

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
      playQueueItem,
      playAudiobookTrack,
      seekTo,
      seekForward,
      seekBackward,
      reloadQueue,
      updateQueue: setQueue,
    }),
    [
      reloadQueue,
      updateSpeedLabel,
      clearPlaybackError,
      playToggle,
      playEpisode,
      playQueueItem,
      playAudiobookTrack,
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
