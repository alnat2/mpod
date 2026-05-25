import { useEffect, useMemo, useState } from "react";

import { HugeiconsIcon } from "@hugeicons/react";
import {
  DownloadSquare01Icon,
  DownloadSquare02Icon,
  EyeIcon,
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
  CarouselNext,
  CarouselPrevious,
} from "@/components/ui/carousel";
import { api, type Episode, type Podcast } from "@/lib/api";
import { usePlayback } from "@/lib/playback-context";

import { AddPodcastModal, type AddPodcastModalMode } from "./add-podcast-modal";
import {
  EmptyState,
  ErrorBanner,
  ListLoadingState,
  ScreenBannerStack,
} from "./screen-states";
import { UndoBanner } from "./screen-states";
import {
  formatDuration,
  formatEpisodeDate,
  getErrorMessage,
} from "./screen-utils";
import { useDelayedActions } from "./use-delayed-actions";
import { cn } from "@/lib/utils";

type PodcastWithEpisodes = Podcast & {
  episodes: Array<Episode & { inPlaylist: boolean }>;
};

function episodeCountLabel(count: number) {
  return `${count} ${count === 1 ? "unlistened episode" : "unlistened episodes"}`;
}

function formatLastRefresh(podcasts: PodcastWithEpisodes[]) {
  const timestamps = podcasts
    .map((podcast) => podcast.lastChecked)
    .filter(Boolean)
    .map((value) => new Date(value as string).getTime())
    .filter(Number.isFinite);

  if (timestamps.length === 0) {
    return "Last refresh · never";
  }

  const lastChecked = new Date(Math.max(...timestamps));
  const now = new Date();
  const isSameDay =
    lastChecked.getFullYear() === now.getFullYear() &&
    lastChecked.getMonth() === now.getMonth() &&
    lastChecked.getDate() === now.getDate();

  if (isSameDay) {
    return `Last refresh · today ${new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit",
    }).format(lastChecked)}`;
  }

  return `Last refresh · ${new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(lastChecked)}`;
}

