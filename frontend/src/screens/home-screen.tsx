import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent } from "react";

import {
  PauseIcon,
  PlayIcon,
  PlayListRemoveIcon,
} from "@hugeicons/core-free-icons";

import {
  AppShell,
  AudiobookPlaybackChaptersModal,
  EpisodeRow,
  ModalScreen,
  Player,
  PlaylistQueue,
  ShowNotes,
} from "@/components/mpod";
import { api, type Audiobook, type AudiobookTrack } from "@/lib/api";
import { usePlayback, type QueueEpisode } from "@/lib/playback-context";
import {
  isAudiobookQueueItem,
  queueItemKey,
  type QueueItemKey,
} from "@/lib/playback-queue";

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
    playQueueItem,
    playAudiobookTrack,
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
  const [draggedItemKey, setDraggedItemKey] = useState<QueueItemKey | null>(null);
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
    visibleQueue.find(
      (episode) =>
        !isAudiobookQueueItem(episode) && episode.id === showNotesEpisodeId
    ) ??
    (showNotesEpisodeId === currentEpisode?.id &&
    currentEpisode &&
    !isAudiobookQueueItem(currentEpisode)
      ? currentEpisode
      : null);
  const currentVisibleQueueEpisode = visibleQueue.find(
    (episode) =>
      currentEpisode && queueItemKey(episode) === queueItemKey(currentEpisode)
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
    if (draggedItemKey === null) {
      queueRef.current = queue;
    }
  }, [draggedItemKey, queue]);

  async function removeFromPlaylist(item: QueueEpisode) {
    setActionError(null);
    const previousQueue = queueRef.current;
    const itemKey = queueItemKey(item);
    setQueue(previousQueue.filter((q) => queueItemKey(q) !== itemKey));

    try {
      if (item.trackId && item.audiobookId && item.trackCount === 1) {
        await api.audiobooks.removeTrackFromPlaylist(item.audiobookId, item.trackId);
      } else if (item.type === "audiobook" || item.audiobookId) {
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

	const handlePlayChapter = async (track: AudiobookTrack) => {
    if (!selectedBookForChapters) return;
    try {
	  const isCurrentTrack =
		(currentEpisode?.audiobookId ?? currentEpisode?.id) ===
		  selectedBookForChapters.id && currentEpisode?.trackId === track.id;
	  if (isCurrentTrack) {
		playToggle();
		return;
	  }
	  await playAudiobookTrack(selectedBookForChapters.id, track);
	  setSelectedBookForChapters((current) =>
		current
		  ? {
			  ...current,
			  tracks: current.tracks?.map((item) =>
				item.id === track.id
				  ? {
					  ...item,
					  isListened: false,
					  positionSeconds: track.isListened
						? 0
						: track.positionSeconds,
					}
				  : item
			  ),
			}
		  : null
	  );
    } catch (e) {
      setActionError(getErrorMessage(e));
    }
  };

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
    sourceItemKey: QueueItemKey,
    targetItemKey: QueueItemKey
  ) => {
    const sourceIndex = currentQueue.findIndex(
      (episode) => queueItemKey(episode) === sourceItemKey
    );
    const targetIndex = currentQueue.findIndex(
      (episode) => queueItemKey(episode) === targetItemKey
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
      await api.playlist.reorder(
        nextQueue.map((episode) => ({
          id: episode.id,
          type: episode.type || "episode",
        }))
      );
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
    itemKey: QueueItemKey,
    canReorder: boolean
  ) {
    if (!canReorder || (event.target as Element).closest("button")) {
      return;
    }

    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", itemKey);
    dragOriginQueueRef.current = queueRef.current;
    dragMovedRef.current = false;
    setDraggedItemKey(itemKey);
  }

  const previewDragReorder = useCallback((itemKey: QueueItemKey, canReorder: boolean) => {
    if (!canReorder || draggedItemKey === null || draggedItemKey === itemKey) {
      return;
    }

    const currentQueue = queueRef.current;
    const nextQueue = moveQueueItem(currentQueue, draggedItemKey, itemKey);

    if (nextQueue !== currentQueue) {
      dragMovedRef.current = true;
      queueRef.current = nextQueue;
      setQueue(nextQueue);
    }

  }, [draggedItemKey, moveQueueItem, setQueue]);

  const finishDragReorder = useCallback(() => {
    if (draggedItemKey === null) {
      return;
    }

    const shouldCommit = dragMovedRef.current;
    const previousQueue = dragOriginQueueRef.current;
    const nextQueue = queueRef.current;

    setDraggedItemKey(null);
    dragMovedRef.current = false;

    if (shouldCommit) {
      void commitQueueOrder(nextQueue, previousQueue);
    }
  }, [commitQueueOrder, draggedItemKey]);

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
            <div className="mpod-scroll flex min-h-0 flex-1 flex-col items-center gap-4 overflow-y-auto px-0 pt-4 pb-5 md:py-6">
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
                onSeekSeconds={seekTo}
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
                className="w-full shrink-0 md:max-w-[1040px]"
                bodyClassName="mpod-scroll h-[236px] shrink-0 overflow-y-auto overscroll-contain pb-20 md:h-[218px] md:pb-0"
              >
                {visibleQueue.map((episode) => {
                  const itemKey = queueItemKey(episode);
                  const canReorder = !reordering;
                  const isCurrentEpisode = Boolean(
                    currentEpisode && queueItemKey(currentEpisode) === itemKey
                  );
                  const isAudiobook = isAudiobookQueueItem(episode);
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
                      dragging={draggedItemKey === itemKey}
                      onDragStart={(event) =>
                        beginDragReorder(event, itemKey, canReorder)
                      }
                      onDragOver={(event) => {
                        event.preventDefault();
                        previewDragReorder(itemKey, canReorder);
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
                                  : () => playQueueItem(episode),
                            },
                          ]
                        : [
                            {
                              label: isCurrentEpisode && playing ? "Pause" : "Play",
                              icon: isCurrentEpisode && playing ? PauseIcon : PlayIcon,
                              onClick:
                                isCurrentEpisode
                                  ? playToggle
                                  : () => playQueueItem(episode),
                            },
                            {
                              label: "Remove from playlist",
                              icon: PlayListRemoveIcon,
                              onClick: () => void removeFromPlaylist(episode),
                            },
                          ]}
                      key={itemKey}
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
		<AudiobookPlaybackChaptersModal
		  audiobook={selectedBookForChapters}
		  currentTrackId={currentEpisode?.trackId}
		  currentDurationSeconds={displayDurationSeconds}
		  playing={playing}
		  onClose={() => setSelectedBookForChapters(null)}
		  onPlayTrack={handlePlayChapter}
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
