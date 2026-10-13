import { getAudioSourceUrl } from "./playback-audio";
import type { QueueEpisode } from "./playback-context-types";

// Enough to warm DNS/TLS/keep-alive and the server's file access without
// pulling a whole chapter over a mobile connection.
const PREFETCH_RANGE = "bytes=0-131071";

type Prefetch = { sourceUrl: string; abortController: AbortController };

// Warms the connection to the next source. It owns no media element, so the
// single <audio> keeps the user's playback permission across transitions.
export function createPrefetchController() {
  let current: Prefetch | null = null;

  const cancel = () => {
    current?.abortController.abort();
    current = null;
  };

  const prefetch = (episode: QueueEpisode) => {
    const sourceUrl = getAudioSourceUrl(episode);
    if (current?.sourceUrl === sourceUrl) return;
    cancel();

    const entry: Prefetch = { sourceUrl, abortController: new AbortController() };
    current = entry;
    // A failed attempt must not block a later retry for the same source.
    const release = () => {
      if (current === entry) current = null;
    };

    fetch(sourceUrl, {
      credentials: "include",
      headers: { Range: PREFETCH_RANGE },
      signal: entry.abortController.signal,
      priority: "low",
    })
      .then(async (response) => {
        // Without 206 the server ignored Range and would send the whole file.
        if (response.status !== 206) {
          entry.abortController.abort();
          release();
          return;
        }
        await response.arrayBuffer();
      })
      .catch(release);
  };

  return { prefetch, cancel };
}
