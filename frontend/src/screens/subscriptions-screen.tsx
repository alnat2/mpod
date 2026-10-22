import { useEffect, useMemo, useState } from "react";

import { HugeiconsIcon } from "@hugeicons/react";
import {
  Loading02Icon,
  RefreshDotIcon,
  ViewIcon,
  ViewOffIcon,
} from "@hugeicons/core-free-icons";

import {
  AppShell,
  ModalScreen,
  PodcastCard,
  ShowNotes,
} from "@/components/mpod";
import { api } from "@/lib/api";
import { usePlaybackDispatch } from "@/lib/playback-context";
import {
  type CachedSubscriptionPodcast,
  useSubscriptionsCache,
} from "@/lib/subscriptions-cache";
import { useIsMobileViewport } from "@/lib/use-is-mobile-viewport";
import { cn } from "@/lib/utils";

import { AddPodcastModal, type AddPodcastModalMode } from "./add-podcast-modal";
import { SubscriptionsDesktopEpisodeList } from "./subscriptions-desktop-episode-list";
import { SubscriptionsEmptyState } from "./subscriptions-empty-state";
import { SubscriptionsMobileEpisodeList } from "./subscriptions-mobile-episode-list";
import { SubscriptionsMobilePodcastCarousel } from "./subscriptions-mobile-podcast-carousel";
import { SubscriptionsPodcastCarousel } from "./subscriptions-podcast-carousel";
import {
  SubscriptionsPageHeader,
  type SubscriptionsPageAction,
} from "./subscriptions-page-header";
import {
  ErrorBanner,
  ListLoadingState,
  ScreenBannerStack,
  UndoBanner,
} from "./screen-states";
import { getEpisodeShowNotes } from "./screen-utils";
import { useSubscriptionActions } from "./use-subscription-actions";
import { useSubscriptionsData } from "./use-subscriptions-data";

function podcastCountLabel(count: number) {
  return `${count} ${count === 1 ? "podcast" : "podcasts"}`;
}

function subscriptionSummaryLabel(
  podcastCount: number,
  podcastsWithUnlistenedCount: number
) {
  return `${podcastCountLabel(podcastCount)} · ${podcastsWithUnlistenedCount} unlistened`;
}

function isVisibleByDefault(episode: {
  inPlaylist: boolean;
  isListened: boolean;
}) {
  return episode.inPlaylist || !episode.isListened;
}

