import { describe, expect, it } from "vitest";

import {
  defaultPlaybackSpeed,
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

  it("uses Speed 1.3x as the default", () => {
    expect(defaultPlaybackSpeed).toBe("Speed 1.3x");
  });
});
