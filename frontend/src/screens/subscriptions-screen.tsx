import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { HugeiconsIcon } from "@hugeicons/react";
import {
  DownloadSquare01Icon,
  DownloadSquare02Icon,
  Loading02Icon,
  NoteIcon,
  PodcastIcon,
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
  PageHeader,
  PlaylistQueue,
  PodcastCard,
  ShowNotes,
} from "@/components/mpod";
import { Button } from "@/components/ui/button";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "@/components/ui/carousel";
import { api, type Episode, type Podcast } from "@/lib/api";
import { usePlaybackDispatch } from "@/lib/playback-context";
import { useIsMobileViewport } from "@/lib/use-is-mobile-viewport";

import { AddPodcastModal, type AddPodcastModalMode } from "./add-podcast-modal";
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

type PodcastWithEpisodes = Podcast & {
  episodes: Array<Episode & { inPlaylist: boolean }>;
};

const EPISODE_ROW_HEIGHT = 70;
const MOBILE_EPISODE_ROW_HEIGHT = 76;
const EPISODE_ROW_GAP = 4;
const EPISODE_OVERSCAN_ROWS = 4;
const DEFAULT_EPISODE_VIEWPORT_HEIGHT = 350;
const MOBILE_EPISODE_VIEWPORT_HEIGHT = 152;
const PODCAST_EXIT_ANIMATION_MS = 220;

function podcastCountLabel(count: number) {
  return `${count} ${count === 1 ? "podcast" : "podcasts"}`;
}

function episodeSummaryLabel(totalCount: number, unlistenedCount: number) {
  return `${totalCount} / ${unlistenedCount} episodes`;
}

type MobilePodcastColumnProps = {
  podcast: PodcastWithEpisodes;
  visibleEpisodes: Array<Episode & { inPlaylist: boolean }>;
  showAll: boolean;
  downloadingEpisodeIds: Set<number>;
  podcastCardNode: ReactNode;
  onMarkListened: (episodes: Array<Pick<Episode, "id" | "title">>, isListened: boolean) => void;
  onDownload: (episodeId: number) => void;
  onRemoveFromPlaylist: (episode: Pick<Episode, "id" | "title">) => void;
  onAddToPlaylist: (episodeId: number) => void;
  onShowNotes: (episodeId: number) => void;
};

