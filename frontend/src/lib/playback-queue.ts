import type { ActivePlaybackState, PlaybackQueueEpisode } from "./api";

export type QueueItemKey = `episode:${number}` | `audiobook:${number}`;

export function isAudiobookQueueItem(item: PlaybackQueueEpisode) {
  return item.type === "audiobook" || item.audiobookId !== undefined;
}

export function queueItemKey(item: PlaybackQueueEpisode): QueueItemKey {
  return isAudiobookQueueItem(item)
    ? `audiobook:${item.audiobookId ?? item.id}`
    : `episode:${item.id}`;
}

export function activePlaybackKey(
  active: ActivePlaybackState | null | undefined
): QueueItemKey | null {
  if (active?.audiobookId != null) {
    return `audiobook:${active.audiobookId}`;
  }
  if (active?.episodeId != null) {
    return `episode:${active.episodeId}`;
  }
  return null;
}

export function sameQueueItem(
  left: PlaybackQueueEpisode,
  right: PlaybackQueueEpisode
) {
  return queueItemKey(left) === queueItemKey(right);
}
