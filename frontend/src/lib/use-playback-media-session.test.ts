import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";

import type { QueueEpisode } from "./playback-context-types";
import { usePlaybackMediaSession } from "./use-playback-media-session";

describe("usePlaybackMediaSession", () => {
  const fakeSession = {
    playbackState: "none",
    metadata: null as MediaMetadata | null,
    setActionHandler: vi.fn(),
  };

  beforeEach(() => {
    fakeSession.playbackState = "none";
    fakeSession.metadata = null;
    vi.clearAllMocks();

    Object.defineProperty(navigator, "mediaSession", {
      value: fakeSession,
      configurable: true,
      writable: true,
    });
  });

  const baseEpisode: QueueEpisode = {
    id: 101,
    title: "Episode 1: The Beginning",
    podcastId: 5,
    podcastTitle: "Great History Podcast",
    podcastImageUrl: "https://example.com/cover.png",
    audioUrl: "https://example.com/ep1.mp3",
    downloaded: false,
    duration: 3600,
    isListened: false,
    publishedAt: "2026-01-01T00:00:00Z",
    playback: null,
  };

  it("sets metadata with artwork for a podcast episode", () => {
    const audioRef = { current: document.createElement("audio") };
    const currentEpisodeRef = { current: baseEpisode };
    const playingRef = { current: false };
    const userInitiatedPlayRef = { current: false };

    renderHook(() =>
      usePlaybackMediaSession({
        audioRef,
        currentEpisodeRef,
        currentEpisode: baseEpisode,
        playing: true,
        playingRef,
        userInitiatedPlayRef,
        commitCurrentPlayback: vi.fn(),
        setPlaying: vi.fn(),
        playToggle: vi.fn(),
        cancelAutoAdvance: vi.fn(),
      })
    );

    expect(fakeSession.playbackState).toBe("playing");
    expect(fakeSession.metadata).not.toBeNull();
    expect(fakeSession.metadata?.title).toBe("Episode 1: The Beginning");
    expect(fakeSession.metadata?.artist).toBe("Great History Podcast");
    expect(fakeSession.metadata?.album).toBe("Great History Podcast");
    expect(fakeSession.metadata?.artwork.length).toBeGreaterThanOrEqual(1);
    expect(fakeSession.metadata?.artwork?.[0]?.src).toBe(
      "https://example.com/cover.png"
    );
  });

  it("sets metadata with audiobook cover for an audiobook track", () => {
    const audiobookEpisode: QueueEpisode = {
      ...baseEpisode,
      id: 202,
      type: "audiobook",
      audiobookId: 42,
      title: "Chapter 1",
      author: "Famous Author",
      podcastTitle: "My Favorite Book",
      podcastImageUrl: null,
    };

    const audioRef = { current: document.createElement("audio") };
    const currentEpisodeRef = { current: audiobookEpisode };
    const playingRef = { current: false };
    const userInitiatedPlayRef = { current: false };

    renderHook(() =>
      usePlaybackMediaSession({
        audioRef,
        currentEpisodeRef,
        currentEpisode: audiobookEpisode,
        playing: false,
        playingRef,
        userInitiatedPlayRef,
        commitCurrentPlayback: vi.fn(),
        setPlaying: vi.fn(),
        playToggle: vi.fn(),
        cancelAutoAdvance: vi.fn(),
      })
    );

    expect(fakeSession.playbackState).toBe("paused");
    expect(fakeSession.metadata?.title).toBe("Chapter 1");
    expect(fakeSession.metadata?.artist).toBe("Famous Author");
    expect(fakeSession.metadata?.album).toBe("My Favorite Book");
    expect(fakeSession.metadata?.artwork?.[0]?.src).toContain(
      "/api/audiobooks/42/cover"
    );
  });

  it("clears metadata when currentEpisode is null", () => {
    const audioRef = { current: document.createElement("audio") };
    const currentEpisodeRef = { current: null };
    const playingRef = { current: false };
    const userInitiatedPlayRef = { current: false };

    renderHook(() =>
      usePlaybackMediaSession({
        audioRef,
        currentEpisodeRef,
        currentEpisode: null,
        playing: false,
        playingRef,
        userInitiatedPlayRef,
        commitCurrentPlayback: vi.fn(),
        setPlaying: vi.fn(),
        playToggle: vi.fn(),
        cancelAutoAdvance: vi.fn(),
      })
    );

    expect(fakeSession.playbackState).toBe("none");
    expect(fakeSession.metadata).toBeNull();
  });
});
