import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent } from "react";

import {
  PauseIcon,
  PlayIcon,
  PlayListRemoveIcon,
} from "@hugeicons/core-free-icons";

import {
  AppShell,
  EpisodeRow,
  ModalScreen,
  Player,
  PlaylistQueue,
  ShowNotes,
} from "@/components/mpod";
import { api, type Episode } from "@/lib/api";
import { usePlayback, type QueueEpisode } from "@/lib/playback-context";

import { AddPodcastModal, type AddPodcastModalMode } from "./add-podcast-modal";
import {
  CenterLoadingState,
  EmptyState,
  ErrorBanner,
  ScreenBannerStack,
  UndoBanner,
} from "./screen-states";
import {
  formatClock,
  formatDuration,
  formatEpisodeDate,
  getErrorMessage,
} from "./screen-utils";
import { useDelayedActions } from "./use-delayed-actions";
import { useIsMobileViewport } from "@/lib/use-is-mobile-viewport";

function queueSummary(episodes: QueueEpisode[]) {
  const totalSeconds = episodes.reduce(
    (total, episode) => total + (episode.duration ?? 0),
    0
  );
  return `${episodes.length} ${episodes.length === 1 ? "episode" : "episodes"} · ${formatDuration(totalSeconds)}`;
}

export function HomeScreen() {
  const isMobile = useIsMobileViewport();
  const {
    queue,
    currentEpisode,
    updateQueue: setQueue,
    loading,
    playbackError,
    reloadQueue,
    playing,
    playToggle,
    playEpisode,
    positionSeconds,
    durationSeconds,
    speedLabel,
    setSpeedLabel,
    clearPlaybackError,
    seekBackward,
    seekForward,
    seekTo,
  } = usePlayback();
  const [modal, setModal] = useState<AddPodcastModalMode | "show-notes">(null);
  const [showNotesEpisodeId, setShowNotesEpisodeId] = useState<number | null>(null);
  const error: string | null = null;
  const [actionError, setActionError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [draggedEpisodeId, setDraggedEpisodeId] = useState<number | null>(null);
  const [reordering, setReordering] = useState(false);
  const queueRef = useRef<QueueEpisode[]>([]);
  const dragOriginQueueRef = useRef<QueueEpisode[]>([]);
  const dragMovedRef = useRef(false);
  const { pendingActions, scheduleAction, undoAction } = useDelayedActions({
    onCommitted: () => setReloadKey((current) => current + 1),
    onError: (caught) => setActionError(getErrorMessage(caught)),
  });

  useEffect(() => {
    void reloadQueue();
  }, [reloadKey, reloadQueue]);

  const pendingPlaylistRemoveEpisodeIds = useMemo(
    () =>
      new Set(
        pendingActions
          .filter((action) => action.kind === "remove-playlist")
          .flatMap((action) => action.episodeIds)
      ),
    [pendingActions]
  );

  const visibleQueue = useMemo(
    () =>
      queue.filter(
        (episode) => !pendingPlaylistRemoveEpisodeIds.has(episode.id)
      ),
    [pendingPlaylistRemoveEpisodeIds, queue]
  );

  const showNotesEpisode =
    visibleQueue.find((episode) => episode.id === showNotesEpisodeId) ??
    (showNotesEpisodeId === currentEpisode?.id ? currentEpisode : null);
  const progressValue = useMemo(() => {
    if (!durationSeconds) return 0;
    return Math.min(100, Math.round((positionSeconds / durationSeconds) * 100));
  }, [durationSeconds, positionSeconds]);

  useEffect(() => {
    if (draggedEpisodeId === null) {
      queueRef.current = queue;
    }
  }, [draggedEpisodeId, queue]);

  function scheduleRemoveFromPlaylist(episode: Pick<Episode, "id" | "title">) {
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

  const moveQueueItem = useCallback((
    currentQueue: QueueEpisode[],
    sourceEpisodeId: number,
    targetEpisodeId: number
  ) => {
    const sourceIndex = currentQueue.findIndex(
      (episode) => episode.id === sourceEpisodeId
    );
    const targetIndex = currentQueue.findIndex(
      (episode) => episode.id === targetEpisodeId
    );

    if (sourceIndex < 0 || targetIndex < 0) {
      return currentQueue;
    }

    const nextQueue = [...currentQueue];
    const [movedEpisode] = nextQueue.splice(sourceIndex, 1);
    nextQueue.splice(targetIndex, 0, movedEpisode);
    return nextQueue;
  }, []);

  const commitQueueOrder = useCallback(async (
    nextQueue: QueueEpisode[],
    previousQueue: QueueEpisode[]
  ) => {
    setActionError(null);
    setReordering(true);

    try {
      await api.playlist.reorder(nextQueue.map((episode) => episode.id));
    } catch (caught) {
      setQueue(previousQueue);
      queueRef.current = previousQueue;
      setActionError(getErrorMessage(caught));
    } finally {
      setReordering(false);
    }
  }, [setQueue]);

  function beginDragReorder(
    event: DragEvent<HTMLDivElement>,
    episodeId: number,
    canReorder: boolean
  ) {
    if (!canReorder || (event.target as Element).closest("button")) {
      return;
    }

    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", String(episodeId));
    dragOriginQueueRef.current = queueRef.current;
    dragMovedRef.current = false;
    setDraggedEpisodeId(episodeId);
  }

  const previewDragReorder = useCallback((episodeId: number, canReorder: boolean) => {
    if (!canReorder || draggedEpisodeId === null || draggedEpisodeId === episodeId) {
      return;
    }

    const currentQueue = queueRef.current;
    const nextQueue = moveQueueItem(currentQueue, draggedEpisodeId, episodeId);

    if (nextQueue !== currentQueue) {
      dragMovedRef.current = true;
      queueRef.current = nextQueue;
      setQueue(nextQueue);
    }

  }, [draggedEpisodeId, moveQueueItem, setQueue]);

  const finishDragReorder = useCallback(() => {
    if (draggedEpisodeId === null) {
      return;
    }

    const shouldCommit = dragMovedRef.current;
    const previousQueue = dragOriginQueueRef.current;
    const nextQueue = queueRef.current;

    setDraggedEpisodeId(null);
    dragMovedRef.current = false;

    if (shouldCommit) {
      void commitQueueOrder(nextQueue, previousQueue);
    }
  }, [commitQueueOrder, draggedEpisodeId]);

  return (
    <>
      <AppShell
        activeNavItem="Home"
        onAddPodcast={() => setModal("rss")}
        pageTitle="Now playing"
        pageSubtitle=""
        pageActions={[]}
        pageHeaderVisible={false}
      >
         <div className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-background md:rounded-md md:border md:border-border md:bg-card md:px-10 md:py-5">
           <div className="flex w-full items-center gap-6 pt-4 md:pt-0">
             <div className="flex min-w-0 flex-1 flex-col gap-0.5 overflow-hidden">
               <h1 className="truncate text-3xl leading-9 font-semibold text-foreground">
                 Now playing
               </h1>
             </div>
           </div>
           <ScreenBannerStack>
             {error ? <ErrorBanner>{error}</ErrorBanner> : null}
             {actionError ? (
               <ErrorBanner onClose={() => setActionError(null)}>
                 {actionError}
               </ErrorBanner>
             ) : null}
             {playbackError ? (
               <ErrorBanner onClose={clearPlaybackError}>
                 {playbackError}
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
          {loading ? (
            <CenterLoadingState className="mt-4" label="Loading playlist" />
          ) : currentEpisode ? (
            <div className="flex min-h-0 flex-1 flex-col items-center gap-4 overflow-hidden px-0 py-4 md:py-6">
              <Player
                className="shrink-0"
                title={currentEpisode.title}
                podcastTitle={currentEpisode.podcastTitle}
                artworkUrl={currentEpisode.podcastImageUrl ?? undefined}
                artworkAlt={`${currentEpisode.podcastTitle} artwork`}
                elapsedLabel={formatClock(positionSeconds)}
                durationLabel={formatClock(durationSeconds)}
                playing={playing}
                progressValue={progressValue}
                speedLabel={speedLabel}
                onBack={seekBackward}
                onForward={seekForward}
                onPlay={playToggle}
                onProgressSeek={(progressRatio) =>
                  seekTo(durationSeconds * progressRatio)
                }
                onNotes={() => {
                  if (currentEpisode) {
                    setShowNotesEpisodeId(currentEpisode.id);
                    setModal("show-notes");
                  }
                }}
                notesDisabled={false}
                onSpeedChange={setSpeedLabel}
              />
              <PlaylistQueue
                summary={queueSummary(visibleQueue)}
                className="min-h-0 w-full shrink-0 md:max-w-[1040px]"
                bodyClassName="max-h-[228px] overflow-y-auto md:max-h-none"
              >
                {visibleQueue.map((episode) => {
                  const canReorder = pendingActions.length === 0 && !reordering;
                  const isCurrentEpisode = currentEpisode?.id === episode.id;

                  return (
                    <EpisodeRow
                      layout={isMobile ? "mobile" : "desktop"}
                      current={isCurrentEpisode}
                      title={episode.title}
                      podcastTitle={episode.podcastTitle}
                      dateLabel={
                        isMobile
                          ? undefined
                          : formatEpisodeDate(episode.publishedAt) || undefined
                      }
                      durationLabel={formatDuration(episode.duration)}
                      thumbnailUrl={episode.podcastImageUrl ?? undefined}
                      thumbnailAlt={`${episode.podcastTitle} artwork`}
                      episodeRowId={episode.id}
                      draggable={canReorder}
                      dragging={draggedEpisodeId === episode.id}
                      onDragStart={(event) =>
                        beginDragReorder(event, episode.id, canReorder)
                      }
                      onDragOver={(event) => {
                        event.preventDefault();
                        previewDragReorder(episode.id, canReorder);
                      }}
                      onDrop={(event) => {
                        event.preventDefault();
                        finishDragReorder();
                      }}
                      onDragEnd={finishDragReorder}
                      actions={[
                        {
                          label: isCurrentEpisode && playing ? "Pause" : "Play",
                          icon: isCurrentEpisode && playing ? PauseIcon : PlayIcon,
                          onClick:
                            isCurrentEpisode
                              ? playToggle
                              : () => playEpisode(episode.id),
                        },
                        {
                          label: "Remove from playlist",
                          icon: PlayListRemoveIcon,
                          onClick: () => scheduleRemoveFromPlaylist(episode),
                        },
                      ]}
                      key={episode.id}
                    />
                  );
                })}
              </PlaylistQueue>
            </div>
          ) : (
            <EmptyState
              className="mt-4"
              title="Playlist is empty"
              description="Add episodes from Subscriptions to start listening."
            />
          )}
        </div>
      </AppShell>
      {modal === "show-notes" && showNotesEpisode ? (
        <ModalScreen
          onClose={() => {
            setModal(null);
            setShowNotesEpisodeId(null);
          }}
        >
          <ShowNotes
            podcastTitle={showNotesEpisode.podcastTitle ?? ""}
            episodeTitle={showNotesEpisode.title ?? ""}
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
