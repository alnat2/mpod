import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent, PointerEvent } from "react";

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
  type PlaybackSpeedLabel,
  PlaylistQueue,
  ShowNotes,
} from "@/components/mpod";
import { api, type Episode, type PlaybackState, type Podcast } from "@/lib/api";

import { AddPodcastModal, type AddPodcastModalMode } from "./add-podcast-modal";
import { featuredEpisode, showNotesText } from "./mock-data";
import {
  CenterLoadingState,
  EmptyState,
  ErrorBanner,
  UndoBanner,
} from "./screen-states";
import {
  formatClock,
  formatDuration,
  getErrorMessage,
} from "./screen-utils";
import { useDelayedActions } from "./use-delayed-actions";

type QueueEpisode = Episode & {
  podcastTitle: string;
  podcastImageUrl?: string | null;
  playback: PlaybackState | null;
};

type LocalPlayback = {
  episodeId: number;
  positionSeconds: number;
};

function queueSummary(episodes: QueueEpisode[]) {
  const totalSeconds = episodes.reduce(
    (total, episode) => total + (episode.duration ?? 0),
    0
  );
  return `${episodes.length} ${episodes.length === 1 ? "episode" : "episodes"} · ${formatDuration(totalSeconds)}`;
}

function findPodcast(podcasts: Podcast[], podcastId: number) {
  return podcasts.find((podcast) => podcast.id === podcastId);
}

function playbackRateFromLabel(label: PlaybackSpeedLabel) {
  return Number(label.replace("Speed ", "").replace("x", "")) || 1;
}

function clampPosition(positionSeconds: number, durationSeconds?: number | null) {
  const nonNegativePosition = Math.max(0, positionSeconds);

  if (!durationSeconds) {
    return nonNegativePosition;
  }

  return Math.min(durationSeconds, nonNegativePosition);
}

