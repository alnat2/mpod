import {
  startTransition,
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";

import { api, type Episode, type SchedulerStatus } from "@/lib/api";
import { checkForAppUpdate } from "@/lib/pwa-update";
import { getCachedScheduler, setCachedScheduler } from "@/lib/screen-cache";
import type { CachedSubscriptionPodcast } from "@/lib/subscriptions-cache";
import {
  retryTransient,
  WAKE_REVALIDATE_AFTER_MS,
} from "@/lib/wake-recovery";

import { getErrorMessage } from "./screen-utils";

type UseSubscriptionsDataOptions = {
  hasLoaded: boolean;
  markLoaded: () => void;
  reloadKey: number;
  setPodcasts: Dispatch<SetStateAction<CachedSubscriptionPodcast[]>>;
  setSelectedPodcastId: Dispatch<SetStateAction<number | null>>;
};

type SubscriptionsPayload = {
  nextPodcasts: CachedSubscriptionPodcast[];
  nextScheduler: SchedulerStatus | null;
};

async function loadSubscriptionsPayload(): Promise<SubscriptionsPayload> {
  const [
    podcastResponse,
    playlistResponse,
    episodeResponse,
    jobsResponse,
  ] = await retryTransient(
    () =>
      Promise.all([
        api.podcasts.list(),
        api.playlist.list(),
        api.episodes.list(),
        api.jobs.status().catch(() => ({ scheduler: null })),
      ]),
    { maxAttempts: 2, delaysMs: [300] }
  );
  const podcastItems = podcastResponse.podcasts ?? [];
  const playlistItems = playlistResponse.items ?? [];
  const episodesByPodcast = new Map<number, Episode[]>();
  for (const episode of episodeResponse.episodes ?? []) {
    const episodes = episodesByPodcast.get(episode.podcastId) ?? [];
    episodes.push(episode);
    episodesByPodcast.set(episode.podcastId, episodes);
  }
  const playlistEpisodeIds = new Set(
    playlistItems.map((item) => item.episodeId)
  );
  const nextPodcasts: CachedSubscriptionPodcast[] = podcastItems.map(
    (podcast) => ({
      ...podcast,
      episodes: (episodesByPodcast.get(podcast.id) ?? []).map((episode) => ({
        ...episode,
        inPlaylist: playlistEpisodeIds.has(episode.id),
      })),
    })
  );

  return {
    nextPodcasts,
    nextScheduler: jobsResponse.scheduler ?? null,
  };
}

export function useSubscriptionsData({
  hasLoaded,
  markLoaded,
  reloadKey,
  setPodcasts,
  setSelectedPodcastId,
}: UseSubscriptionsDataOptions) {
  const [loading, setLoading] = useState(!hasLoaded);
  const [error, setError] = useState<string | null>(null);
  const [scheduler, setScheduler] = useState<SchedulerStatus | null>(() =>
    getCachedScheduler()
  );
  const loadedOnceRef = useRef(hasLoaded);
  const hasErrorRef = useRef(false);
  const lastHiddenAtRef = useRef<number | null>(null);
  const lastLoadedAtRef = useRef<number>(0);
  const mountedRef = useRef(true);
  const inFlightPayloadRef = useRef<Promise<SubscriptionsPayload> | null>(null);

  const getOrStartPayloadFetch = useCallback(() => {
    if (inFlightPayloadRef.current) {
      return inFlightPayloadRef.current;
    }
    const request = loadSubscriptionsPayload().finally(() => {
      if (inFlightPayloadRef.current === request) {
        inFlightPayloadRef.current = null;
      }
    });
    inFlightPayloadRef.current = request;
    return request;
  }, []);

  const applyLoadedPayload = useCallback(
    (
      nextPodcasts: CachedSubscriptionPodcast[],
      nextScheduler: SchedulerStatus | null,
      showLoadingState: boolean
    ) => {
      hasErrorRef.current = false;
      setError(null);
      setCachedScheduler(nextScheduler);
      setScheduler(nextScheduler);
      lastLoadedAtRef.current = Date.now();

      const applySubscriptions = () => {
        setPodcasts(nextPodcasts);
        setSelectedPodcastId((current) =>
          current !== null &&
          nextPodcasts.some((podcast) => podcast.id === current)
            ? current
            : nextPodcasts[0]?.id ?? null
        );
        markLoaded();
      };

      if (showLoadingState) {
        applySubscriptions();
      } else {
        startTransition(applySubscriptions);
      }
      loadedOnceRef.current = true;
    },
    [markLoaded, setPodcasts, setSelectedPodcastId]
  );

  const revalidate = useCallback(async () => {
    hasErrorRef.current = false;
    setError(null);
    const showLoadingState = !loadedOnceRef.current;

    try {
      const { nextPodcasts, nextScheduler } = await getOrStartPayloadFetch();
      if (mountedRef.current) {
        applyLoadedPayload(nextPodcasts, nextScheduler, showLoadingState);
      }
    } catch (caught) {
      if (mountedRef.current) {
        hasErrorRef.current = true;
        setError(getErrorMessage(caught));
      }
    } finally {
      if (mountedRef.current && showLoadingState) {
        setLoading(false);
      }
    }
  }, [applyLoadedPayload, getOrStartPayloadFetch]);

  useEffect(() => {
    mountedRef.current = true;
    if (loadedOnceRef.current && lastLoadedAtRef.current === 0) {
      lastLoadedAtRef.current = Date.now();
    }
    let cancelled = false;

    async function loadSubscriptions() {
      const showLoadingState = !loadedOnceRef.current;
      try {
        const { nextPodcasts, nextScheduler } = await getOrStartPayloadFetch();
        if (!cancelled) {
          applyLoadedPayload(nextPodcasts, nextScheduler, showLoadingState);
        }
      } catch (caught) {
        if (!cancelled) {
          hasErrorRef.current = true;
          setError(getErrorMessage(caught));
        }
      } finally {
        if (!cancelled && showLoadingState) {
          setLoading(false);
        }
      }
    }

    void loadSubscriptions();

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        lastHiddenAtRef.current = Date.now();
        return;
      }

      if (document.visibilityState === "visible" && loadedOnceRef.current) {
        const hiddenDuration =
          lastHiddenAtRef.current !== null
            ? Date.now() - lastHiddenAtRef.current
            : 0;
        const staleDuration = Date.now() - lastLoadedAtRef.current;
        lastHiddenAtRef.current = null;

        if (
          hiddenDuration >= WAKE_REVALIDATE_AFTER_MS ||
          staleDuration >= WAKE_REVALIDATE_AFTER_MS
        ) {
          void checkForAppUpdate();
          void loadSubscriptions();
          return;
        }

        api.jobs
          .status()
          .then((res) => {
            if (!cancelled && res.scheduler) {
              setCachedScheduler(res.scheduler);
              setScheduler(res.scheduler);
            }
          })
          .catch(() => {});
      }
    };

    const handleOnline = () => {
      if (loadedOnceRef.current || hasErrorRef.current) {
        void checkForAppUpdate();
        void loadSubscriptions();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("online", handleOnline);

    return () => {
      mountedRef.current = false;
      cancelled = true;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("online", handleOnline);
    };
  }, [applyLoadedPayload, getOrStartPayloadFetch, reloadKey]);

  return { error, loading, revalidate, scheduler, setError };
}
