import { renderHook, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "@/lib/api";
import { useSubscriptionActions } from "./use-subscription-actions";

describe("useSubscriptionActions - markListened", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function setupHook() {
    const reloadQueue = vi.fn().mockResolvedValue(undefined);
    const setPodcasts = vi.fn();
    const setReloadKey = vi.fn();

    const hook = renderHook(() =>
      useSubscriptionActions({
        podcasts: [
          {
            id: 1,
            title: "Test Podcast",
            rssUrl: "https://example.com/feed.xml",
            lastChecked: null,
            updateTime: null,
            episodes: [
              {
                id: 101,
                podcastId: 1,
                title: "Ep 1",
                audioUrl: "https://example.com/1.mp3",
                duration: 60,
                downloaded: false,
                isListened: false,
                publishedAt: null,
                inPlaylist: false,
              },
              {
                id: 102,
                podcastId: 1,
                title: "Ep 2",
                audioUrl: "https://example.com/2.mp3",
                duration: 60,
                downloaded: false,
                isListened: false,
                publishedAt: null,
                inPlaylist: false,
              },
            ],
          },
        ],
        reloadQueue,
        setPodcasts,
        setReloadKey,
        showAll: true,
      })
    );

    return { ...hook, reloadQueue, setPodcasts, setReloadKey };
  }

  it("calls setListened for a single episode", async () => {
    const setListenedSpy = vi
      .spyOn(api.episodes, "setListened")
      .mockResolvedValue({ episode: { id: 101, isListened: true } });
    const setBulkListenedSpy = vi.spyOn(api.episodes, "setBulkListened");

    const { result, reloadQueue, setReloadKey } = setupHook();

    await act(async () => {
      await result.current.markListened([{ id: 101, title: "Ep 1" }], true);
    });

    expect(setListenedSpy).toHaveBeenCalledTimes(1);
    expect(setListenedSpy).toHaveBeenCalledWith(101, true);
    expect(setBulkListenedSpy).not.toHaveBeenCalled();
    expect(reloadQueue).toHaveBeenCalledTimes(1);
    expect(setReloadKey).toHaveBeenCalledTimes(1);
  });

  it("calls setBulkListened once for multiple episodes instead of sequential calls", async () => {
    const setListenedSpy = vi.spyOn(api.episodes, "setListened");
    const setBulkListenedSpy = vi
      .spyOn(api.episodes, "setBulkListened")
      .mockResolvedValue({ success: true, updatedCount: 2 });

    const { result, reloadQueue, setReloadKey } = setupHook();

    await act(async () => {
      await result.current.markListened(
        [
          { id: 101, title: "Ep 1" },
          { id: 102, title: "Ep 2" },
        ],
        true
      );
    });

    expect(setBulkListenedSpy).toHaveBeenCalledTimes(1);
    expect(setBulkListenedSpy).toHaveBeenCalledWith([101, 102], true);
    expect(setListenedSpy).not.toHaveBeenCalled();
    expect(reloadQueue).toHaveBeenCalledTimes(1);
    expect(setReloadKey).toHaveBeenCalledTimes(1);
  });
});