export function HomeScreen() {
  const [modal, setModal] = useState<AddPodcastModalMode | "show-notes">(null);
  const [queue, setQueue] = useState<QueueEpisode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [playingEpisodeId, setPlayingEpisodeId] = useState<number | null>(null);
  const [localPlayback, setLocalPlayback] = useState<LocalPlayback | null>(null);
  const [speedLabel, setSpeedLabel] =
    useState<PlaybackSpeedLabel>("Speed 1x");
  const [draggedEpisodeId, setDraggedEpisodeId] = useState<number | null>(null);
  const [reordering, setReordering] = useState(false);
  const positionSecondsRef = useRef(0);
  const queueRef = useRef<QueueEpisode[]>([]);
  const dragOriginQueueRef = useRef<QueueEpisode[]>([]);
  const dragMovedRef = useRef(false);
  const lastDragPointRef = useRef<{ x: number; y: number } | null>(null);
  const { pendingActions, scheduleAction, undoAction } = useDelayedActions({
    onCommitted: () => setReloadKey((current) => current + 1),
    onError: (caught) => setActionError(getErrorMessage(caught)),
  });

  useEffect(() => {
    let cancelled = false;

    async function loadHome() {
      setLoading(true);
      setError(null);

      try {
        const [playlistResponse, podcastResponse] = await Promise.all([
          api.playlist.list(),
          api.podcasts.list(),
        ]);
        const items = playlistResponse.items ?? [];
        const podcasts = podcastResponse.podcasts ?? [];
        const fullEpisodes = await Promise.all(
          items.map((item) => api.episodes.get(item.episodeId))
        );
        const playbackResults = await Promise.all(
          items.map((item) => api.playback.get(item.episodeId))
        );
        const nextQueue = fullEpisodes.map(({ episode }, index) => {
          const podcast = findPodcast(podcasts, episode.podcastId);
          return {
            ...episode,
            podcastTitle: podcast?.title ?? "Podcast",
            podcastImageUrl: podcast?.imageUrl,
            playback: playbackResults[index].playback,
          };
        });

        if (!cancelled) {
          setQueue(nextQueue);
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

    void loadHome();

    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

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
  const currentEpisodeId = currentEpisode?.id;
  const currentEpisodeDuration = currentEpisode?.duration ?? 0;
  const playing = currentEpisodeId !== undefined && playingEpisodeId === currentEpisodeId;
  const positionSeconds =
    currentEpisodeId !== undefined && localPlayback?.episodeId === currentEpisodeId
      ? localPlayback.positionSeconds
      : currentEpisode?.playback?.positionSeconds ?? 0;
  const progressValue = useMemo(() => {
    if (!currentEpisodeDuration) {
      return 0;
    }
    return Math.min(
      100,
      Math.round((positionSeconds / currentEpisodeDuration) * 100)
    );
  }, [currentEpisodeDuration, positionSeconds]);

  useEffect(() => {
    positionSecondsRef.current = positionSeconds;
  }, [positionSeconds]);

  useEffect(() => {
    queueRef.current = queue;
  }, [queue]);

  const commitPlayback = useCallback(
    async (
      nextPositionSeconds: number,
      options: { completed?: boolean; didSeek?: boolean } = {}
    ) => {
      if (!currentEpisode) {
        return;
      }

      try {
        const response = await api.playback.update({
          episodeId: currentEpisode.id,
          positionSeconds: Math.round(
            clampPosition(nextPositionSeconds, currentEpisode.duration)
          ),
          durationSeconds: currentEpisode.duration ?? 0,
          completed: options.completed ?? false,
          didSeek: options.didSeek ?? false,
          clientUpdatedAt: new Date().toISOString(),
        });

        if (response.playback.episodeId === currentEpisode.id) {
          setLocalPlayback({
            episodeId: response.playback.episodeId,
            positionSeconds: response.playback.positionSeconds,
          });
        }
      } catch (caught) {
        setActionError(getErrorMessage(caught));
      }
    },
    [currentEpisode]
  );

  useEffect(() => {
    if (!playing || !currentEpisodeId) {
      return;
    }

    const intervalId = window.setInterval(() => {
      setLocalPlayback((currentPlayback) => {
        const currentPosition =
          currentPlayback?.episodeId === currentEpisodeId
            ? currentPlayback.positionSeconds
            : positionSecondsRef.current;
        const nextPosition = clampPosition(
          currentPosition + playbackRateFromLabel(speedLabel),
          currentEpisodeDuration
        );

        if (currentEpisodeDuration && nextPosition >= currentEpisodeDuration) {
          setPlayingEpisodeId(null);
          void commitPlayback(nextPosition, { completed: true });
        }

        return { episodeId: currentEpisodeId, positionSeconds: nextPosition };
      });
    }, 1000);

    return () => window.clearInterval(intervalId);
  }, [
    commitPlayback,
    currentEpisodeDuration,
    currentEpisodeId,
    playing,
    speedLabel,
  ]);

  useEffect(() => {
    if (!playing || !currentEpisodeId) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void commitPlayback(positionSecondsRef.current);
    }, 15000);

    return () => window.clearInterval(intervalId);
  }, [commitPlayback, currentEpisodeId, playing]);

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

  function handlePlayToggle() {
    if (!currentEpisode) {
      return;
    }

    setActionError(null);
    setPlayingEpisodeId((current) =>
      current === currentEpisode.id ? null : currentEpisode.id
    );
    void commitPlayback(positionSecondsRef.current);
  }

  function handleBack() {
    const nextPosition = clampPosition(
      positionSecondsRef.current - 10,
      currentEpisodeDuration
    );
    setActionError(null);
    if (currentEpisodeId !== undefined) {
      setLocalPlayback({ episodeId: currentEpisodeId, positionSeconds: nextPosition });
    }
    void commitPlayback(nextPosition, { didSeek: true });
  }

  function handleForward() {
    const nextPosition = clampPosition(
      positionSecondsRef.current + 15,
      currentEpisodeDuration
    );
    setActionError(null);
    if (currentEpisodeId !== undefined) {
      setLocalPlayback({ episodeId: currentEpisodeId, positionSeconds: nextPosition });
    }
    void commitPlayback(nextPosition, { didSeek: true });
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
  }, []);

  async function reorderQueue(sourceEpisodeId: number, targetEpisodeId: number) {
    if (
      sourceEpisodeId === targetEpisodeId ||
      pendingActions.length > 0 ||
      reordering
    ) {
      return;
    }

    const previousQueue = queueRef.current;
    const nextQueue = moveQueueItem(previousQueue, sourceEpisodeId, targetEpisodeId);

    if (nextQueue === previousQueue) {
      return;
    }

    queueRef.current = nextQueue;
    setQueue(nextQueue);
    await commitQueueOrder(nextQueue, previousQueue);
  }

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
    lastDragPointRef.current = { x: event.clientX, y: event.clientY };
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
    lastDragPointRef.current = { x: event.clientX, y: event.clientY };
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

  }, [draggedEpisodeId, moveQueueItem]);

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
      lastDragPointRef.current = { x: clientX, y: clientY };
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
            <>
              <Player
                title={currentEpisode.title}
                podcastTitle={currentEpisode.podcastTitle}
                artworkUrl={currentEpisode.podcastImageUrl ?? featuredEpisode.artworkUrl}
                artworkAlt={`${currentEpisode.podcastTitle} artwork`}
                elapsedLabel={formatClock(
                  positionSeconds
                )}
                durationLabel={formatClock(currentEpisode.duration)}
                progressValue={progressValue}
                playing={playing}
                speedLabel={speedLabel}
                notesDisabled
                onBack={handleBack}
                onForward={handleForward}
                onPlay={handlePlayToggle}
                onSpeedChange={setSpeedLabel}
              />
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
                      thumbnailUrl={episode.podcastImageUrl ?? featuredEpisode.artworkUrl}
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
                      onDragStart={(event) => {
                        if (!canReorder) {
                          event.preventDefault();
                          return;
                        }

                        dragOriginQueueRef.current = queueRef.current;
                        dragMovedRef.current = false;
                        lastDragPointRef.current = {
                          x: event.clientX,
                          y: event.clientY,
                        };
                        setDraggedEpisodeId(episode.id);
                        event.dataTransfer.effectAllowed = "move";
                        event.dataTransfer.setData(
                          "text/plain",
                          String(episode.id)
                        );
                      }}
                      onDragOver={(event) => {
                        if (!canReorder) {
                          return;
                        }

                        event.preventDefault();
                        event.dataTransfer.dropEffect = "move";
                        lastDragPointRef.current = {
                          x: event.clientX,
                          y: event.clientY,
                        };
                        previewPointerReorder(episode.id, canReorder);
                      }}
                      onDrop={(event) => {
                        if (!canReorder) {
                          return;
                        }

                        event.preventDefault();
                        const sourceEpisodeId = Number(
                          event.dataTransfer.getData("text/plain") ||
                            draggedEpisodeId
                        );
                        const finalPoint = lastDragPointRef.current ?? {
                          x: event.clientX,
                          y: event.clientY,
                        };
                        const targetEpisodeId =
                          findEpisodeIdNearPoint(finalPoint.x, finalPoint.y) ??
                          episode.id;
                        const previousQueue = dragOriginQueueRef.current;
                        const nextQueue = moveQueueItem(
                          previousQueue,
                          sourceEpisodeId,
                          targetEpisodeId
                        );
                        setDraggedEpisodeId(null);
                        lastDragPointRef.current = null;

                        if (nextQueue !== previousQueue) {
                          queueRef.current = nextQueue;
                          setQueue(nextQueue);
                          void commitQueueOrder(nextQueue, previousQueue);
                          dragMovedRef.current = false;
                        } else if (dragMovedRef.current) {
                          dragMovedRef.current = false;
                          void commitQueueOrder(queueRef.current, previousQueue);
                        } else {
                          void reorderQueue(sourceEpisodeId, targetEpisodeId);
                        }
                      }}
                      onDragEnd={() => {
                        setDraggedEpisodeId(null);
                        dragMovedRef.current = false;
                        lastDragPointRef.current = null;
                      }}
                      actions={[
                        {
                          label: index === 0 && playing ? "Pause" : "Play",
                          icon: index === 0 && playing ? PauseIcon : PlayIcon,
                          onClick: index === 0 ? handlePlayToggle : undefined,
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
            </>
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
            podcastTitle={currentEpisode?.podcastTitle ?? featuredEpisode.podcastTitle}
            episodeTitle={currentEpisode?.title ?? featuredEpisode.title}
          >
            {showNotesText}
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
