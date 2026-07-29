import { startTransition, useEffect, useMemo, useRef, useState } from "react";

import { HugeiconsIcon } from "@hugeicons/react";
import {
  DownloadSquare01Icon,
  DownloadSquare02Icon,
  Loading02Icon,
  NoteIcon,
  PlayListAddIcon,
  PlayListRemoveIcon,
  RefreshDotIcon,
  ViewIcon,
  ViewOffIcon,
} from "@hugeicons/core-free-icons";

import {
  AppShell,
  EpisodeRow,
  ModalScreen,
  PlaylistQueue,
  PodcastCard,
  ShowNotes,
} from "@/components/mpod";
import { Button } from "@/components/ui/button";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
} from "@/components/ui/carousel";
import { api, type Episode, type Podcast } from "@/lib/api";
import { usePlaybackDispatch } from "@/lib/playback-context";
import {
  type CachedSubscriptionPodcast,
  useSubscriptionsCache,
} from "@/lib/subscriptions-cache";
import { useIsMobileViewport } from "@/lib/use-is-mobile-viewport";

import { AddPodcastModal, type AddPodcastModalMode } from "./add-podcast-modal";
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
} from "./screen-states";
import { UndoBanner } from "./screen-states";
import {
  formatDuration,
  formatEpisodeDate,
  getErrorMessage,
  getEpisodeShowNotes,
} from "./screen-utils";
import { useAudioMetadataDurations } from "./use-audio-metadata-durations";
import { useDelayedActions } from "./use-delayed-actions";
import { cn } from "@/lib/utils";

const EPISODE_ROW_HEIGHT = 70;
const MOBILE_EPISODE_ROW_HEIGHT = 76;
const EPISODE_ROW_GAP = 4;
const EPISODE_OVERSCAN_ROWS = 4;
const DEFAULT_EPISODE_VIEWPORT_HEIGHT = 350;
const MOBILE_EPISODE_VIEWPORT_HEIGHT = 152;
const PODCAST_EXIT_ANIMATION_MS = 220;
const REFRESH_ALL_STATUS_POLL_MS = 3000;

function podcastCountLabel(count: number) {
  return `${count} ${count === 1 ? "podcast" : "podcasts"}`;
}

function episodeSummaryLabel(totalCount: number, unlistenedCount: number) {
  return `${totalCount} / ${unlistenedCount} episodes`;
}