export function SubscriptionsScreen() {
  const { reloadQueue } = usePlayback();
  const [showAll, setShowAll] = useState(false);
  const [selectedPodcastId, setSelectedPodcastId] = useState<number | null>(null);
  const [modal, setModal] = useState<AddPodcastModalMode | "show-notes">(null);
  const [showNotesEpisodeId, setShowNotesEpisodeId] = useState<number | null>(null);
  const [podcasts, setPodcasts] = useState<PodcastWithEpisodes[]>([]);
  const [downloadingEpisodeIds, setDownloadingEpisodeIds] = useState<Set<number>>(
    () => new Set()
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const { pendingActions, scheduleAction, undoAction } = useDelayedActions({
    onCommitted: () => setReloadKey((current) => current + 1),
    onError: (caught) => setActionError(getErrorMessage(caught)),
  });

  useEffect(() => {
    let cancelled = false;

    async function loadSubscriptions() {
      setLoading(true);
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
          setPodcasts(nextPodcasts);
          setSelectedPodcastId((current) => current ?? nextPodcasts[0]?.id ?? null);
        }
      } catch (caught) {
        if (!cancelled) {
          setError(getErrorMessage(caught));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadSubscriptions();

    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const pendingListenedEpisodeIds = useMemo(
    () =>
      new Set(
        pendingActions
          .filter((action) => action.kind === "mark-listened" || action.kind === "mark-unlistened")
          .flatMap((action) => action.episodeIds)
      ),
    [pendingActions]
  );

  const pendingPlaylistRemoveEpisodeIds = useMemo(
    () =>
      new Set(
        pendingActions
          .filter((action) => action.kind === "remove-playlist")
          .flatMap((action) => action.episodeIds)
      ),
    [pendingActions]
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
        .filter((podcast) => !pendingUnsubscribePodcastIds.has(podcast.id))
        .map((podcast) => ({
          ...podcast,
          episodes: podcast.episodes.map((episode) => ({
            ...episode,
            inPlaylist:
              episode.inPlaylist && !pendingPlaylistRemoveEpisodeIds.has(episode.id),
          })),
        })),
    [pendingPlaylistRemoveEpisodeIds, pendingUnsubscribePodcastIds, podcasts]
  );

  const visiblePodcasts = useMemo(
    () =>
      podcastsWithPending.filter(
        (podcast) =>
          showAll ||
          podcast.episodes.some(
            (episode) =>
              !episode.isListened && !pendingListenedEpisodeIds.has(episode.id)
          )
      ),
    [pendingListenedEpisodeIds, podcastsWithPending, showAll]
  );

  const selectedPodcast =
    visiblePodcasts.find((podcast) => podcast.id === selectedPodcastId) ??
    visiblePodcasts[0];

  const showNotesEpisode =
    selectedPodcast?.episodes.find((episode) => episode.id === showNotesEpisodeId) ??
    null;

  const visibleEpisodes =
    selectedPodcast?.episodes.filter(
      (episode) =>
        !pendingListenedEpisodeIds.has(episode.id) &&
        (showAll || !episode.isListened)
    ) ??
    [];

  async function runAction(action: () => Promise<unknown>) {
    setActionError(null);
    try {
      await action();
      setReloadKey((current) => current + 1);
    } catch (caught) {
      setActionError(getErrorMessage(caught));
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

  function scheduleUnsubscribePodcast(podcast: Pick<Podcast, "id" | "title">) {
    setActionError(null);
    if (pendingUnsubscribePodcastIds.has(podcast.id)) {
      return;
    }

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
  }

  function scheduleMarkListened(
    episodes: Array<Pick<Episode, "id" | "title">>,
    isListened: boolean
  ) {
    setActionError(null);
    const actionableEpisodes = episodes.filter(
      (episode) => !pendingListenedEpisodeIds.has(episode.id)
    );
    if (actionableEpisodes.length === 0) {
      return;
    }

    scheduleAction({
      kind: isListened ? "mark-listened" : "mark-unlistened",
      episodeIds: actionableEpisodes.map((episode) => episode.id),
      message:
        actionableEpisodes.length === 1
          ? `${isListened ? "Marked" : "Marked"} "${actionableEpisodes[0].title}" as ${isListened ? "listened" : "unlistened"}`
          : `${isListened ? "Marked" : "Marked"} ${actionableEpisodes.length} episodes as ${isListened ? "listened" : "unlistened"}`,
      commit: async () => {
        for (const episode of actionableEpisodes) {
          await api.episodes.setListened(episode.id, isListened);
        }
      },
    });
  }

  function scheduleRemoveFromPlaylist(
    episode: Pick<Episode, "id" | "title">
  ) {
    setActionError(null);
    if (pendingPlaylistRemoveEpisodeIds.has(episode.id)) {
      return;
    }

    scheduleAction({
      kind: "remove-playlist",
      episodeIds: [episode.id],
      message: `Removed "${episode.title}" from playlist.`,
      commit: () => api.playlist.remove(episode.id),
    });
  }

  return (
    <>
      <AppShell
        activeNavItem="Subscriptions"
        onAddPodcast={() => setModal("rss")}
        pageTitle="Subscriptions"
        pageSubtitle={formatLastRefresh(podcasts)}
        pageActions={[]}
        pageHeaderVisible={false}
      >
        <div className="flex h-full min-h-0 w-full flex-col overflow-hidden rounded-md border border-border bg-card px-10 py-5">
          <div className="flex w-full items-center gap-6">
            <div className="flex min-w-0 flex-1 flex-col gap-0.5 overflow-hidden">
              <h1 className="truncate text-3xl leading-9 font-semibold tracking-normal text-foreground">
                Subscriptions
              </h1>
              <p className="truncate text-base leading-6 font-medium text-muted-foreground">
                {formatLastRefresh(podcasts)}
              </p>
            </div>
            <div className="flex h-[34px] shrink-0 items-center gap-2 overflow-hidden">
              <Button
                type="button"
                variant="secondary"
                onClick={() =>
                  void runAction(async () => {
                    await api.podcasts.refreshAll();
                  })
                }
              >
                <HugeiconsIcon
                  icon={RefreshDotIcon}
                  data-icon="inline-start"
                />
                Refresh all
              </Button>
              <Button
                type="button"
                variant="default"
                className="shadow-xs"
                onClick={() => setShowAll((current) => !current)}
              >
                <HugeiconsIcon icon={ViewIcon} data-icon="inline-start" />
                {showAll ? "Show unlistened podcasts" : "Show all"}
              </Button>
            </div>
          </div>
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
          <div className="min-h-0 flex-1 overflow-y-auto py-6">
            {loading ? (
              <ListLoadingState label="Loading subscriptions" />
            ) : visiblePodcasts.length > 0 ? (
              <div className="flex w-full flex-col gap-6">
                <div className="shrink-0">
                  <Carousel
                    className="w-full"
                    opts={{
                      align: "start",
                      containScroll: "trimSnaps",
                    }}
                  >
                    <CarouselContent
                      className={cn(
                        "ml-0 gap-5",
                        visiblePodcasts.length < 4 && "justify-center"
                      )}
                    >
                      {visiblePodcasts.map((podcast) => {
                        const unlistenedCount = podcast.episodes.filter(
                          (episode) =>
                            !episode.isListened &&
                            !pendingListenedEpisodeIds.has(episode.id)
                        ).length;

                        return (
                          <CarouselItem
                            key={podcast.id}
                            className={
                              visiblePodcasts.length < 4
                                ? "basis-[285px] pl-0"
                                : "basis-[285px] pl-0"
                            }
                          >
                            <PodcastCard
                              selected={podcast.id === selectedPodcast?.id}
                              title={podcast.title}
                              description={podcast.description ?? podcast.rssUrl}
                              episodeCountLabel={episodeCountLabel(unlistenedCount)}
                              artworkUrl={
                                podcast.imageUrl
                                  ? api.podcasts.imagePath(podcast.id)
                                  : undefined
                              }
                              artworkAlt={`${podcast.title} artwork`}
                              onSelect={() => setSelectedPodcastId(podcast.id)}
                              onRefresh={() =>
                                void runAction(() => api.podcasts.refresh(podcast.id))
                              }
                              onUnsubscribe={() => scheduleUnsubscribePodcast(podcast)}
                            />
                          </CarouselItem>
                        );
                      })}
                    </CarouselContent>
                    <div className="mt-2 flex items-center justify-center gap-5">
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
                  className="h-[400px] shrink-0"
                  bodyClassName="h-[350px] min-h-0 overflow-y-auto"
                  summary={`${selectedPodcast.title} episodes`}
                  headerAction={
                    <>
                      {visibleEpisodes.some((episode) => !episode.isListened) && (
                        <Button
                          variant="link"
                          type="button"
                          onClick={() =>
                            scheduleMarkListened(
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
                  {visibleEpisodes.map((episode) => {
                    const duration = formatDuration(episode.duration);
                    const publishedAt = formatEpisodeDate(episode.publishedAt);
                    const downloading = downloadingEpisodeIds.has(episode.id);
                    const subtitle = episode.downloaded
                      ? episode.inPlaylist
                        ? "Downloaded · In playlist"
                        : "Downloaded"
                      : episode.inPlaylist
                        ? "In playlist"
                        : selectedPodcast.title;

                    return (
                      <EpisodeRow
                        key={episode.id}
                        showDragHandle={false}
                        title={episode.title}
                        podcastTitle={selectedPodcast.title}
                        subtitle={subtitle}
                        dateLabel={publishedAt ? `${publishedAt} ·` : undefined}
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
                                ? scheduleRemoveFromPlaylist(episode)
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
                            icon: episode.isListened ? ViewOffIcon : EyeIcon,
                            onClick: () =>
                              episode.isListened
                                ? scheduleMarkListened([episode], false)
                                : scheduleMarkListened([episode], true),
                          },
                        ]}
                      />
                    );
                  })}
                </PlaylistQueue>
              </div>
            ) : (
              <EmptyState
                title="No podcasts yet"
                description="Add one RSS feed or bring subscriptions from another podcast app with OPML."
                actions={
                  <>
                    <Button type="button" onClick={() => setModal("rss")}>
                      Add RSS feed
                    </Button>
                    <Button
                      variant="outline"
                      type="button"
                      onClick={() => setModal("opml")}
                    >
                      Import OPML
                    </Button>
                  </>
                }
              />
            )}
          </div>
        </div>
      </AppShell>
      {modal === "show-notes" && showNotesEpisode && selectedPodcast ? (
        <ModalScreen>
          <ShowNotes
            podcastTitle={selectedPodcast.title}
            episodeTitle={showNotesEpisode.title}
            onClose={() => {
              setModal(null);
              setShowNotesEpisodeId(null);
            }}
          >
            {showNotesEpisode.description?.trim() || "No show notes available."}
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
