import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";

import { api, type Episode, type Podcast } from "@/lib/api";
import type { CachedSubscriptionPodcast } from "@/lib/subscriptions-cache";

import { getErrorMessage } from "./screen-utils";
import { useDelayedActions } from "./use-delayed-actions";

export const PODCAST_EXIT_ANIMATION_MS = 220;
export const REFRESH_ALL_STATUS_POLL_MS = 3000;
export const REFRESH_ALL_WALL_CLOCK_TIMEOUT_MS = 120_000;
export const REFRESH_ALL_MAX_CONSECUTIVE_ERRORS = 3;

type UseSubscriptionActionsOptions = {
  podcasts: CachedSubscriptionPodcast[];
  reloadQueue: () => Promise<void>;
  setPodcasts: Dispatch<SetStateAction<CachedSubscriptionPodcast[]>>;
  setReloadKey: Dispatch<SetStateAction<number>>;
  showAll: boolean;
};

function shouldReduceMotion() {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function isRefreshAllTimedOut(startTime: number | null): boolean {
  if (startTime === null) {
    return false;
  }
  return Date.now() - startTime >= REFRESH_ALL_WALL_CLOCK_TIMEOUT_MS;
}

export function useSubscriptionActions({
  podcasts,
  reloadQueue,
  setPodcasts,
  setReloadKey,
  showAll,
}: UseSubscriptionActionsOptions) {
  const [refreshingPodcastIds, setRefreshingPodcastIds] = useState<Set<number>>(
    () => new Set()
  );
  const [refreshingAll, setRefreshingAll] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [exitingPodcastIds, setExitingPodcastIds] = useState<Set<number>>(
    () => new Set()
  );
  const podcastExitTimeoutsRef = useRef<Set<ReturnType<typeof setTimeout>>>(
    new Set()
  );
  const refreshAllStatusTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  const refreshAllStartTimeRef = useRef<number | null>(null);
  const refreshAllConsecutiveErrorsRef = useRef<number>(0);
  const refreshAllOperationIdRef = useRef<number>(0);
  const mountedRef = useRef(true);
  const { pendingActions, scheduleAction, undoAction } = useDelayedActions({
    onCommitted: () => setReloadKey((current) => current + 1),
    onError: (caught) => setActionError(getErrorMessage(caught)),
  });

  function cancelRefreshAllPolling() {
    refreshAllOperationIdRef.current += 1;
    if (refreshAllStatusTimeoutRef.current !== null) {
      clearTimeout(refreshAllStatusTimeoutRef.current);
      refreshAllStatusTimeoutRef.current = null;
    }
    refreshAllStartTimeRef.current = null;
    refreshAllConsecutiveErrorsRef.current = 0;
  }

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      cancelRefreshAllPolling();
    };
  }, []);

  useEffect(
    () => () => {
      podcastExitTimeoutsRef.current.forEach((timeoutId) =>
        clearTimeout(timeoutId)
      );
      podcastExitTimeoutsRef.current.clear();
    },
    []
  );

  const pendingUnsubscribePodcastIds = useMemo(
    () =>
      new Set(
        pendingActions
          .filter((action) => action.kind === "unsubscribe-podcast")
          .map((action) => action.podcastId)
          .filter((podcastId): podcastId is number => podcastId !== undefined)
      ),
    [pendingActions]
  );

  async function runAction(action: () => Promise<unknown>) {
    setActionError(null);
    try {
      await action();
      await reloadQueue();
      setReloadKey((current) => current + 1);
    } catch (caught) {
      setActionError(getErrorMessage(caught));
    }
  }

  function animatePodcastExit(podcastIds: number[]) {
    const uniquePodcastIds = Array.from(new Set(podcastIds));
    if (uniquePodcastIds.length === 0 || shouldReduceMotion()) {
      return Promise.resolve();
    }

    setExitingPodcastIds((current) => {
      const next = new Set(current);
      uniquePodcastIds.forEach((podcastId) => next.add(podcastId));
      return next;
    });

    return new Promise<void>((resolve) => {
      const timeoutId = setTimeout(() => {
        podcastExitTimeoutsRef.current.delete(timeoutId);
        resolve();
      }, PODCAST_EXIT_ANIMATION_MS);

      podcastExitTimeoutsRef.current.add(timeoutId);
    });
  }

  function clearPodcastExit(podcastIds: number[]) {
    if (podcastIds.length === 0) {
      return;
    }

    setExitingPodcastIds((current) => {
      const next = new Set(current);
      podcastIds.forEach((podcastId) => next.delete(podcastId));
      return next;
    });
  }

  function pollRefreshAllCompletion(operationId: number) {
    if (refreshAllStatusTimeoutRef.current !== null) {
      clearTimeout(refreshAllStatusTimeoutRef.current);
      refreshAllStatusTimeoutRef.current = null;
    }

    if (!mountedRef.current || refreshAllOperationIdRef.current !== operationId) {
      return;
    }

    if (isRefreshAllTimedOut(refreshAllStartTimeRef.current)) {
      setRefreshingAll(false);
      setActionError("Refresh all timed out. Please try again.");
      return;
    }

    refreshAllStatusTimeoutRef.current = setTimeout(() => {
      void refreshAfterRefreshAllCompletes(operationId);
    }, REFRESH_ALL_STATUS_POLL_MS);
  }

  async function refreshAfterRefreshAllCompletes(operationId: number) {
    refreshAllStatusTimeoutRef.current = null;

    if (!mountedRef.current || refreshAllOperationIdRef.current !== operationId) {
      return;
    }

    if (isRefreshAllTimedOut(refreshAllStartTimeRef.current)) {
      setRefreshingAll(false);
      setActionError("Refresh all timed out. Please try again.");
      return;
    }

    try {
      const { scheduler } = await api.jobs.status();
      if (!mountedRef.current || refreshAllOperationIdRef.current !== operationId) {
        return;
      }

      refreshAllConsecutiveErrorsRef.current = 0;

      if (scheduler.state === "running") {
        pollRefreshAllCompletion(operationId);
        return;
      }

      if (scheduler.state === "failed") {
        setActionError(scheduler.lastError ?? "Failed to refresh podcasts");
      }
      setRefreshingAll(false);
      setReloadKey((current) => current + 1);
    } catch (caught) {
      if (!mountedRef.current || refreshAllOperationIdRef.current !== operationId) {
        return;
      }

      refreshAllConsecutiveErrorsRef.current += 1;
      if (
        refreshAllConsecutiveErrorsRef.current >=
        REFRESH_ALL_MAX_CONSECUTIVE_ERRORS
      ) {
        setRefreshingAll(false);
        setActionError(getErrorMessage(caught) || "Failed to check refresh status");
        return;
      }

      pollRefreshAllCompletion(operationId);
    }
  }

  async function refreshAllPodcasts() {
    cancelRefreshAllPolling();
    const operationId = refreshAllOperationIdRef.current;
    refreshAllStartTimeRef.current = Date.now();
    refreshAllConsecutiveErrorsRef.current = 0;

    setActionError(null);
    setRefreshingAll(true);

    try {
      await api.podcasts.refreshAll();
      if (mountedRef.current && refreshAllOperationIdRef.current === operationId) {
        pollRefreshAllCompletion(operationId);
      }
    } catch (caught) {
      if (mountedRef.current && refreshAllOperationIdRef.current === operationId) {
        setActionError(getErrorMessage(caught));
        setRefreshingAll(false);
      }
    }
  }

  async function refreshPodcast(podcastId: number) {
    setActionError(null);
    setRefreshingPodcastIds((current) => new Set(current).add(podcastId));

    try {
      await api.podcasts.refresh(podcastId);
      setReloadKey((current) => current + 1);
    } catch (caught) {
      setActionError(getErrorMessage(caught));
    } finally {
      setRefreshingPodcastIds((current) => {
        const next = new Set(current);
        next.delete(podcastId);
        return next;
      });
    }
  }

  async function scheduleUnsubscribePodcast(
    podcast: Pick<Podcast, "id" | "title">
  ) {
    setActionError(null);
    if (pendingUnsubscribePodcastIds.has(podcast.id)) {
      return;
    }

    const exitingIds = [podcast.id];
    await animatePodcastExit(exitingIds);

    scheduleAction({
      kind: "unsubscribe-podcast",
      episodeIds: [],
      podcastId: podcast.id,
      message: `Unsubscribed from "${podcast.title}". Episodes, playlist entries, playback state, and downloads will be removed.`,
      commit: async () => {
        await api.podcasts.remove(podcast.id);
        await reloadQueue();
      },
    });
    clearPodcastExit(exitingIds);
  }

  async function markListened(
    episodes: Array<Pick<Episode, "id" | "title">>,
    isListened: boolean
  ) {
    setActionError(null);
    const episodeIds = new Set(episodes.map((episode) => episode.id));
    const actionableEpisodes = episodes.filter((episode) =>
      episodeIds.has(episode.id)
    );
    if (actionableEpisodes.length === 0) {
      return;
    }

    const previousPodcasts = podcasts;
    const exitingIds =
      isListened && !showAll
        ? podcasts
            .filter((podcast) =>
              podcast.episodes.some((episode) => episodeIds.has(episode.id))
            )
            .filter((podcast) =>
              podcast.episodes.every(
                (episode) => episode.isListened || episodeIds.has(episode.id)
              )
            )
            .map((podcast) => podcast.id)
        : [];

    await animatePodcastExit(exitingIds);

    setPodcasts((current) =>
      current.map((podcast) => ({
        ...podcast,
        episodes: podcast.episodes.map((episode) =>
          episodeIds.has(episode.id)
            ? {
                ...episode,
                isListened,
                inPlaylist: isListened ? false : episode.inPlaylist,
              }
            : episode
        ),
      }))
    );
    clearPodcastExit(exitingIds);

    try {
      for (const episode of actionableEpisodes) {
        await api.episodes.setListened(episode.id, isListened);
      }
      if (isListened) {
        await reloadQueue();
      }
      setReloadKey((current) => current + 1);
    } catch (caught) {
      setPodcasts(previousPodcasts);
      setActionError(getErrorMessage(caught));
    }
  }

  async function markAllListened(podcastId: number) {
    setActionError(null);
    const targetPodcast = podcasts.find((podcast) => podcast.id === podcastId);
    if (!targetPodcast) {
      return;
    }

    const previousPodcasts = podcasts;
    const exitingIds = !showAll ? [podcastId] : [];

    await animatePodcastExit(exitingIds);

    setPodcasts((current) =>
      current.map((podcast) =>
        podcast.id === podcastId
          ? {
              ...podcast,
              episodes: podcast.episodes.map((episode) => ({
                ...episode,
                isListened: true,
                inPlaylist: false,
                downloaded: false,
              })),
            }
          : podcast
      )
    );
    clearPodcastExit(exitingIds);

    try {
      await api.podcasts.markAllListened(podcastId);
      await reloadQueue();
      setReloadKey((current) => current + 1);
    } catch (caught) {
      setPodcasts(previousPodcasts);
      setActionError(getErrorMessage(caught));
    }
  }

  async function removeFromPlaylist(
    episode: Pick<Episode, "id" | "title">
  ) {
    setActionError(null);
    const previousPodcasts = podcasts;
    setPodcasts((current) =>
      current.map((podcast) => ({
        ...podcast,
        episodes: podcast.episodes.map((item) =>
          item.id === episode.id ? { ...item, inPlaylist: false } : item
        ),
      }))
    );

    try {
      await api.playlist.remove(episode.id);
      await reloadQueue();
      setReloadKey((current) => current + 1);
    } catch (caught) {
      setPodcasts(previousPodcasts);
      setActionError(getErrorMessage(caught));
    }
  }

  return {
    actionError,
    exitingPodcastIds,
    markAllListened,
    markListened,
    pendingActions,
    pendingUnsubscribePodcastIds,
    refreshAllPodcasts,
    refreshingAll,
    refreshingPodcastIds,
    refreshPodcast,
    removeFromPlaylist,
    runAction,
    scheduleUnsubscribePodcast,
    setActionError,
    undoAction,
  };
}
