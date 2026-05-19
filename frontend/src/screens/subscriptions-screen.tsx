import { useEffect, useMemo, useState } from "react";

import { HugeiconsIcon } from "@hugeicons/react";
import {
  CheckmarkCircle01Icon,
  DownloadSquare01Icon,
  DownloadSquare02Icon,
  EyeIcon,
  FolderSyncIcon,
  PlayListAddIcon,
  PlayListRemoveIcon,
  ViewOffIcon,
} from "@hugeicons/core-free-icons";

import {
  AppShell,
  EpisodeRow,
  PlaylistQueue,
  PodcastCard,
} from "@/components/mpod";
import { Button } from "@/components/ui/button";
import { api, type Episode, type Podcast } from "@/lib/api";

import { AddPodcastModal, type AddPodcastModalMode } from "./add-podcast-modal";
import { featuredEpisode } from "./mock-data";
import { EmptyState, ErrorBanner, ListLoadingState } from "./screen-states";
import { UndoBanner } from "./screen-states";
import {
  formatDuration,
  formatEpisodeDate,
  getErrorMessage,
} from "./screen-utils";
import { useDelayedActions } from "./use-delayed-actions";

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
  return `Last refresh · ${new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(lastChecked)}`;
}

export function SubscriptionsScreen() {
  const [showAll, setShowAll] = useState(false);
  const [selectedPodcastId, setSelectedPodcastId] = useState<number | null>(null);
  const [modal, setModal] = useState<AddPodcastModalMode>(null);
  const [podcasts, setPodcasts] = useState<PodcastWithEpisodes[]>([]);
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
          .filter((action) => action.kind === "mark-listened")
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

  const podcastsWithPending = useMemo(
    () =>
      podcasts.map((podcast) => ({
        ...podcast,
        episodes: podcast.episodes.map((episode) => ({
          ...episode,
          inPlaylist:
            episode.inPlaylist && !pendingPlaylistRemoveEpisodeIds.has(episode.id),
        })),
      })),
    [pendingPlaylistRemoveEpisodeIds, podcasts]
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

  function scheduleMarkListened(
    episodes: Array<Pick<Episode, "id" | "title">>
  ) {
    setActionError(null);
    const actionableEpisodes = episodes.filter(
      (episode) => !pendingListenedEpisodeIds.has(episode.id)
    );
    if (actionableEpisodes.length === 0) {
      return;
    }

    scheduleAction({
      kind: "mark-listened",
      episodeIds: actionableEpisodes.map((episode) => episode.id),
      message:
        actionableEpisodes.length === 1
          ? `Marked "${actionableEpisodes[0].title}" as listened.`
          : `Marked ${actionableEpisodes.length} episodes as listened.`,
      commit: async () => {
        await Promise.all(
          actionableEpisodes.map((episode) =>
            api.episodes.setListened(episode.id, true)
          )
        );
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
        pageActions={[
          {
            label: "Refresh all",
            icon: (
              <HugeiconsIcon icon={FolderSyncIcon} data-icon="inline-start" />
            ),
            onClick: () =>
              void runAction(async () => {
                await Promise.all(
                  podcasts.map((podcast) => api.podcasts.refresh(podcast.id))
                );
              }),
            variant: "secondary",
          },
          {
            label: showAll ? "Show unlistened podcasts" : "Show all",
            icon: <HugeiconsIcon icon={EyeIcon} data-icon="inline-start" />,
            onClick: () => setShowAll((current) => !current),
            variant: "default",
          },
        ]}
      >
        <div className="flex h-full min-h-[686px] w-full flex-col gap-5 overflow-y-auto rounded-lg py-6">
          {error ? (
            <ErrorBanner>{error}</ErrorBanner>
          ) : null}
          {actionError ? (
            <ErrorBanner>{actionError}</ErrorBanner>
          ) : null}
          {pendingActions.map((action) => (
            <UndoBanner
              key={action.id}
              message={`${action.message} Applying in 15 seconds.`}
              onUndo={() => undoAction(action.id)}
            />
          ))}
          {loading ? (
            <ListLoadingState label="Loading subscriptions" />
          ) : visiblePodcasts.length > 0 ? (
            <>
              <div className="grid max-h-[860px] grid-cols-[repeat(4,285px)] gap-5 overflow-y-auto pr-1">
                {visiblePodcasts.map((podcast) => {
                  const unlistenedCount = podcast.episodes.filter(
                    (episode) =>
                      !episode.isListened &&
                      !pendingListenedEpisodeIds.has(episode.id)
                  ).length;

                  return (
                    <PodcastCard
                      key={podcast.id}
                      selected={podcast.id === selectedPodcast?.id}
                      title={podcast.title}
                      description={podcast.description ?? podcast.rssUrl}
                      episodeCountLabel={episodeCountLabel(unlistenedCount)}
                      artworkUrl={podcast.imageUrl ?? featuredEpisode.artworkUrl}
                      artworkAlt={`${podcast.title} artwork`}
                      onSelect={() => setSelectedPodcastId(podcast.id)}
                      onRefresh={() =>
                        void runAction(() => api.podcasts.refresh(podcast.id))
                      }
                    />
                  );
                })}
              </div>
              <PlaylistQueue
                summary={`${selectedPodcast.title} episodes`}
                headerAction={
                  <Button
                    variant="link"
                    type="button"
                    onClick={() =>
                      scheduleMarkListened(
                        visibleEpisodes.filter((episode) => !episode.isListened)
                      )
                    }
                  >
                    Mark all listened
                  </Button>
                }
              >
                {visibleEpisodes.map((episode) => {
                  const duration = formatDuration(episode.duration);
                  const publishedAt = formatEpisodeDate(episode.publishedAt);

                  return (
                    <EpisodeRow
                      key={episode.id}
                      title={episode.title}
                      podcastTitle={selectedPodcast.title}
                      dateLabel={publishedAt ? `${publishedAt} ·` : undefined}
                      durationLabel={duration || undefined}
                      thumbnailUrl={
                        selectedPodcast.imageUrl ?? featuredEpisode.artworkUrl
                      }
                      thumbnailAlt={`${selectedPodcast.title} artwork`}
                      actions={[
                        {
                          label: episode.downloaded ? "Downloaded" : "Download",
                          icon: episode.downloaded
                            ? DownloadSquare02Icon
                            : DownloadSquare01Icon,
                          onClick: episode.downloaded
                            ? undefined
                            : () =>
                                void runAction(() =>
                                  api.episodes.download(episode.id)
                                ),
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
                          label: episode.isListened
                            ? "Mark unlistened"
                            : "Mark as listened",
                          icon: episode.isListened
                            ? ViewOffIcon
                            : CheckmarkCircle01Icon,
                          onClick: () =>
                            episode.isListened
                              ? void runAction(() =>
                                  api.episodes.setListened(episode.id, false)
                                )
                              : scheduleMarkListened([episode]),
                        },
                      ]}
                    />
                  );
                })}
              </PlaylistQueue>
            </>
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
      </AppShell>
      <AddPodcastModal
        mode={modal}
        onClose={() => setModal(null)}
        onComplete={() => setReloadKey((current) => current + 1)}
        onModeChange={setModal}
      />
    </>
  );
}
