import { describe, expect, it } from "vitest";

import type { PlaybackQueueEpisode } from "./api";
import { activePlaybackKey, queueItemKey } from "./playback-queue";

function queueItem(
  id: number,
  type: "episode" | "audiobook"
): PlaybackQueueEpisode {
  return {
    id,
    podcastId: 1,
    title: type,
    audioUrl: "/audio",
    duration: 10,
    downloaded: type === "audiobook",
    isListened: false,
    publishedAt: null,
    podcastTitle: type,
    playback: null,
    type,
    ...(type === "audiobook" ? { audiobookId: id, trackId: 10 } : {}),
  };
}

describe("typed queue identity", () => {
  it("keeps an episode and audiobook with the same numeric id distinct", () => {
    expect(queueItemKey(queueItem(1, "episode"))).toBe("episode:1");
    expect(queueItemKey(queueItem(1, "audiobook"))).toBe("audiobook:1");
    expect(activePlaybackKey({ audiobookId: 1, lastUpdated: "now" })).toBe(
      "audiobook:1"
    );
  });
});
