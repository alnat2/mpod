import { useMemo, useState } from "react";

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
import {
  Carousel,
  CarouselContent,
  CarouselItem,
} from "@/components/ui/carousel";
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
import { MobilePodcastColumn } from "./subscriptions-mobile-podcast-column";
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
    visiblePodcasts.find((podcast) =>
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
    setModal("show-notes");
  }

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
                  <Carousel
                    className="h-full w-full overflow-hidden [&_[data-slot=carousel-content]]:h-full [&_[data-slot=carousel-content]]:px-5 [&_[data-slot=carousel-content]]:overflow-visible"
                    opts={{ align: "start", containScroll: "trimSnaps" }}
                  >
                    <CarouselContent className="ml-0 gap-1 h-full">
                      {visiblePodcasts.map((podcast) => {
                        const episodes = podcast.episodes.filter(
                          (episode) => showAll || isVisibleByDefault(episode)
                        );
                        return (
                          <CarouselItem
                            key={podcast.id}
                            className="pl-0 basis-full min-w-[320px] max-w-[340px] h-full"
                          >
                            <MobilePodcastColumn
                              podcast={podcast}
                              visibleEpisodes={episodes}
                              showAll={showAll}
                              podcastCardNode={renderPodcastCard(podcast)}
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
                          </CarouselItem>
                        );
                      })}
                    </CarouselContent>
                  </Carousel>
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
          onClose={() => {
            setModal(null);
            setShowNotesEpisodeId(null);
          }}
        >
          <ShowNotes
            podcastTitle={showNotesPodcast.title}
            episodeTitle={showNotesEpisode.title}
            onClose={() => {
              setModal(null);
              setShowNotesEpisodeId(null);
            }}
          >
            {getEpisodeShowNotes(showNotesEpisode)}
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
