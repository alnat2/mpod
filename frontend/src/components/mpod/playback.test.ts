import { describe, expect, it } from "vitest";

import {
  defaultPlaybackSpeed,
  defaultPodcastPlaybackSpeed,
  defaultAudiobookPlaybackSpeed,
  playbackSpeedOptions,
} from "./playback";

describe("playback speed options", () => {
  it("keeps the approved playback speed list in order", () => {
    expect(playbackSpeedOptions).toEqual([
      "Speed 0.5x",
      "Speed 0.75x",
      "Speed 1x",
      "Speed 1.3x",
      "Speed 1.5x",
      "Speed 2x",
    ]);
  });

  it("uses Speed 1.3x for podcasts and Speed 1x for audiobooks", () => {
    expect(defaultPodcastPlaybackSpeed).toBe("Speed 1.3x");
    expect(defaultAudiobookPlaybackSpeed).toBe("Speed 1x");
    expect(defaultPlaybackSpeed).toBe("Speed 1.3x");
  });
});
