export const playbackSpeedOptions = [
  "Speed 0.5x",
  "Speed 0.75x",
  "Speed 1x",
  "Speed 1.3x",
  "Speed 1.5x",
  "Speed 2x",
] as const;

export type PlaybackSpeedLabel = (typeof playbackSpeedOptions)[number];

export const defaultPlaybackSpeed: PlaybackSpeedLabel = "Speed 1.3x";

export function isPlaybackSpeedLabel(
  value: string
): value is PlaybackSpeedLabel {
  return playbackSpeedOptions.includes(value as PlaybackSpeedLabel);
}
