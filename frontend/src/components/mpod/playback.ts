export const playbackSpeedOptions = [
  "Speed 0.5x",
  "Speed 0.75x",
  "Speed 1x",
  "Speed 1.3x",
  "Speed 1.5x",
  "Speed 2x",
] as const;

export type PlaybackSpeedLabel = (typeof playbackSpeedOptions)[number];

export const defaultPodcastPlaybackSpeed: PlaybackSpeedLabel = "Speed 1.3x";
export const defaultAudiobookPlaybackSpeed: PlaybackSpeedLabel = "Speed 1x";
export const defaultPlaybackSpeed: PlaybackSpeedLabel = defaultPodcastPlaybackSpeed;

export function isPlaybackSpeedLabel(
  value: string
): value is PlaybackSpeedLabel {
  return playbackSpeedOptions.includes(value as PlaybackSpeedLabel);
}
