import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent } from "react";

import {
  PauseIcon,
  PlayIcon,
  PlayListRemoveIcon,
} from "@hugeicons/core-free-icons";

import {
  AppShell,
  AudiobookChaptersModal,
  EpisodeRow,
  ModalScreen,
  Player,
  PlaylistQueue,
  ShowNotes,
} from "@/components/mpod";
import { api, type Audiobook, type AudiobookTrack, type Episode } from "@/lib/api";
import { usePlayback, type QueueEpisode } from "@/lib/playback-context";

import { AddPodcastModal, type AddPodcastModalMode } from "./add-podcast-modal";
import {
  CenterLoadingState,
  EmptyState,
  ErrorBanner,
  ScreenBannerStack,
} from "./screen-states";
import {
  formatClock,
  formatDuration,
  formatEpisodeDate,
  getErrorMessage,
  getEpisodeShowNotes,
} from "./screen-utils";
import { useAudioMetadataDurations } from "./use-audio-metadata-durations";
import { useIsMobileViewport } from "@/lib/use-is-mobile-viewport";

function queueSummary(
  episodes: QueueEpisode[],
  durationForEpisode: (episode: QueueEpisode) => number | null
) {
  const totalSeconds = episodes.reduce(
    (total, episode) => total + (durationForEpisode(episode) ?? episode.duration ?? 0),
    0
  );
  return `${episodes.length} ${episodes.length === 1 ? "item" : "items"} · ${formatDuration(totalSeconds)}`;
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
  const [selectedBookForChapters, setSelectedBookForChapters] = useState<Audiobook | null>(null);
  const error: string | null = null;
  const [actionError, setActionError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [draggedEpisodeId, setDraggedEpisodeId] = useState<number | null>(null);
  const [reordering, setReordering] = useState(false);
  const queueRef = useRef<QueueEpisode[]>([]);
  const dragOriginQueueRef = useRef<QueueEpisode[]>([]);
  const dragMovedRef = useRef(false);

  useEffect(() => {
    if (reloadKey === 0) {
      return;
    }

    void reloadQueue();
  }, [reloadKey, reloadQueue]);

  const visibleQueue = queue;
  const durationForQueueEpisode = useAudioMetadataDurations(visibleQueue);

  const showNotesEpisode =
    visibleQueue.find((episode) => episode.id === showNotesEpisodeId) ??
    (showNotesEpisodeId === currentEpisode?.id ? currentEpisode : null);
  const currentVisibleQueueEpisode = visibleQueue.find(
    (episode) => episode.id === currentEpisode?.id
  );
  const currentEpisodeDuration =
    (currentEpisode ? durationForQueueEpisode(currentEpisode) : null) ??
    (currentVisibleQueueEpisode
      ? durationForQueueEpisode(currentVisibleQueueEpisode)
      : null) ??
    currentEpisode?.duration ??
    0;
  const displayDurationSeconds = durationSeconds || currentEpisodeDuration;
  const progressValue = useMemo(() => {
    if (!displayDurationSeconds) return 0;
    return Math.min(
      100,
      Math.round((positionSeconds / displayDurationSeconds) * 100)
    );
  }, [displayDurationSeconds, positionSeconds]);
  const remainingSeconds = Math.max(0, displayDurationSeconds - positionSeconds);

  useEffect(() => {
    if (draggedEpisodeId === null) {
      queueRef.current = queue;
    }
  }, [draggedEpisodeId, queue]);

  async function removeFromPlaylist(item: QueueEpisode) {
    setActionError(null);
    const previousQueue = queueRef.current;
    setQueue(previousQueue.filter((q) => q.id !== item.id));

    try {
      if (item.type === "audiobook" || item.audiobookId) {
        await api.audiobooks.removeFromPlaylist(item.audiobookId ?? item.id);
      } else {
        await api.playlist.remove(item.id);
      }
      setReloadKey((current) => current + 1);
    } catch (caught) {
      setQueue(previousQueue);
      setActionError(getErrorMessage(caught));
    }
  }

  const handleOpenChapters = async (item: QueueEpisode) => {
    try {
      const bookId = item.audiobookId ?? item.id;
      const res = await api.audiobooks.get(bookId);
      setSelectedBookForChapters(res.audiobook);
    } catch (caught) {
      setActionError(getErrorMessage(caught));
    }
  };

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
    if (!movedEpisode) {
      return currentQueue;
    }

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
        activeNavItem="Player"
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
           </ScreenBannerStack>
          {loading ? (
            <CenterLoadingState className="mt-4" label="Loading playlist" />
          ) : currentEpisode ? (
            <div className="flex min-h-0 flex-1 flex-col items-center gap-4 overflow-hidden px-0 pt-4 pb-5 md:py-6">
              <Player
                className="shrink-0"
                mode={currentEpisode.type === "audiobook" ? "audiobook" : "episode"}
                hasChapters={Boolean(currentEpisode.trackCount && currentEpisode.trackCount > 1)}
                title={currentEpisode.title}
                podcastTitle={currentEpisode.podcastTitle || currentEpisode.author || "Audiobook"}
                artworkUrl={
                  currentEpisode.type === "audiobook"
                    ? currentEpisode.hasCover
                      ? `/api/audiobooks/${currentEpisode.audiobookId ?? currentEpisode.id}/cover`
                      : "/audiobook-fallback.png"
                    : (currentEpisode.podcastImageUrl ?? undefined)
                }
                artworkAlt={`${currentEpisode.title} artwork`}
                elapsedLabel={formatClock(positionSeconds)}
                durationLabel={formatClock(remainingSeconds)}
                playing={playing}
                progressValue={progressValue}
                speedLabel={speedLabel}
                onBack={seekBackward}
                onForward={seekForward}
                onPlay={playToggle}
                onProgressSeek={(progressRatio) =>
                  seekTo(displayDurationSeconds * progressRatio)
                }
                onNotes={() => {
                  if (currentEpisode) {
                    setShowNotesEpisodeId(currentEpisode.id);
                    setModal("show-notes");
                  }
                }}
                onChapters={() => void handleOpenChapters(currentEpisode)}
                notesDisabled={false}
                onSpeedChange={setSpeedLabel}
              />
              <PlaylistQueue
                summary={queueSummary(visibleQueue, durationForQueueEpisode)}
                className="min-h-0 w-full flex-1 md:max-w-[1040px]"
                bodyClassName="mpod-scroll min-h-0 flex-1 overflow-y-auto pb-20 md:max-h-none md:pb-0"
              >
                {visibleQueue.map((episode) => {
                  const canReorder = !reordering;
                  const isCurrentEpisode = currentEpisode?.id === episode.id;
                  const isAudiobook = episode.type === "audiobook" || Boolean(episode.audiobookId);
                  const artwork = isAudiobook
                    ? episode.hasCover
                      ? `/api/audiobooks/${episode.audiobookId ?? episode.id}/cover`
                      : "/audiobook-fallback.png"
                    : (episode.podcastImageUrl ?? undefined);
                  const subtitle = isAudiobook
                    ? episode.trackCount && episode.trackCount > 1
                      ? `${episode.author || "Audiobook"} · Chapter ${episode.trackNumber ?? 1} / ${episode.trackCount}`
                      : episode.author || "Audiobook"
                    : undefined;

                  return (
                    <EpisodeRow
                      layout={isMobile ? "mobile" : "desktop"}
                      showDragHandle
                      current={isCurrentEpisode}
                      downloaded={episode.downloaded}
                      title={episode.title}
                      podcastTitle={isAudiobook ? (episode.author || "Audiobook") : episode.podcastTitle}
                      subtitle={subtitle}
                      dateLabel={
                        isMobile || isAudiobook
                          ? undefined
                          : formatEpisodeDate(episode.publishedAt) || undefined
                      }
                      durationLabel={formatDuration(episode.duration ?? durationForQueueEpisode(episode))}
                      thumbnailUrl={artwork}
                      thumbnailAlt={`${episode.title} artwork`}
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
                      actions={isMobile
                        ? [
                            {
                              label: "Remove from playlist",
                              icon: PlayListRemoveIcon,
                              onClick: () => void removeFromPlaylist(episode),
                            },
                            {
                              label: isCurrentEpisode && playing ? "Pause" : "Play",
                              icon: isCurrentEpisode && playing ? PauseIcon : PlayIcon,
                              onClick:
                                isCurrentEpisode
                                  ? playToggle
                                  : () => playEpisode(episode.id),
                            },
                          ]
                        : [
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
                              onClick: () => void removeFromPlaylist(episode),
                            },
                          ]}
                      key={`${episode.type ?? "ep"}-${episode.id}`}
                    />
                  );
                })}
              </PlaylistQueue>
            </div>
          ) : (
            <EmptyState
              className="mt-4"
              title="Playlist is empty"
              description="Add episodes from Subscriptions or audiobooks from Abooks to start listening."
            />
          )}
        </div>
      </AppShell>
      {modal === "show-notes" && showNotesEpisode ? (
        <ModalScreen
          title="Show notes"
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
            {getEpisodeShowNotes(showNotesEpisode)}
          </ShowNotes>
        </ModalScreen>
      ) : null}
      {selectedBookForChapters && (
        <AudiobookChaptersModal
          audiobook={selectedBookForChapters}
          isMobile={isMobile}
          onClose={() => setSelectedBookForChapters(null)}
          onSelectTrack={async (track) => {
            await api.playback.setActive({
              audiobookId: selectedBookForChapters.id,
              trackId: track.id,
            });
            setSelectedBookForChapters(null);
            await reloadQueue();
          }}
        />
      )}
      <AddPodcastModal
        mode={modal === "show-notes" ? null : modal}
        onClose={() => setModal(null)}
        onComplete={() => setReloadKey((current) => current + 1)}
        onModeChange={setModal}
      />
    </>
  );
}
