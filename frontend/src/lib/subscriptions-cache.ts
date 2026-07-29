import {
  createContext,
  useContext,
  type Dispatch,
  type SetStateAction,
} from "react";

import type { Episode, Podcast } from "@/lib/api";

export type CachedSubscriptionEpisode = Episode & {
  inPlaylist: boolean;
};

export type CachedSubscriptionPodcast = Podcast & {
  episodes: CachedSubscriptionEpisode[];
};

export type SubscriptionsCacheContextValue = {
  hasLoaded: boolean;
  markLoaded: () => void;
  podcasts: CachedSubscriptionPodcast[];
  selectedPodcastId: number | null;
  setPodcasts: Dispatch<SetStateAction<CachedSubscriptionPodcast[]>>;
  setSelectedPodcastId: Dispatch<SetStateAction<number | null>>;
  setShowAll: Dispatch<SetStateAction<boolean>>;
  showAll: boolean;
};

export const SubscriptionsCacheContext =
  createContext<SubscriptionsCacheContextValue | null>(null);

export function useSubscriptionsCache() {
  const context = useContext(SubscriptionsCacheContext);

  if (!context) {
    throw new Error(
      "useSubscriptionsCache must be used within SubscriptionsCacheProvider"
    );
  }

  return context;
}
