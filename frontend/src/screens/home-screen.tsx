import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent, PointerEvent } from "react";

import {
  PauseIcon,
  PlayIcon,
  PlayListRemoveIcon,
  VolumeUpIcon,
  VolumeOffIcon,
  DownloadSquare01Icon,
  DownloadSquare02Icon,
} from "@hugeicons/core-free-icons";

import {
  AppShell,
  EpisodeRow,
  ModalScreen,
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
  UndoBanner,
} from "./screen-states";
import {
  formatDuration,
  getErrorMessage,
} from "./screen-utils";
import { useDelayedActions } from "./use-delayed-actions";

function queueSummary(episodes: QueueEpisode[]) {
  const totalSeconds = episodes.reduce(
    (total, episode) => total + (episode.duration ?? 0),
    0
  );
  return `${episodes.length} ${episodes.length === 1 ? "episode" : "episodes"} · ${formatDuration(totalSeconds)}`;
}

export function HomeScreen() {
  const {
    queue,
    updateQueue: setQueue,
    loading,
    reloadQueue,
    playing,
    playToggle,
  } = usePlayback();
  const [modal, setModal] = useState<AddPodcastModalMode | "show-notes">(null);
  const error: string | null = null;
  const [actionError, setActionError] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [draggedEpisodeId, setDraggedEpisodeId] = useState<number | null>(null);
  const [reordering, setReordering] = useState(false);
  const queueRef = useRef<QueueEpisode[]>([]);
  const dragOriginQueueRef = useRef<QueueEpisode[]>([]);
  const dragMovedRef = useRef(false);
  const downloadErrorTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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

  const currentEpisode = visibleQueue[0];

  useEffect(() => {
    if (draggedEpisodeId === null) {
      queueRef.current = queue;
    }
  }, [draggedEpisodeId, queue]);

  useEffect(() => {
    return () => {
      if (downloadErrorTimeoutRef.current) {
        window.clearTimeout(downloadErrorTimeoutRef.current);
      }
    };
  }, []);

  async function downloadEpisode(episodeId: number) {
    setActionError(null);
    setDownloadError(null);
    try {
      await api.episodes.download(episodeId);
      setReloadKey((current) => current + 1);
    } catch (caught) {
      setDownloadError(getErrorMessage(caught));
      if (downloadErrorTimeoutRef.current) {
        window.clearTimeout(downloadErrorTimeoutRef.current);
      }
      downloadErrorTimeoutRef.current = window.setTimeout(() => {
        setDownloadError(null);
      }, 10_000);
    }
  }

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

  function scheduleMarkListened(
    episode: Pick<Episode, "id" | "title">,
    isListened: boolean
  ) {
    setActionError(null);
    if (
      pendingActions.some(
        (action) =>
          (action.kind === "mark-listened" ||
            action.kind === "mark-unlistened") &&
          action.episodeIds.includes(episode.id)
      )
    ) {
      return;
    }

    const actionKind = isListened ? "mark-listened" : "mark-unlistened";
    const actionMessage = isListened
      ? `Marked "${episode.title}" as listened`
      : `Marked "${episode.title}" as unlistened`;

    scheduleAction({
      kind: actionKind,
      episodeIds: [episode.id],
      message: actionMessage,
      commit: () => api.episodes.setListened(episode.id, isListened),
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

  function beginPointerReorder(
    event: PointerEvent<HTMLDivElement>,
    episodeId: number,
    canReorder: boolean
  ) {
    if (!canReorder || (event.target as Element).closest("button")) {
      return;
    }

    dragOriginQueueRef.current = queueRef.current;
    dragMovedRef.current = false;
    setDraggedEpisodeId(episodeId);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function beginMouseReorder(
    event: MouseEvent<HTMLDivElement>,
    episodeId: number,
    canReorder: boolean
  ) {
    if (!canReorder || event.button !== 0 || (event.target as Element).closest("button")) {
      return;
    }

    event.preventDefault();
    dragOriginQueueRef.current = queueRef.current;
    dragMovedRef.current = false;
    setDraggedEpisodeId(episodeId);
  }

  const previewPointerReorder = useCallback((episodeId: number, canReorder: boolean) => {
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

  const finishPointerReorder = useCallback(() => {
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

  const findEpisodeIdNearPoint = useCallback((clientX: number, clientY: number) => {
    const exactRow = document
      .elementFromPoint(clientX, clientY)
      ?.closest<HTMLElement>("[data-episode-row-id]");
    const rows = Array.from(
      document.querySelectorAll<HTMLElement>("[data-episode-row-id]")
    );
    const targetRow =
      exactRow ??
      rows.reduce<HTMLElement | null>((closestRow, row) => {
        const rowRect = row.getBoundingClientRect();
        const closestDistance = closestRow
          ? Math.abs(
              clientY -
                (closestRow.getBoundingClientRect().top +
                  closestRow.getBoundingClientRect().height / 2)
            )
          : Number.POSITIVE_INFINITY;
        const distance = Math.abs(
          clientY - (rowRect.top + rowRect.height / 2)
        );

        return distance < closestDistance ? row : closestRow;
      }, null);
    const targetEpisodeId = Number(targetRow?.dataset.episodeRowId);

    return Number.isFinite(targetEpisodeId) ? targetEpisodeId : null;
  }, []);

  useEffect(() => {
    if (draggedEpisodeId === null) {
      return;
    }

    function previewFromPoint(clientX: number, clientY: number) {
      const targetEpisodeId = findEpisodeIdNearPoint(clientX, clientY);

      if (targetEpisodeId !== null) {
        previewPointerReorder(targetEpisodeId, true);
      }
    }

    function handlePointerMove(event: globalThis.PointerEvent) {
      previewFromPoint(event.clientX, event.clientY);
    }

    function handleMouseMove(event: globalThis.MouseEvent) {
      previewFromPoint(event.clientX, event.clientY);
    }

    document.addEventListener("pointermove", handlePointerMove);
    document.addEventListener("pointerup", finishPointerReorder);
    document.addEventListener("pointercancel", finishPointerReorder);
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", finishPointerReorder);

     return () => {
       document.removeEventListener("pointermove", handlePointerMove);
       document.removeEventListener("pointerup", finishPointerReorder);
       document.removeEventListener("pointercancel", finishPointerReorder);
       document.removeEventListener("mousemove", handleMouseMove);
       document.removeEventListener("mouseup", finishPointerReorder);
     };
  }, [
    draggedEpisodeId,
    findEpisodeIdNearPoint,
    finishPointerReorder,
    previewPointerReorder,
  ]);

  return (
    <>
      <AppShell
        activeNavItem="Home"
        onAddPodcast={() => setModal("rss")}
        pageTitle="Now playing"
        pageSubtitle=""
        pageActions={[]}
      >
         <div className="flex h-full min-h-[712px] w-full flex-col items-center gap-4 overflow-hidden rounded-lg p-6">
           {error ? (
             <ErrorBanner className="w-full max-w-[1040px]">{error}</ErrorBanner>
           ) : null}
           {actionError ? (
             <ErrorBanner className="w-full max-w-[1040px]">
               {actionError}
             </ErrorBanner>
           ) : null}
           {downloadError ? (
             <ErrorBanner className="w-full max-w-[1040px]">
               {downloadError}
             </ErrorBanner>
           ) : null}
           {pendingActions.map((action) => (
             <UndoBanner
               key={action.id}
               message={`${action.message} Applying in 15 seconds.`}
               onUndo={() => undoAction(action.id)}
             />
           ))}
          {loading ? (
            <CenterLoadingState label="Loading playlist" />
          ) : currentEpisode ? (
              <PlaylistQueue
                summary={queueSummary(visibleQueue)}
                className="max-w-[1040px]"
              >
                {visibleQueue.map((episode, index) => {
                  const canReorder = pendingActions.length === 0 && !reordering;

                  return (
                    <EpisodeRow
                      current={index === 0}
                      title={episode.title}
                      podcastTitle={episode.podcastTitle}
                      durationLabel={formatDuration(episode.duration)}
                      thumbnailUrl={episode.podcastImageUrl ?? undefined}
                      thumbnailAlt={`${episode.podcastTitle} artwork`}
                      episodeRowId={episode.id}
                      draggable={canReorder}
                      dragging={draggedEpisodeId === episode.id}
                      onPointerDown={(event) =>
                        beginPointerReorder(event, episode.id, canReorder)
                      }
                      onPointerEnter={() =>
                        previewPointerReorder(episode.id, canReorder)
                      }
                      onPointerUp={finishPointerReorder}
                      onPointerCancel={finishPointerReorder}
                      onMouseDown={(event) =>
                        beginMouseReorder(event, episode.id, canReorder)
                      }
                      onMouseEnter={() =>
                        previewPointerReorder(episode.id, canReorder)
                      }
                      onMouseUp={finishPointerReorder}
                        actions={[
                          {
                            label: index === 0 && playing ? "Pause" : "Play",
                            icon: index === 0 && playing ? PauseIcon : PlayIcon,
                            onClick: index === 0 ? playToggle : undefined,
                          },
                          {
                            label: episode.isListened ? "Mark as unlistened" : "Mark as listened",
                            icon: episode.isListened ? VolumeOffIcon : VolumeUpIcon,
                            onClick: () => {
                              setActionError(null);
                              scheduleMarkListened(episode, !episode.isListened);
                            },
                          },
                          {
                            label: "Remove from playlist",
                            icon: PlayListRemoveIcon,
                            onClick: () => scheduleRemoveFromPlaylist(episode),
                          },
                          {
                            label: episode.downloaded ? "Downloaded" : "Download",
                            icon: episode.downloaded
                              ? DownloadSquare02Icon
                              : DownloadSquare01Icon,
                            onClick: episode.downloaded
                              ? undefined
                              : () => void downloadEpisode(episode.id),
                          },
                        ]}
                      key={episode.id}
                    />
                  );
                })}
              </PlaylistQueue>
          ) : (
            <EmptyState
              title="Playlist is empty"
              description="Add episodes from Subscriptions to start listening."
            />
          )}
        </div>
      </AppShell>
      {modal === "show-notes" ? (
        <ModalScreen>
          <ShowNotes
            podcastTitle={currentEpisode?.podcastTitle ?? ""}
            episodeTitle={currentEpisode?.title ?? ""}
          >
            No show notes available.
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
