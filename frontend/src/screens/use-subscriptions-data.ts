import {
  startTransition,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";

import { api, type Episode, type SchedulerStatus } from "@/lib/api";
import { getCachedScheduler, setCachedScheduler } from "@/lib/screen-cache";
import type { CachedSubscriptionPodcast } from "@/lib/subscriptions-cache";

import { getErrorMessage } from "./screen-utils";

type UseSubscriptionsDataOptions = {
  hasLoaded: boolean;
  markLoaded: () => void;
  reloadKey: number;
  setPodcasts: Dispatch<SetStateAction<CachedSubscriptionPodcast[]>>;
  setSelectedPodcastId: Dispatch<SetStateAction<number | null>>;
};

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

  useEffect(() => {
    let cancelled = false;

    async function loadSubscriptions() {
      const showLoadingState = !loadedOnceRef.current;
      if (showLoadingState) {
        setLoading(true);
      }
      setError(null);

      try {
        const [
          podcastResponse,
          playlistResponse,
          episodeResponse,
          jobsResponse,
        ] = await Promise.all([
          api.podcasts.list(),
          api.playlist.list(),
          api.episodes.list(),
          api.jobs.status().catch(() => ({ scheduler: null })),
        ]);
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
            episodes: (episodesByPodcast.get(podcast.id) ?? []).map(
              (episode) => ({
                ...episode,
                inPlaylist: playlistEpisodeIds.has(episode.id),
              })
            ),
          })
        );

        if (!cancelled) {
          const nextScheduler = jobsResponse.scheduler ?? null;
          setCachedScheduler(nextScheduler);
          setScheduler(nextScheduler);

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
        }
      } catch (caught) {
        if (!cancelled) {
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
      if (document.visibilityState === "visible" && loadedOnceRef.current) {
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
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [markLoaded, reloadKey, setPodcasts, setSelectedPodcastId]);

  return { error, loading, scheduler, setError };
}