function MobilePodcastColumn({
  podcast,
  visibleEpisodes,
  showAll,
  downloadingEpisodeIds,
  podcastCardNode,
  onMarkListened,
  onDownload,
  onRemoveFromPlaylist,
  onAddToPlaylist,
  onShowNotes,
}: MobilePodcastColumnProps) {
  const [isVisible, setIsVisible] = useState(false);
  const columnRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        setIsVisible(entry.isIntersecting);
      },
      { rootMargin: "100% 0px" }
    );
    if (columnRef.current) observer.observe(columnRef.current);
    return () => observer.disconnect();
  }, []);

  const [episodeScrollTop, setEpisodeScrollTop] = useState(0);
  const [episodeViewportHeight, setEpisodeViewportHeight] = useState(MOBILE_EPISODE_VIEWPORT_HEIGHT);
  const episodeListRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isVisible) return;
    const container = episodeListRef.current;
    if (!container) return;
    const syncMetrics = () => {
      setEpisodeViewportHeight(container.clientHeight || MOBILE_EPISODE_VIEWPORT_HEIGHT);
      setEpisodeScrollTop(container.scrollTop);
    };
    syncMetrics();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(syncMetrics);
    observer.observe(container);
    return () => observer.disconnect();
  }, [isVisible, showAll, visibleEpisodes.length]);

  const episodeRowHeight = MOBILE_EPISODE_ROW_HEIGHT;
  const episodeRowPitch = episodeRowHeight + EPISODE_ROW_GAP;

  const virtualEpisodeWindow = useMemo(() => {
    const startIndex = Math.max(0, Math.floor(episodeScrollTop / episodeRowPitch) - EPISODE_OVERSCAN_ROWS);
    const visibleRowCount = Math.ceil(episodeViewportHeight / episodeRowPitch) + EPISODE_OVERSCAN_ROWS * 2;
    const endIndex = Math.min(visibleEpisodes.length, startIndex + visibleRowCount);
    return {
      startIndex,
      endIndex,
      items: visibleEpisodes.slice(startIndex, endIndex),
      topSpacerHeight: startIndex * episodeRowPitch,
      bottomSpacerHeight: (visibleEpisodes.length - endIndex) * episodeRowPitch,
    };
  }, [episodeRowPitch, episodeScrollTop, episodeViewportHeight, visibleEpisodes]);

  const durationForEpisode = useAudioMetadataDurations(virtualEpisodeWindow.items);

  const podcastTotalEpisodeCount = podcast.episodes.length;
  const podcastUnlistenedEpisodeCount = podcast.episodes.filter((episode) => !episode.isListened).length;

  return (
    <div ref={columnRef} className="flex h-full flex-col gap-4">
      <div className="shrink-0">{podcastCardNode}</div>
      {isVisible ? (
        <PlaylistQueue
          className="min-h-0 w-full flex-1"
          bodyClassName="mpod-scroll block min-h-0 flex-1 overflow-y-auto pb-20"
          bodyRef={episodeListRef}
        bodyOnScroll={(event) => setEpisodeScrollTop(event.currentTarget.scrollTop)}
        summary={episodeSummaryLabel(podcastTotalEpisodeCount, podcastUnlistenedEpisodeCount)}
        headerAction={
          <>
            {visibleEpisodes.some((episode) => !episode.isListened) && (
              <Button
                variant="link"
                type="button"
                className="h-auto whitespace-normal py-1 text-right leading-tight"
                onClick={() => onMarkListened(visibleEpisodes.filter((episode) => !episode.isListened), true)}
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

          return (
            <div
              key={episode.id}
              className="shrink-0"
              style={{ height: episodeRowPitch }}
            >
              <EpisodeRow
                layout="mobile"
                showDragHandle
                title={episode.title}
                subtitle={subtitle}
                dateLabel={publishedAt || undefined}
                durationLabel={duration || undefined}
                thumbnailUrl={podcast.imageUrl ? api.podcasts.imagePath(podcast.id) : undefined}
                thumbnailAlt={`${podcast.title} artwork`}
                actions={[
                  {
                    label: downloading ? "Downloading" : episode.downloaded ? "Downloaded" : "Download",
                    icon: downloading ? Loading02Icon : episode.downloaded ? DownloadSquare02Icon : DownloadSquare01Icon,
                    iconClassName: downloading ? "animate-spin" : episode.downloaded ? "text-muted-foreground" : undefined,
                    disabled: downloading,
                    onClick: episode.downloaded || downloading ? undefined : () => onDownload(episode.id),
                  },
                  {
                    label: episode.inPlaylist ? "Remove from playlist" : "Add to playlist",
                    icon: episode.inPlaylist ? PlayListRemoveIcon : PlayListAddIcon,
                    onClick: () => (episode.inPlaylist ? onRemoveFromPlaylist(episode) : onAddToPlaylist(episode.id)),
                  },
                  {
                    label: "Show notes",
                    icon: NoteIcon,
                    onClick: () => onShowNotes(episode.id),
                  },
                  {
                    label: episode.isListened ? "Mark as unlistened" : "Mark as listened",
                    icon: episode.isListened ? ViewOffIcon : ViewIcon,
                    onClick: () => onMarkListened([episode], !episode.isListened),
                  },
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
      ) : (
        <div className="min-h-0 w-full flex-1" />
      )}
    </div>
  );
}

type SubscriptionsEmptyStateProps = {
  description: string;
  onAddRss: () => void;
  onImportOpml: () => void;
  title: string;
};

function SubscriptionsEmptyState({
  description,
  onAddRss,
  onImportOpml,
  title,
}: SubscriptionsEmptyStateProps) {
  return (
    <section className="flex min-h-[256px] w-full items-center justify-center overflow-hidden rounded-lg bg-card p-12">
      <div className="flex w-full max-w-96 flex-col items-center gap-6 text-center">
        <div className="flex w-full flex-col items-center gap-2">
          <div className="flex size-10 items-center justify-center rounded-lg bg-muted">
            <HugeiconsIcon icon={PodcastIcon} aria-hidden="true" />
          </div>
          <h2 className="text-lg leading-7 font-medium text-card-foreground">
            {title}
          </h2>
          <p className="text-sm leading-5 text-muted-foreground">
            {description}
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Button type="button" onClick={onAddRss}>
            Add RSS feed
          </Button>
          <Button variant="outline" type="button" onClick={onImportOpml}>
            Import OPML
          </Button>
        </div>
      </div>
    </section>
  );
}

export function SubscriptionsScreen() {
  const isMobile = useIsMobileViewport();
  const { reloadQueue } = usePlaybackDispatch();
  const [showAll, setShowAll] = useState(false);
  const [selectedPodcastId, setSelectedPodcastId] = useState<number | null>(null);
  const [modal, setModal] = useState<AddPodcastModalMode | "show-notes">(null);
  const [showNotesEpisodeId, setShowNotesEpisodeId] = useState<number | null>(null);
  const [podcasts, setPodcasts] = useState<PodcastWithEpisodes[]>([]);
  const [downloadingEpisodeIds, setDownloadingEpisodeIds] = useState<Set<number>>(
    () => new Set()
  );
  const [refreshingPodcastIds, setRefreshingPodcastIds] = useState<Set<number>>(
    () => new Set()
  );
  const [refreshingAll, setRefreshingAll] = useState(false);
  const [loading, setLoading] = useState(true);
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
  const loadedOnceRef = useRef(false);
  const podcastExitTimeoutsRef = useRef<Set<ReturnType<typeof setTimeout>>>(
    new Set()
  );
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
        const [podcastResponse, playlistResponse] =
          await Promise.all([api.podcasts.list(), api.playlist.list()]);
        const podcastItems = podcastResponse.podcasts ?? [];
        const playlistItems = playlistResponse.items ?? [];
        const playlistEpisodeIds = new Set(
          playlistItems.map((item) => item.episodeId)
        );
        const episodeResults = await Promise.all(
          podcastItems.map((podcast) => api.podcasts.episodes(podcast.id))
        );
        const nextPodcasts = podcastItems.map((podcast, index) => ({
          ...podcast,
          episodes: (episodeResults[index].episodes ?? []).map((episode) => ({
            ...episode,
            inPlaylist: playlistEpisodeIds.has(episode.id),
          })),
        }));

        if (!cancelled) {
          loadedOnceRef.current = true;
          setPodcasts(nextPodcasts);
          setSelectedPodcastId((current) => current ?? nextPodcasts[0]?.id ?? null);
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
  }, [reloadKey]);

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
            (episode) => !episode.isListened
          )
      ),
    [exitingPodcastIds, podcastsWithPending, showAll]
  );

  const selectedPodcast =
    visiblePodcasts.find((podcast) => podcast.id === selectedPodcastId) ??
    visiblePodcasts[0];

  const showNotesEpisode =
    selectedPodcast?.episodes.find((episode) => episode.id === showNotesEpisodeId) ??
    null;

  const visibleEpisodes = useMemo(
    () =>
      selectedPodcast?.episodes.filter(
        (episode) =>
          (showAll || !episode.isListened)
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
  const pageTitle = hasSubscriptions
    ? noVisibleUnlistenedPodcasts
      ? "No unlistened podcasts"
      : "Subscriptions"
    : "No podcasts";
  const pageSubtitle = hasSubscriptions
    ? podcastCountLabel(podcastsWithPending.length)
    : "Start with one RSS feed or import subscriptions from another app.";
  const pageActions =
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
      setReloadKey((current) => current + 1);
    } catch (caught) {
      setActionError(getErrorMessage(caught));
    } finally {
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

  function renderPodcastCard(podcast: PodcastWithEpisodes) {
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
            <div className="pt-4 px-5">
              <PageHeader
                layout="mobile"
                title={pageTitle}
                subtitle={pageSubtitle}
                actions={pageActions}
              />
            </div>
          ) : (
            <div className="flex w-full items-center gap-6">
              <div className="flex min-w-0 flex-1 flex-col gap-0.5 overflow-hidden">
                <h1 className="truncate text-3xl leading-9 font-semibold tracking-normal text-foreground">
                  {pageTitle}
                </h1>
                <p className="truncate text-base leading-6 font-medium text-muted-foreground">
                  {pageSubtitle}
                </p>
              </div>
              {pageActions.length > 0 ? (
                <div className="flex h-[34px] shrink-0 items-center gap-2 overflow-hidden">
                  {pageActions.map((action) => (
                    <Button
                      key={action.label}
                      type="button"
                      disabled={action.disabled}
                      variant={action.variant}
                      className={action.variant === "default" ? "shadow-xs" : undefined}
                      onClick={action.onClick}
                    >
                      {action.icon}
                      {action.label}
                    </Button>
                  ))}
                </div>
              ) : null}
            </div>
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
                          (episode) => showAll || !episode.isListened
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
                    <div className="min-w-0 shrink-0">
                      <Carousel
                        className="w-full max-w-full overflow-hidden"
                        opts={{
                          align: "start",
                          containScroll: "trimSnaps",
                        }}
                      >
                        <CarouselContent
                          className={cn(
                            "ml-0 gap-5",
                            !isMobile && visiblePodcasts.length < 4 && "justify-center"
                          )}
                        >
                          {visiblePodcasts.map((podcast) => (
                            <CarouselItem
                              key={podcast.id}
                              className={cn(
                                "pl-0",
                                isMobile
                                  ? "basis-[min(320px,100%)]"
                                  : "basis-[285px]"
                              )}
                            >
                              {renderPodcastCard(podcast)}
                            </CarouselItem>
                          ))}
                        </CarouselContent>
                        <div className="mt-2 hidden items-center justify-center gap-5 md:flex">
                          <CarouselPrevious
                            size="icon"
                            className="static size-8 translate-x-0 translate-y-0 rounded-full"
                          />
                          <CarouselNext
                            size="icon"
                            className="static size-8 translate-x-0 translate-y-0 rounded-full"
                          />
                        </div>
                      </Carousel>
                    </div>
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

                        return (
                          <div
                            key={episode.id}
                            className="shrink-0"
                            style={{ height: episodeRowPitch }}
                          >
                            <EpisodeRow
                              layout={isMobile ? "mobile" : "desktop"}
                              showDragHandle
                              title={episode.title}
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
                                {
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
                                  onClick: episode.downloaded || downloading
                                    ? undefined
                                    : () => void downloadFromSubscription(episode.id),
                                },
                                {
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
                                },
                                {
                                  label: "Show notes",
                                  icon: NoteIcon,
                                  onClick: () => {
                                    setShowNotesEpisodeId(episode.id);
                                    setModal("show-notes");
                                  },
                                },
                                {
                                  label: episode.isListened
                                    ? "Mark as unlistened"
                                    : "Mark as listened",
                                  icon: episode.isListened ? ViewOffIcon : ViewIcon,
                                  onClick: () =>
                                    episode.isListened
                                      ? void markListened([episode], false)
                                      : void markListened([episode], true),
                                },
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
      {modal === "show-notes" && showNotesEpisode && selectedPodcast ? (
        <ModalScreen
          onClose={() => {
            setModal(null);
            setShowNotesEpisodeId(null);
          }}
        >
          <ShowNotes
            podcastTitle={selectedPodcast.title}
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
