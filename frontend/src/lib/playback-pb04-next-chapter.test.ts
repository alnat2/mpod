import { describe, expect, it } from "vitest";

import type { AudiobookTrack } from "./api";
import type { QueueEpisode } from "./playback-context-types";
import { getNextAudiobookChapter } from "./use-playback-audio";

const chapter = (
  id: number,
  trackNumber: number,
  options: Partial<AudiobookTrack> = {}
): AudiobookTrack => ({
  id,
  audiobookId: 10,
  trackNumber,
  title: `Chapter ${trackNumber}`,
  relPath: `${trackNumber}.mp3`,
  filePath: `/books/${trackNumber}.mp3`,
  duration: 100,
  isListened: false,
  inPlaylist: true,
  positionSeconds: 0,
  ...options,
});

const currentBook = (trackId: number, trackNumber: number): QueueEpisode => ({
  type: "audiobook",
  id: 10,
  audiobookId: 10,
  trackId,
  trackNumber,
  title: "Book",
  podcastId: 0,
  podcastTitle: "Book",
  podcastImageUrl: null,
  description: null,
  audioUrl: `/api/audiobooks/10/tracks/${trackId}/audio`,
  duration: 100,
  downloaded: false,
  isListened: false,
  publishedAt: null,
  playback: null,
});

describe("PB-04 next chapter prediction", () => {
  it("skips a listened chapter and chooses the selected unlistened chapter", () => {
    const tracks = [chapter(1, 1), chapter(2, 2, { isListened: true }), chapter(3, 3)];
    const result = getNextAudiobookChapter(currentBook(1, 1), new Map([[10, tracks]]));
    expect(result?.trackId).toBe(3);
  });

  it("keeps the saved position of the next selected chapter", () => {
    const tracks = [chapter(1, 1), chapter(2, 2, { positionSeconds: 42, lastUpdated: "2026-09-24T10:00:00Z" })];
    const result = getNextAudiobookChapter(currentBook(1, 1), new Map([[10, tracks]]));
    expect(result?.playback?.positionSeconds).toBe(42);
  });

  it("wraps to an earlier selected unlistened chapter", () => {
    const tracks = [chapter(1, 1), chapter(2, 2, { isListened: true }), chapter(3, 3)];
    const result = getNextAudiobookChapter(currentBook(3, 3), new Map([[10, tracks]]));
    expect(result?.trackId).toBe(1);
  });

  it("never treats a book with no selected chapters as all selected", () => {
    const tracks = [chapter(1, 1, { inPlaylist: false }), chapter(2, 2, { inPlaylist: false })];
    const result = getNextAudiobookChapter(currentBook(1, 1), new Map([[10, tracks]]));
    expect(result).toBeNull();
  });

  it("does not start another top-level item before backend completion", () => {
    const tracks = [chapter(1, 1)];
    const result = getNextAudiobookChapter(currentBook(1, 1), new Map([[10, tracks]]));
    expect(result).toBeNull();
  });
});
