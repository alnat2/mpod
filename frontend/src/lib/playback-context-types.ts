import type { Dispatch, SetStateAction } from "react";

import type { PlaybackSpeedLabel } from "@/components/mpod/playback";
import type { PlaybackQueueEpisode } from "./api";

export type QueueEpisode = PlaybackQueueEpisode;

export type PlaybackContextType = {
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

export type PlaybackStateContextType = Omit<
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

export type PlaybackProgressContextType = Pick<
  PlaybackContextType,
  "positionSeconds" | "durationSeconds"
>;

export type PlaybackDispatchContextType = Pick<
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
