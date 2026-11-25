import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";

import type { QueueEpisode } from "./playback-context-types";
import { usePlaybackMediaSession } from "./use-playback-media-session";

describe("usePlaybackMediaSession", () => {
  const actionHandlers = new Map<MediaSessionAction, MediaSessionActionHandler>();
  const fakeSession = {
    playbackState: "none",
    metadata: null as MediaMetadata | null,
    setActionHandler: vi.fn((action: MediaSessionAction, handler: MediaSessionActionHandler | null) => {
      if (handler) {
        actionHandlers.set(action, handler);
      } else {
        actionHandlers.delete(action);
      }
    }),
  };

  beforeEach(() => {
    fakeSession.playbackState = "none";
    fakeSession.metadata = null;
    delete (fakeSession as { setPositionState?: unknown }).setPositionState;
    actionHandlers.clear();
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
    expect(
      fakeSession.metadata?.artwork.some((art) => art.src.includes("icon-512.png"))
    ).toBe(false);
  });

  it("sets metadata with audiobook cover for an audiobook track when hasCover is true", () => {
    const audiobookEpisode: QueueEpisode = {
      ...baseEpisode,
      id: 202,
      type: "audiobook",
      audiobookId: 42,
      hasCover: true,
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

  it("uses fallback cover for an audiobook track when hasCover is false", () => {
    const audiobookWithoutCover: QueueEpisode = {
      ...baseEpisode,
      id: 203,
      type: "audiobook",
      audiobookId: 43,
      hasCover: false,
      title: "Chapter 2",
      author: "Famous Author",
      podcastTitle: "My Favorite Book",
      podcastImageUrl: null,
    };

    const audioRef = { current: document.createElement("audio") };
    const currentEpisodeRef = { current: audiobookWithoutCover };
    const playingRef = { current: false };
    const userInitiatedPlayRef = { current: false };

    renderHook(() =>
      usePlaybackMediaSession({
        audioRef,
        currentEpisodeRef,
        currentEpisode: audiobookWithoutCover,
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
    expect(fakeSession.metadata?.artwork?.[0]?.src).toContain(
      "/audiobook-fallback.png"
    );
  });

  it("resolves cover via episode.id when episode.type is audiobook and audiobookId is absent", () => {
    const folderAudiobook: QueueEpisode = {
      ...baseEpisode,
      id: 99,
      type: "audiobook",
      audiobookId: undefined,
      hasCover: true,
      title: "Audiobook Title",
      author: "Great Writer",
      podcastTitle: "Audiobook Title",
      podcastImageUrl: null,
    };

    const audioRef = { current: document.createElement("audio") };
    const currentEpisodeRef = { current: folderAudiobook };
    const playingRef = { current: false };
    const userInitiatedPlayRef = { current: false };

    renderHook(() =>
      usePlaybackMediaSession({
        audioRef,
        currentEpisodeRef,
        currentEpisode: folderAudiobook,
        playing: true,
        playingRef,
        userInitiatedPlayRef,
        commitCurrentPlayback: vi.fn(),
        setPlaying: vi.fn(),
        playToggle: vi.fn(),
        cancelAutoAdvance: vi.fn(),
      })
    );

    expect(fakeSession.metadata?.artwork?.[0]?.src).toContain(
      "/api/audiobooks/99/cover"
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

  describe("media session action handlers", () => {
    it("calls playToggle when play action is invoked and audio is paused, even if playingRef was true", () => {
      const audio = document.createElement("audio");
      audio.src = "https://example.com/ep1.mp3";
      Object.defineProperty(audio, "paused", { value: true, configurable: true, writable: true });

      const audioRef = { current: audio };
      const currentEpisodeRef = { current: baseEpisode };
      const playingRef = { current: true }; // simulates stale state after Chrome/hardware pause
      const setPlaying = vi.fn();
      const playToggle = vi.fn();
      const sourceReadyRef = { current: true };

      renderHook(() =>
        usePlaybackMediaSession({
          audioRef,
          currentEpisodeRef,
          currentEpisode: baseEpisode,
          playing: true,
          playingRef,
          userInitiatedPlayRef: { current: false },
          commitCurrentPlayback: vi.fn(),
          setPlaying,
          playToggle,
          cancelAutoAdvance: vi.fn(),
          sourceReadyRef,
        })
      );

      const playHandler = actionHandlers.get("play");
      expect(playHandler).toBeDefined();
      playHandler!({ action: "play" });

      expect(playingRef.current).toBe(false);
      expect(setPlaying).toHaveBeenCalledWith(false);
      expect(playToggle).toHaveBeenCalledTimes(1);
    });

    it("does not call playToggle when play action is invoked while audio is already playing", () => {
      const audio = document.createElement("audio");
      audio.src = "https://example.com/ep1.mp3";
      Object.defineProperty(audio, "paused", { value: false, configurable: true, writable: true });

      const audioRef = { current: audio };
      const currentEpisodeRef = { current: baseEpisode };
      const playingRef = { current: true };
      const setPlaying = vi.fn();
      const playToggle = vi.fn();

      renderHook(() =>
        usePlaybackMediaSession({
          audioRef,
          currentEpisodeRef,
          currentEpisode: baseEpisode,
          playing: true,
          playingRef,
          userInitiatedPlayRef: { current: false },
          commitCurrentPlayback: vi.fn(),
          setPlaying,
          playToggle,
          cancelAutoAdvance: vi.fn(),
        })
      );

      const playHandler = actionHandlers.get("play");
      expect(playHandler).toBeDefined();
      playHandler!({ action: "play" });

      expect(playToggle).not.toHaveBeenCalled();
    });

    it("is idempotent when play action is invoked while source is preparing/buffering", () => {
      const audio = document.createElement("audio");
      audio.src = "https://example.com/ep1.mp3";
      Object.defineProperty(audio, "paused", { value: true, configurable: true, writable: true });

      const audioRef = { current: audio };
      const currentEpisodeRef = { current: baseEpisode };
      const playingRef = { current: true };
      const setPlaying = vi.fn();
      const playToggle = vi.fn();
      const sourceReadyRef = { current: false }; // buffering / preparing metadata

      renderHook(() =>
        usePlaybackMediaSession({
          audioRef,
          currentEpisodeRef,
          currentEpisode: baseEpisode,
          playing: true,
          playingRef,
          userInitiatedPlayRef: { current: false },
          commitCurrentPlayback: vi.fn(),
          setPlaying,
          playToggle,
          cancelAutoAdvance: vi.fn(),
          sourceReadyRef,
        })
      );

      const playHandler = actionHandlers.get("play");
      expect(playHandler).toBeDefined();
      playHandler!({ action: "play" });

      expect(playToggle).not.toHaveBeenCalled();
      expect(playingRef.current).toBe(true);
      expect(setPlaying).toHaveBeenCalledWith(true);
    });

    it("pauses audio, cancels auto advance, and commits playback on pause action", () => {
      const audio = document.createElement("audio");
      audio.src = "https://example.com/ep1.mp3";
      Object.defineProperty(audio, "paused", { value: false, configurable: true, writable: true });
      const pauseSpy = vi.spyOn(audio, "pause").mockImplementation(() => {
        Object.defineProperty(audio, "paused", { value: true, configurable: true, writable: true });
      });

      const audioRef = { current: audio };
      const currentEpisodeRef = { current: baseEpisode };
      const playingRef = { current: true };
      const setPlaying = vi.fn();
      const playToggle = vi.fn();
      const cancelAutoAdvance = vi.fn();
      const commitCurrentPlayback = vi.fn();

      renderHook(() =>
        usePlaybackMediaSession({
          audioRef,
          currentEpisodeRef,
          currentEpisode: baseEpisode,
          playing: true,
          playingRef,
          userInitiatedPlayRef: { current: false },
          commitCurrentPlayback,
          setPlaying,
          playToggle,
          cancelAutoAdvance,
        })
      );

      const pauseHandler = actionHandlers.get("pause");
      expect(pauseHandler).toBeDefined();
      pauseHandler!({ action: "pause" });

      expect(pauseSpy).toHaveBeenCalledTimes(1);
      expect(playingRef.current).toBe(false);
      expect(setPlaying).toHaveBeenCalledWith(false);
      expect(cancelAutoAdvance).toHaveBeenCalledTimes(1);
      expect(commitCurrentPlayback).toHaveBeenCalledTimes(1);
    });

    it("calls playToggle when sourceReadyRef is omitted and audio is paused", () => {
      const audio = document.createElement("audio");
      audio.src = "https://example.com/ep1.mp3";
      Object.defineProperty(audio, "paused", { value: true, configurable: true, writable: true });

      const audioRef = { current: audio };
      const currentEpisodeRef = { current: baseEpisode };
      const playingRef = { current: false };
      const playToggle = vi.fn();

      renderHook(() =>
        usePlaybackMediaSession({
          audioRef,
          currentEpisodeRef,
          currentEpisode: baseEpisode,
          playing: false,
          playingRef,
          userInitiatedPlayRef: { current: false },
          commitCurrentPlayback: vi.fn(),
          setPlaying: vi.fn(),
          playToggle,
          cancelAutoAdvance: vi.fn(),
        })
      );

      const playHandler = actionHandlers.get("play");
      playHandler!({ action: "play" });

      expect(playToggle).toHaveBeenCalledTimes(1);
    });

    it("synchronously sets playbackState to playing on play action and paused on pause action", () => {
      const audio = document.createElement("audio");
      audio.src = "https://example.com/ep1.mp3";
      Object.defineProperty(audio, "paused", { value: true, configurable: true, writable: true });

      const audioRef = { current: audio };
      const currentEpisodeRef = { current: baseEpisode };
      const playingRef = { current: false };
      const userInitiatedPlayRef = { current: false };
      const playToggle = vi.fn(() => {
        userInitiatedPlayRef.current = true;
      });

      renderHook(() =>
        usePlaybackMediaSession({
          audioRef,
          currentEpisodeRef,
          currentEpisode: baseEpisode,
          playing: false,
          playingRef,
          userInitiatedPlayRef,
          commitCurrentPlayback: vi.fn(),
          setPlaying: vi.fn(),
          playToggle,
          cancelAutoAdvance: vi.fn(),
        })
      );

      const playHandler = actionHandlers.get("play");
      expect(playHandler).toBeDefined();
      playHandler!({ action: "play" });
      expect(fakeSession.playbackState).toBe("playing");

      const pauseHandler = actionHandlers.get("pause");
      expect(pauseHandler).toBeDefined();
      pauseHandler!({ action: "pause" });
      expect(fakeSession.playbackState).toBe("paused");
    });

    it("keeps playbackState as paused if playToggle is a no-op", () => {
      const audio = document.createElement("audio");
      audio.src = "https://example.com/ep1.mp3";
      Object.defineProperty(audio, "paused", { value: true, configurable: true, writable: true });

      const audioRef = { current: audio };
      const currentEpisodeRef = { current: baseEpisode };
      const playingRef = { current: false };
      const userInitiatedPlayRef = { current: false };
      const playToggle = vi.fn(); // no-op, does not initiate play

      renderHook(() =>
        usePlaybackMediaSession({
          audioRef,
          currentEpisodeRef,
          currentEpisode: baseEpisode,
          playing: false,
          playingRef,
          userInitiatedPlayRef,
          commitCurrentPlayback: vi.fn(),
          setPlaying: vi.fn(),
          playToggle,
          cancelAutoAdvance: vi.fn(),
        })
      );

      const playHandler = actionHandlers.get("play");
      expect(playHandler).toBeDefined();
      playHandler!({ action: "play" });
      expect(fakeSession.playbackState).toBe("paused");
    });

    it("registers and delegates seekforward, seekbackward, and seekto action handlers", () => {
      const audio = document.createElement("audio");
      audio.src = "https://example.com/ep1.mp3";
      const audioRef = { current: audio };
      const currentEpisodeRef = { current: baseEpisode };
      const playingRef = { current: true };
      const seekForward = vi.fn();
      const seekBackward = vi.fn();
      const seekTo = vi.fn();

      renderHook(() =>
        usePlaybackMediaSession({
          audioRef,
          currentEpisodeRef,
          currentEpisode: baseEpisode,
          playing: true,
          playingRef,
          userInitiatedPlayRef: { current: false },
          commitCurrentPlayback: vi.fn(),
          setPlaying: vi.fn(),
          playToggle: vi.fn(),
          cancelAutoAdvance: vi.fn(),
          seekForward,
          seekBackward,
          seekTo,
        })
      );

      const forwardHandler = actionHandlers.get("seekforward");
      expect(forwardHandler).toBeDefined();
      forwardHandler!({ action: "seekforward" });
      expect(seekForward).toHaveBeenCalledTimes(1);

      const backwardHandler = actionHandlers.get("seekbackward");
      expect(backwardHandler).toBeDefined();
      backwardHandler!({ action: "seekbackward" });
      expect(seekBackward).toHaveBeenCalledTimes(1);

      const seekToHandler = actionHandlers.get("seekto");
      expect(seekToHandler).toBeDefined();
      seekToHandler!({ action: "seekto", seekTime: 120 });
      expect(seekTo).toHaveBeenCalledWith(120);
    });

    it("calls setPositionState with duration, position, and playbackRate", () => {
      const setPositionState = vi.fn();
      Object.assign(fakeSession, { setPositionState });

      const audio = document.createElement("audio");
      audio.src = "https://example.com/ep1.mp3";
      Object.defineProperty(audio, "currentTime", { value: 45, configurable: true });
      Object.defineProperty(audio, "playbackRate", { value: 1.5, configurable: true });

      const audioRef = { current: audio };
      const currentEpisodeRef = { current: baseEpisode };
      const playingRef = { current: true };

      renderHook(() =>
        usePlaybackMediaSession({
          audioRef,
          currentEpisodeRef,
          currentEpisode: baseEpisode,
          playing: true,
          playingRef,
          userInitiatedPlayRef: { current: false },
          commitCurrentPlayback: vi.fn(),
          setPlaying: vi.fn(),
          playToggle: vi.fn(),
          cancelAutoAdvance: vi.fn(),
          positionSeconds: 45,
          duration: 3600,
          speedLabel: "1.5x",
        })
      );

      expect(setPositionState).toHaveBeenCalledWith({
        duration: 3600,
        playbackRate: 1.5,
        position: 45,
      });
    });

    it("ignores invalid seekTime in seekto handler", () => {
      const seekTo = vi.fn();
      const audio = document.createElement("audio");
      audio.src = "https://example.com/ep1.mp3";
      const audioRef = { current: audio };
      const currentEpisodeRef = { current: baseEpisode };
      const playingRef = { current: true };

      renderHook(() =>
        usePlaybackMediaSession({
          audioRef,
          currentEpisodeRef,
          currentEpisode: baseEpisode,
          playing: true,
          playingRef,
          userInitiatedPlayRef: { current: false },
          commitCurrentPlayback: vi.fn(),
          setPlaying: vi.fn(),
          playToggle: vi.fn(),
          cancelAutoAdvance: vi.fn(),
          seekTo,
        })
      );

      const seekToHandler = actionHandlers.get("seekto");
      expect(seekToHandler).toBeDefined();

      seekToHandler!({ action: "seekto", seekTime: undefined });
      expect(seekTo).not.toHaveBeenCalled();

      seekToHandler!({ action: "seekto", seekTime: NaN });
      expect(seekTo).not.toHaveBeenCalled();

      seekToHandler!({ action: "seekto", seekTime: Infinity });
      expect(seekTo).not.toHaveBeenCalled();
    });

    it("ignores non-finite duration and position in setPositionState", () => {
      const setPositionState = vi.fn();
      Object.assign(fakeSession, { setPositionState });

      const audio = document.createElement("audio");
      audio.src = "https://example.com/ep1.mp3";
      Object.defineProperty(audio, "currentTime", { value: NaN, configurable: true });
      Object.defineProperty(audio, "duration", { value: NaN, configurable: true });

      const audioRef = { current: audio };
      const currentEpisodeRef = { current: baseEpisode };
      const playingRef = { current: true };

      renderHook(() =>
        usePlaybackMediaSession({
          audioRef,
          currentEpisodeRef,
          currentEpisode: baseEpisode,
          playing: true,
          playingRef,
          userInitiatedPlayRef: { current: false },
          commitCurrentPlayback: vi.fn(),
          setPlaying: vi.fn(),
          playToggle: vi.fn(),
          cancelAutoAdvance: vi.fn(),
          positionSeconds: NaN,
          duration: NaN,
        })
      );

      expect(setPositionState).not.toHaveBeenCalled();
    });
  });
});
