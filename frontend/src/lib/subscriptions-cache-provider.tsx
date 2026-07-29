import {
  useCallback,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import {
  SubscriptionsCacheContext,
  type CachedSubscriptionPodcast,
  type SubscriptionsCacheContextValue,
} from "@/lib/subscriptions-cache";

export function SubscriptionsCacheProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [podcasts, setPodcasts] = useState<CachedSubscriptionPodcast[]>([]);
  const [selectedPodcastId, setSelectedPodcastId] = useState<number | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const markLoaded = useCallback(() => setHasLoaded(true), []);

  const value = useMemo<SubscriptionsCacheContextValue>(
    () => ({
      hasLoaded,
      markLoaded,
      podcasts,
      selectedPodcastId,
      setPodcasts,
      setSelectedPodcastId,
      setShowAll,
      showAll,
    }),
    [hasLoaded, markLoaded, podcasts, selectedPodcastId, showAll]
  );

  return (
    <SubscriptionsCacheContext.Provider value={value}>
      {children}
    </SubscriptionsCacheContext.Provider>
  );
}