export function SubscriptionsScreen() {
  const isMobile = useIsMobileViewport();
  const { reloadQueue } = usePlaybackDispatch();
  const {
    hasLoaded,
    markLoaded,
    podcasts,
    selectedPodcastId,
    setPodcasts,
    setSelectedPodcastId,
    setShowAll,
    showAll,
  } = useSubscriptionsCache();
  const [modal, setModal] = useState<AddPodcastModalMode | "show-notes">(null);
  const [showNotesEpisodeId, setShowNotesEpisodeId] = useState<number | null>(null);
  const [showNotesLoading, setShowNotesLoading] = useState(false);
  const [showNotesError, setShowNotesError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const { error, loading, setError } = useSubscriptionsData({
    hasLoaded,
    markLoaded,
    reloadKey,
    setPodcasts,
    setSelectedPodcastId,
  });
  const {
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
  } = useSubscriptionActions({
    podcasts,
    reloadQueue,
    setPodcasts,
    setReloadKey,
    showAll,
  });

  const podcastsWithPending = useMemo(
    () =>
      podcasts.filter(
        (podcast) => !pendingUnsubscribePodcastIds.has(podcast.id)
      ),
    [pendingUnsubscribePodcastIds, podcasts]
  );

  const visiblePodcasts = useMemo(
    () =>
      podcastsWithPending.filter(
        (podcast) =>
          exitingPodcastIds.has(podcast.id) ||
          showAll ||
          podcast.episodes.some(isVisibleByDefault)
      ),
    [exitingPodcastIds, podcastsWithPending, showAll]
  );

  const selectedPodcast =
    visiblePodcasts.find((podcast) => podcast.id === selectedPodcastId) ??
    visiblePodcasts[0];
  const showNotesPodcast =
    podcastsWithPending.find((podcast) =>
      podcast.episodes.some((episode) => episode.id === showNotesEpisodeId)
    ) ?? null;
  const showNotesEpisode =
    showNotesPodcast?.episodes.find(
      (episode) => episode.id === showNotesEpisodeId
    ) ?? null;
  const visibleEpisodes = useMemo(
    () =>
      selectedPodcast?.episodes.filter(
        (episode) => showAll || isVisibleByDefault(episode)
      ) ?? [],
    [selectedPodcast?.episodes, showAll]
  );
  const hasSubscriptions = podcastsWithPending.length > 0;
  const podcastsWithUnlistenedCount = podcastsWithPending.filter((podcast) =>
    podcast.episodes.some((episode) => !episode.isListened)
  ).length;
  const noVisibleUnlistenedPodcasts =
    hasSubscriptions && visiblePodcasts.length === 0;
  const pageTitle = !hasLoaded
    ? "Subscriptions"
    : hasSubscriptions
      ? noVisibleUnlistenedPodcasts
        ? "No unlistened podcasts"
        : "Subscriptions"
      : "No podcasts";
  const pageSubtitle = !hasLoaded
    ? "Loading your podcast library."
    : hasSubscriptions
      ? subscriptionSummaryLabel(
          podcastsWithPending.length,
          podcastsWithUnlistenedCount
        )
      : "Start with one RSS feed or import subscriptions from another app.";
  const pageActions: SubscriptionsPageAction[] = hasSubscriptions
    ? [
        {
          label: "Refresh all",
          icon: (
            <HugeiconsIcon
              icon={refreshingAll ? Loading02Icon : RefreshDotIcon}
              className={refreshingAll ? "animate-spin" : undefined}
              data-icon="inline-start"
            />
          ),
          disabled: refreshingAll,
          variant: "secondary" as const,
          onClick: () => void refreshAllPodcasts(),
        },
        {
          label: showAll ? "Show unlistened" : "Show all",
          icon: (
            <HugeiconsIcon
              icon={showAll ? ViewOffIcon : ViewIcon}
              data-icon="inline-start"
            />
          ),
          variant: "default" as const,
          onClick: () => setShowAll((current) => !current),
        },
      ]
    : [];

  function showEpisodeNotes(episodeId: number) {
    setShowNotesEpisodeId(episodeId);
    setShowNotesError(false);
    const existingEpisode = podcastsWithPending
      .flatMap((podcast) => podcast.episodes)
      .find((episode) => episode.id === episodeId);
    const hasNotes =
      existingEpisode &&
      (existingEpisode.showNotes !== undefined ||
        existingEpisode.description !== undefined);
    setShowNotesLoading(!hasNotes);
    setModal("show-notes");
  }

  function closeShowNotes() {
    setModal(null);
    setShowNotesEpisodeId(null);
    setShowNotesLoading(false);
    setShowNotesError(false);
  }

  useEffect(() => {
    if (modal !== "show-notes" || showNotesEpisodeId == null) {
      return;
    }

    if (
      !showNotesEpisode ||
      showNotesEpisode.showNotes !== undefined ||
      showNotesEpisode.description !== undefined ||
      showNotesError
    ) {
      setShowNotesLoading(false);
      return;
    }

    let cancelled = false;

    api.episodes
      .get(showNotesEpisodeId)
      .then((response) => {
        if (cancelled) {
          return;
        }
        const fullEpisode = response.episode;
        setPodcasts((currentPodcasts) =>
          currentPodcasts.map((podcast) =>
            podcast.id === fullEpisode.podcastId
              ? {
                  ...podcast,
                  episodes: podcast.episodes.map((ep) =>
                    ep.id === fullEpisode.id
                      ? {
                          ...ep,
                          showNotes: fullEpisode.showNotes ?? null,
                          description: fullEpisode.description ?? null,
                        }
                      : ep
                  ),
                }
              : podcast
          )
        );
      })
      .catch(() => {
        if (!cancelled) {
          setShowNotesError(true);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setShowNotesLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [modal, setPodcasts, showNotesEpisode, showNotesEpisodeId, showNotesError]);

  function renderPodcastCard(podcast: CachedSubscriptionPodcast) {
    return (
      <PodcastCard
        selected={podcast.id === selectedPodcast?.id}
        title={podcast.title}
        description={podcast.description ?? podcast.rssUrl}
        artworkUrl={
          podcast.imageUrl ? api.podcasts.imagePath(podcast.id) : undefined
        }
        artworkAlt={`${podcast.title} artwork`}
        refreshing={refreshingPodcastIds.has(podcast.id)}
        onSelect={() => setSelectedPodcastId(podcast.id)}
        onRefresh={() => void refreshPodcast(podcast.id)}
        onUnsubscribe={() => void scheduleUnsubscribePodcast(podcast)}
        className={cn(
          "transition-[opacity,transform] duration-200 ease-out motion-reduce:transition-none",
          exitingPodcastIds.has(podcast.id) &&
            "pointer-events-none scale-[0.98] opacity-0"
        )}
      />
    );
  }

  return (
    <>
      <AppShell
        activeNavItem="Subscriptions"
        onAddPodcast={() => setModal("rss")}
        pageTitle={pageTitle}
        pageSubtitle={pageSubtitle}
        pageActions={[]}
        pageHeaderVisible={false}
        className="px-0 md:px-6 xl:px-20"
      >
        <div className="flex h-full min-h-0 w-full max-w-full min-w-0 flex-col overflow-hidden bg-background md:rounded-md md:border md:border-border md:bg-card md:px-10 md:py-5">
          <SubscriptionsPageHeader
            isMobile={isMobile}
            title={pageTitle}
            subtitle={pageSubtitle}
            actions={pageActions}
          />
          <div className="px-5 md:px-0">
            <ScreenBannerStack>
              {error ? (
                <ErrorBanner onClose={() => setError(null)}>{error}</ErrorBanner>
              ) : null}
              {actionError ? (
                <ErrorBanner onClose={() => setActionError(null)}>
                  {actionError}
                </ErrorBanner>
              ) : null}
              {pendingActions.map((action) => (
                <UndoBanner
                  key={action.id}
                  expiresAt={action.expiresAt}
                  message={action.message}
                  onUndo={() => undoAction(action.id)}
                />
              ))}
            </ScreenBannerStack>
          </div>
          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden pt-4 md:py-6">
            {loading ? (
              <div className="px-5 md:px-0">
                <ListLoadingState label="Loading subscriptions" />
              </div>
            ) : visiblePodcasts.length > 0 ? (
              <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col gap-4 md:gap-6">
                {isMobile ? (
                  selectedPodcast ? (
                    <>
                      <SubscriptionsMobilePodcastCarousel
                        podcasts={visiblePodcasts}
                        selectedPodcastId={selectedPodcast.id}
                        onSelectPodcast={(id) => setSelectedPodcastId(id)}
                        onRefreshPodcast={(id) => void refreshPodcast(id)}
                        onUnsubscribePodcast={(podcast) =>
                          void scheduleUnsubscribePodcast(podcast)
                        }
                        refreshingPodcastIds={refreshingPodcastIds}
                        exitingPodcastIds={exitingPodcastIds}
                      />
                      <SubscriptionsMobileEpisodeList
                        key={`${selectedPodcast.id}-${showAll ? "all" : "unlistened"}`}
                        podcast={selectedPodcast}
                        visibleEpisodes={visibleEpisodes}
                        onMarkAllListened={(podcastId) =>
                          void markAllListened(podcastId)
                        }
                        onMarkListened={(items, isListened) =>
                          void markListened(items, isListened)
                        }
                        onRemoveFromPlaylist={(episode) =>
                          void removeFromPlaylist(episode)
                        }
                        onAddToPlaylist={(id) =>
                          void runAction(() => api.playlist.add(id))
                        }
                        onShowNotes={showEpisodeNotes}
                      />
                    </>
                  ) : null
                ) : selectedPodcast ? (
                  <>
                    <SubscriptionsPodcastCarousel
                      podcasts={visiblePodcasts}
                      renderPodcastCard={renderPodcastCard}
                    />
                    <SubscriptionsDesktopEpisodeList
                      key={`${selectedPodcast.id}-${showAll ? "all" : "unlistened"}`}
                      podcast={selectedPodcast}
                      visibleEpisodes={visibleEpisodes}
                      onMarkAllListened={(podcastId) =>
                        void markAllListened(podcastId)
                      }
                      onMarkListened={(items, isListened) =>
                        void markListened(items, isListened)
                      }
                      onRemoveFromPlaylist={(episode) =>
                        void removeFromPlaylist(episode)
                      }
                      onAddToPlaylist={(id) =>
                        void runAction(() => api.playlist.add(id))
                      }
                      onShowNotes={showEpisodeNotes}
                    />
                  </>
                ) : null}
              </div>
            ) : (
              <div className="px-5 md:px-0 h-full flex flex-col">
                <SubscriptionsEmptyState
                  title={hasSubscriptions ? "All caught up" : "No podcasts yet"}
                  description={
                    hasSubscriptions
                      ? "There are no unlistened episodes right now. Add another feed, import OPML, or use Show all to browse listened episodes."
                      : "Add one RSS feed or bring subscriptions from another podcast app with OPML."
                  }
                  onAddRss={() => setModal("rss")}
                  onImportOpml={() => setModal("opml")}
                />
              </div>
            )}
          </div>
        </div>
      </AppShell>
      {modal === "show-notes" && showNotesEpisode && showNotesPodcast ? (
        <ModalScreen
          title="Show notes"
          onClose={closeShowNotes}
        >
          <ShowNotes
            podcastTitle={showNotesPodcast.title}
            episodeTitle={showNotesEpisode.title}
            onClose={closeShowNotes}
          >
            {showNotesLoading
              ? "Loading show notes..."
              : showNotesError
                ? "Failed to load show notes."
                : getEpisodeShowNotes(showNotesEpisode)}
          </ShowNotes>
        </ModalScreen>
      ) : null}
      <AddPodcastModal
        mode={modal === "show-notes" ? null : modal}
        onClose={() => setModal(null)}
        onComplete={() => setReloadKey((current) => current + 1)}
        onModeChange={setModal}
      />
    </>
  );
}