function isVisibleByDefault(episode: { inPlaylist: boolean; isListened: boolean }) {
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
  const [downloadingEpisodeIds, setDownloadingEpisodeIds] = useState<Set<number>>(
    () => new Set()
  );
  const [refreshingPodcastIds, setRefreshingPodcastIds] = useState<Set<number>>(
    () => new Set()
  );
  const [refreshingAll, setRefreshingAll] = useState(false);
  const [loading, setLoading] = useState(!hasLoaded);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [episodeScrollTop, setEpisodeScrollTop] = useState(0);
  const [exitingPodcastIds, setExitingPodcastIds] = useState<Set<number>>(
    () => new Set()
  );
  const [episodeViewportHeight, setEpisodeViewportHeight] = useState(
    DEFAULT_EPISODE_VIEWPORT_HEIGHT
  );
  const episodeListRef = useRef<HTMLDivElement | null>(null);
  const loadedOnceRef = useRef(hasLoaded);
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
    let cancelled = false;

    async function loadSubscriptions() {
      const showLoadingState = !loadedOnceRef.current;
      if (showLoadingState) {
        setLoading(true);
      }
      setError(null);

      try {
        const [podcastResponse, playlistResponse, episodeResponse] =
          await Promise.all([
            api.podcasts.list(),
            api.playlist.list(),
            api.episodes.list(),
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

    return () => {
      cancelled = true;
    };
  }, [markLoaded, reloadKey, setPodcasts, setSelectedPodcastId]);

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

  const podcastsWithPending = useMemo(
    () =>
      podcasts
        .filter((podcast) => !pendingUnsubscribePodcastIds.has(podcast.id)),
    [pendingUnsubscribePodcastIds, podcasts]
  );

  const visiblePodcasts = useMemo(
    () =>
      podcastsWithPending.filter(
        (podcast) =>
          exitingPodcastIds.has(podcast.id) ||
          showAll ||
          podcast.episodes.some(
            isVisibleByDefault
          )
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
    showNotesPodcast?.episodes.find((episode) => episode.id === showNotesEpisodeId) ??
    null;

  const visibleEpisodes = useMemo(
    () =>
      selectedPodcast?.episodes.filter(
        (episode) =>
          (showAll || isVisibleByDefault(episode))
      ) ?? [],
    [selectedPodcast?.episodes, showAll]
  );

  useEffect(() => {
    const container = episodeListRef.current;
    if (!container) {
      return;
    }

    const syncMetrics = () => {
      setEpisodeViewportHeight(
        container.clientHeight ||
          (isMobile
            ? MOBILE_EPISODE_VIEWPORT_HEIGHT
            : DEFAULT_EPISODE_VIEWPORT_HEIGHT)
      );
      setEpisodeScrollTop(container.scrollTop);
    };

    syncMetrics();

    if (typeof ResizeObserver === "undefined") {
      return;
    }

    const observer = new ResizeObserver(syncMetrics);
    observer.observe(container);

    return () => observer.disconnect();
  }, [isMobile, selectedPodcast?.id, showAll, visibleEpisodes.length]);

  const episodeRowHeight = isMobile ? MOBILE_EPISODE_ROW_HEIGHT : EPISODE_ROW_HEIGHT;
  const episodeRowPitch = episodeRowHeight + EPISODE_ROW_GAP;

  const virtualEpisodeWindow = useMemo(() => {
    const startIndex = Math.max(
      0,
      Math.floor(episodeScrollTop / episodeRowPitch) - EPISODE_OVERSCAN_ROWS
    );
    const visibleRowCount =
      Math.ceil(episodeViewportHeight / episodeRowPitch) +
      EPISODE_OVERSCAN_ROWS * 2;
    const endIndex = Math.min(
      visibleEpisodes.length,
      startIndex + visibleRowCount
    );

    return {
      startIndex,
      endIndex,
      items: visibleEpisodes.slice(startIndex, endIndex),
      topSpacerHeight: startIndex * episodeRowPitch,
      bottomSpacerHeight:
        (visibleEpisodes.length - endIndex) * episodeRowPitch,
    };
  }, [episodeRowPitch, episodeScrollTop, episodeViewportHeight, visibleEpisodes]);
  const durationForEpisode = useAudioMetadataDurations(virtualEpisodeWindow.items);
  const hasSubscriptions = podcastsWithPending.length > 0;
  const noVisibleUnlistenedPodcasts = hasSubscriptions && visiblePodcasts.length === 0;
  const selectedPodcastTotalEpisodeCount = selectedPodcast?.episodes.length ?? 0;
  const selectedPodcastUnlistenedEpisodeCount =
    selectedPodcast?.episodes.filter((episode) => !episode.isListened).length ?? 0;
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
      ? podcastCountLabel(podcastsWithPending.length)
      : "Start with one RSS feed or import subscriptions from another app.";
  const pageActions: SubscriptionsPageAction[] =
    hasSubscriptions
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
            icon: <HugeiconsIcon icon={showAll ? ViewOffIcon : ViewIcon} data-icon="inline-start" />,
            variant: "default" as const,
            onClick: () => {
              setEpisodeScrollTop(0);
              setShowAll((current) => !current);
            },
          },
        ]
      : [];

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

  function shouldReduceMotion() {
    return (
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    );
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

  async function downloadFromSubscription(episodeId: number) {
    setActionError(null);
    setDownloadingEpisodeIds((current) => new Set(current).add(episodeId));

    try {
      await api.episodes.download(episodeId);
      setPodcasts((current) =>
        current.map((podcast) => ({
          ...podcast,
          episodes: podcast.episodes.map((episode) =>
            episode.id === episodeId
              ? { ...episode, downloaded: true }
              : episode
          ),
        }))
      );
      setReloadKey((current) => current + 1);
    } catch (caught) {
      setActionError(getErrorMessage(caught));
    } finally {
      setDownloadingEpisodeIds((current) => {
        const next = new Set(current);
        next.delete(episodeId);
        return next;
      });
    }
  }

  async function scheduleUnsubscribePodcast(podcast: Pick<Podcast, "id" | "title">) {
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
    const actionableEpisodes = episodes.filter((episode) => episodeIds.has(episode.id));
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
        onSelect={() => {
          setEpisodeScrollTop(0);
          setSelectedPodcastId(podcast.id);
        }}
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
          {isMobile ? (
            <SubscriptionsPageHeader
              isMobile
              title={pageTitle}
              subtitle={pageSubtitle}
              actions={pageActions}
            />
          ) : (
            <SubscriptionsPageHeader
              isMobile={false}
              title={pageTitle}
              subtitle={pageSubtitle}
              actions={pageActions}
            />
          )}
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
                    opts={{
                      align: "start",
                      containScroll: "trimSnaps",
                    }}
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
                              downloadingEpisodeIds={downloadingEpisodeIds}
                              podcastCardNode={renderPodcastCard(podcast)}
                              onMarkListened={(eps, isListened) => void markListened(eps, isListened)}
                              onDownload={(id) => void downloadFromSubscription(id)}
                              onRemoveFromPlaylist={(ep) => void removeFromPlaylist(ep)}
                              onAddToPlaylist={(id) => void runAction(() => api.playlist.add(id))}
                              onShowNotes={(id) => {
                                setShowNotesEpisodeId(id);
                                setModal("show-notes");
                              }}
                            />
                          </CarouselItem>
                        );
                      })}
                    </CarouselContent>
                  </Carousel>
                ) : (
                  <>
                    <SubscriptionsPodcastCarousel
                      podcasts={visiblePodcasts}
                      renderPodcastCard={renderPodcastCard}
                    />
                    <PlaylistQueue
                      key={`${selectedPodcast.id}-${showAll ? "all" : "unlistened"}`}
                      className="min-h-0 w-full flex-1"
                      bodyClassName="mpod-scroll block min-h-0 flex-1 overflow-y-auto pb-20 md:max-h-none md:pb-0"
                      bodyRef={episodeListRef}
                      bodyOnScroll={(event) =>
                        setEpisodeScrollTop(event.currentTarget.scrollTop)
                      }
                      summary={episodeSummaryLabel(
                        selectedPodcastTotalEpisodeCount,
                        selectedPodcastUnlistenedEpisodeCount
                      )}
                      headerAction={
                        <>
                          {visibleEpisodes.some((episode) => !episode.isListened) && (
                            <Button
                              variant="link"
                              type="button"
                              className="h-auto whitespace-normal py-1 text-right leading-tight"
                              onClick={() =>
                                void markListened(
                                  visibleEpisodes.filter((episode) => !episode.isListened),
                                  true
                                )
                              }
                            >
                              Mark all listened
                            </Button>
                          )}
                        </>
                      }
                    >
                      {virtualEpisodeWindow.topSpacerHeight > 0 ? (
                        <div
                          aria-hidden="true"
                          className="shrink-0"
                          style={{ height: virtualEpisodeWindow.topSpacerHeight }}
                        />
                      ) : null}
                      {virtualEpisodeWindow.items.map((episode) => {
                        const duration = formatDuration(durationForEpisode(episode));
                        const publishedAt = formatEpisodeDate(episode.publishedAt);
                        const downloading = downloadingEpisodeIds.has(episode.id);
                        const subtitle = episode.downloaded
                          ? episode.inPlaylist
                            ? "Downloaded · In playlist"
                            : "Downloaded"
                          : episode.inPlaylist
                            ? "In playlist"
                            : undefined;
                        const downloadAction = {
                          label: downloading
                            ? "Downloading"
                            : episode.downloaded
                              ? "Downloaded"
                              : "Download",
                          icon: downloading
                            ? Loading02Icon
                            : episode.downloaded
                              ? DownloadSquare02Icon
                              : DownloadSquare01Icon,
                          iconClassName: downloading
                            ? "animate-spin"
                            : episode.downloaded
                              ? "text-muted-foreground"
                              : undefined,
                          disabled: downloading,
                          onClick:
                            episode.downloaded || downloading
                              ? undefined
                              : () => void downloadFromSubscription(episode.id),
                        };
                        const playlistAction = {
                          label: episode.inPlaylist
                            ? "Remove from playlist"
                            : "Add to playlist",
                          icon: episode.inPlaylist
                            ? PlayListRemoveIcon
                            : PlayListAddIcon,
                          onClick: () =>
                            episode.inPlaylist
                              ? void removeFromPlaylist(episode)
                              : void runAction(() => api.playlist.add(episode.id)),
                        };
                        const notesAction = {
                          label: "Show notes",
                          icon: NoteIcon,
                          onClick: () => {
                            setShowNotesEpisodeId(episode.id);
                            setModal("show-notes");
                          },
                        };
                        const listenedAction = {
                          label: episode.isListened
                            ? "Mark as unlistened"
                            : "Mark as listened",
                          icon: episode.isListened ? ViewOffIcon : ViewIcon,
                          onClick: () =>
                            episode.isListened
                              ? void markListened([episode], false)
                              : void markListened([episode], true),
                        };

                        return (
                          <div
                            key={episode.id}
                            className="shrink-0"
                            style={{ height: episodeRowPitch }}
                          >
                            <EpisodeRow
                              layout={isMobile ? "mobile" : "desktop"}
                              title={episode.title}
                              podcastTitle={selectedPodcast.title}
                              subtitle={subtitle}
                              dateLabel={publishedAt || undefined}
                              durationLabel={duration || undefined}
                              thumbnailUrl={
                                selectedPodcast.imageUrl
                                  ? api.podcasts.imagePath(selectedPodcast.id)
                                  : undefined
                              }
                              thumbnailAlt={`${selectedPodcast.title} artwork`}
                              actions={[
                                downloadAction,
                                playlistAction,
                                notesAction,
                                listenedAction,
                              ]}
                              mobileActions={[
                                playlistAction,
                                notesAction,
                                downloadAction,
                                listenedAction,
                              ]}
                            />
                          </div>
                        );
                      })}
                      {virtualEpisodeWindow.bottomSpacerHeight > 0 ? (
                        <div
                          aria-hidden="true"
                          className="shrink-0"
                          style={{ height: virtualEpisodeWindow.bottomSpacerHeight }}
                        />
                      ) : null}
                    </PlaylistQueue>
                  </>
                )}
              </div>
            ) : (
              <div className="px-5 md:px-0 h-full flex flex-col">
                <SubscriptionsEmptyState
                  title={
                    hasSubscriptions
                      ? "All caught up"
                      : "No podcasts yet"
                  }
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
