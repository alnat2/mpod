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

const PODCAST_EXIT_ANIMATION_MS = 220;
const REFRESH_ALL_STATUS_POLL_MS = 3000;

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
  const mountedRef = useRef(true);
  const { pendingActions, scheduleAction, undoAction } = useDelayedActions({
    onCommitted: () => setReloadKey((current) => current + 1),
    onError: (caught) => setActionError(getErrorMessage(caught)),
  });

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      if (refreshAllStatusTimeoutRef.current !== null) {
        clearTimeout(refreshAllStatusTimeoutRef.current);
      }
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

  function pollRefreshAllCompletion() {
    if (refreshAllStatusTimeoutRef.current !== null) {
      clearTimeout(refreshAllStatusTimeoutRef.current);
    }

    refreshAllStatusTimeoutRef.current = setTimeout(() => {
      void refreshAfterRefreshAllCompletes();
    }, REFRESH_ALL_STATUS_POLL_MS);
  }

  async function refreshAfterRefreshAllCompletes() {
    refreshAllStatusTimeoutRef.current = null;

    try {
      const { scheduler } = await api.jobs.status();
      if (!mountedRef.current) {
        return;
      }
      if (scheduler.state === "running") {
        pollRefreshAllCompletion();
        return;
      }
      if (scheduler.state === "failed") {
        setActionError(scheduler.lastError ?? "Failed to refresh podcasts");
      }
      setRefreshingAll(false);
      setReloadKey((current) => current + 1);
    } catch {
      if (mountedRef.current) {
        pollRefreshAllCompletion();
      }
    }
  }

  async function refreshAllPodcasts() {
    setActionError(null);
    setRefreshingAll(true);

    try {
      await api.podcasts.refreshAll();
      pollRefreshAllCompletion();
    } catch (caught) {
      setActionError(getErrorMessage(caught));
      setRefreshingAll(false);
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
