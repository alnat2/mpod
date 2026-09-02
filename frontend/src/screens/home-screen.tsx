import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import {
  usePlaybackDispatch,
  usePlaybackProgress,
  usePlaybackState,
  type QueueEpisode,
} from "@/lib/playback-context";
import {
  isAudiobookQueueItem,
  queueItemKey,
  type QueueItemKey,
} from "@/lib/playback-queue";
import type { PlaybackSpeedLabel } from "@/components/mpod/playback";

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

type HomeScreenPlayerProps = {
  currentEpisode: QueueEpisode;
  currentEpisodeDuration: number;
  playing: boolean;
  speedLabel: PlaybackSpeedLabel;
  onNotes: (episode: QueueEpisode) => void;
  onChapters: (episode: QueueEpisode) => void;
};

function HomeScreenPlayer({
  currentEpisode,
  currentEpisodeDuration,
  playing,
  speedLabel,
  onNotes,
  onChapters,
}: HomeScreenPlayerProps) {
  const { positionSeconds, durationSeconds } = usePlaybackProgress();
  const {
    seekBackward,
    seekForward,
    playToggle,
    seekTo,
    setSpeedLabel,
  } = usePlaybackDispatch();

  const displayDurationSeconds = durationSeconds || currentEpisodeDuration;
  const progressValue = useMemo(() => {
    if (!displayDurationSeconds) return 0;
    return Math.min(
      100,
      Math.round((positionSeconds / displayDurationSeconds) * 100)
    );
  }, [displayDurationSeconds, positionSeconds]);
  const remainingSeconds = Math.max(0, displayDurationSeconds - positionSeconds);

  return (
    <Player
      className="shrink-0"
      mode={currentEpisode.type === "audiobook" ? "audiobook" : "episode"}
      hasChapters={Boolean(currentEpisode.hasChapters)}
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
      onNotes={() => onNotes(currentEpisode)}
      onChapters={() => onChapters(currentEpisode)}
      notesDisabled={false}
      onSpeedChange={setSpeedLabel}
    />
  );
}

type HomeScreenChaptersModalProps = {
  audiobook: Audiobook;
  currentTrackId?: number;
  currentEpisodeDuration: number;
  playing: boolean;
  onClose: () => void;
  onPlayTrack: (track: AudiobookTrack) => void;
};

function HomeScreenChaptersModal({
  audiobook,
  currentTrackId,
  currentEpisodeDuration,
  playing,
  onClose,
  onPlayTrack,
}: HomeScreenChaptersModalProps) {
  const { durationSeconds } = usePlaybackProgress();
  const displayDurationSeconds = durationSeconds || currentEpisodeDuration;

  return (
    <AudiobookPlaybackChaptersModal
      audiobook={audiobook}
      currentTrackId={currentTrackId}
      currentDurationSeconds={displayDurationSeconds}
      playing={playing}
      onClose={onClose}
      onPlayTrack={onPlayTrack}
    />
  );
}

type HomeScreenQueueItemProps = {
  episode: QueueEpisode;
  itemKey: QueueItemKey;
  isMobile: boolean;
  isCurrentEpisode: boolean;
  playing: boolean;
  canReorder: boolean;
  isDragging: boolean;
  duration?: number;
  onBeginDrag: (
    event: DragEvent<HTMLDivElement>,
    itemKey: QueueItemKey,
    canReorder: boolean
  ) => void;
  onPreviewDrag: (itemKey: QueueItemKey, canReorder: boolean) => void;
  onFinishDrag: () => void;
  onPlayQueueItem: (episode: QueueEpisode) => void;
  onPlayToggle: () => void;
  onRemoveFromPlaylist: (episode: QueueEpisode) => void;
};

const HomeScreenQueueItem = memo(function HomeScreenQueueItem({
  episode,
  itemKey,
  isMobile,
  isCurrentEpisode,
  playing,
  canReorder,
  isDragging,
  duration,
  onBeginDrag,
  onPreviewDrag,
  onFinishDrag,
  onPlayQueueItem,
  onPlayToggle,
  onRemoveFromPlaylist,
}: HomeScreenQueueItemProps) {
  const isAudiobook = isAudiobookQueueItem(episode);
  const artwork = isAudiobook
    ? episode.hasCover
      ? `/api/audiobooks/${episode.audiobookId ?? episode.id}/cover`
      : "/audiobook-fallback.png"
    : (episode.podcastImageUrl ?? undefined);
  const isMultiChapterAudiobook = Boolean(
    isAudiobook && episode.trackCount && episode.trackCount > 1
  );
  const subtitle = isAudiobook
    ? isMultiChapterAudiobook
      ? `${episode.author || "Audiobook"} · Chapter ${episode.trackNumber ?? 1} / ${episode.trackCount}`
      : episode.author || "Audiobook"
    : undefined;
  const currentStatusLabel = isMultiChapterAudiobook
    ? `Now playing · Chapter ${episode.trackNumber ?? 1} / ${episode.trackCount}`
    : undefined;

  const handlePlayClick = useCallback(() => {
    if (isCurrentEpisode) {
      onPlayToggle();
    } else {
      onPlayQueueItem(episode);
    }
  }, [episode, isCurrentEpisode, onPlayQueueItem, onPlayToggle]);

  const handleRemoveClick = useCallback(() => {
    onRemoveFromPlaylist(episode);
  }, [episode, onRemoveFromPlaylist]);

  const handleDragStart = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      onBeginDrag(event, itemKey, canReorder);
    },
    [canReorder, itemKey, onBeginDrag]
  );

  const handleDragOver = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      onPreviewDrag(itemKey, canReorder);
    },
    [canReorder, itemKey, onPreviewDrag]
  );

  const handleDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      onFinishDrag();
    },
    [onFinishDrag]
  );

  const actions = useMemo(() => {
    const playAction = {
      label: isCurrentEpisode && playing ? "Pause" : "Play",
      icon: isCurrentEpisode && playing ? PauseIcon : PlayIcon,
      onClick: handlePlayClick,
    };
    const removeAction = {
      label: "Remove from playlist",
      icon: PlayListRemoveIcon,
      onClick: handleRemoveClick,
    };

    return isMobile
      ? [removeAction, playAction]
      : [playAction, removeAction];
  }, [handlePlayClick, handleRemoveClick, isCurrentEpisode, isMobile, playing]);

  return (
    <EpisodeRow
      layout={isMobile ? "mobile" : "desktop"}
      compactMobile={isMobile && isAudiobook}
      showDragHandle
      current={isCurrentEpisode}
      currentStatusLabel={currentStatusLabel}
      downloaded={episode.downloaded}
      title={episode.title}
      podcastTitle={isAudiobook ? (episode.author || "Audiobook") : episode.podcastTitle}
      subtitle={subtitle}
      dateLabel={
        isMobile || isAudiobook
          ? undefined
          : formatEpisodeDate(episode.publishedAt) || undefined
      }
      durationLabel={formatDuration(episode.duration ?? duration)}
      thumbnailUrl={artwork}
      thumbnailAlt={`${episode.title} artwork`}
      episodeRowId={episode.id}
      draggable={canReorder}
      dragging={isDragging}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      onDragEnd={onFinishDrag}
      actions={actions}
    />
  );
});

export function HomeScreen() {
  const isMobile = useIsMobileViewport();
  const { queue, currentEpisode, loading, playbackError, playing, speedLabel } =
    usePlaybackState();
  const {
    updateQueue: setQueue,
    reloadQueue,
    playToggle,
    playQueueItem,
    playAudiobookTrack,
    clearPlaybackError,
  } = usePlaybackDispatch();
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

  useEffect(() => {
    if (draggedItemKey === null) {
      queueRef.current = queue;
    }
  }, [draggedItemKey, queue]);

  const removeFromPlaylist = useCallback(async (item: QueueEpisode) => {
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
  }, [setQueue]);

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

  const handleOpenChapters = useCallback(async (item: QueueEpisode) => {
    try {
      const bookId = item.audiobookId ?? item.id;
      const res = await api.audiobooks.get(bookId);
      setSelectedBookForChapters(res.audiobook);
    } catch (caught) {
      setActionError(getErrorMessage(caught));
    }
  }, []);

  const handleOpenNotes = useCallback((episode: QueueEpisode) => {
    setShowNotesEpisodeId(episode.id);
    setModal("show-notes");
  }, []);

  const commitQueueOrder = useCallback(
    async (nextQueue: QueueEpisode[], previousQueue: QueueEpisode[]) => {
      setReordering(true);
      setActionError(null);

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
    },
    [setQueue]
  );

  const beginDragReorder = useCallback(
    (
      event: DragEvent<HTMLDivElement>,
      itemKey: QueueItemKey,
      canReorder: boolean
    ) => {
      if (!canReorder || (event.target as Element).closest("button")) {
        return;
      }

      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", String(itemKey));
      dragOriginQueueRef.current = queueRef.current;
      dragMovedRef.current = false;
      setDraggedItemKey(itemKey);
    },
    []
  );

  const moveQueueItem = useCallback(
    (
      items: QueueEpisode[],
      sourceKey: QueueItemKey,
      targetKey: QueueItemKey
    ): QueueEpisode[] => {
      const sourceIndex = items.findIndex(
        (episode) => queueItemKey(episode) === sourceKey
      );
      const targetIndex = items.findIndex(
        (episode) => queueItemKey(episode) === targetKey
      );

      if (
        sourceIndex < 0 ||
        targetIndex < 0 ||
        sourceIndex === targetIndex
      ) {
        return items;
      }

      const nextItems = [...items];
      const [movedItem] = nextItems.splice(sourceIndex, 1);
      if (!movedItem) {
        return items;
      }

      nextItems.splice(targetIndex, 0, movedItem);
      return nextItems;
    },
    []
  );

  const previewDragReorder = useCallback(
    (itemKey: QueueItemKey, canReorder: boolean) => {
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
    },
    [draggedItemKey, moveQueueItem, setQueue]
  );

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
              <HomeScreenPlayer
                currentEpisode={currentEpisode}
                currentEpisodeDuration={currentEpisodeDuration}
                playing={playing}
                speedLabel={speedLabel}
                onNotes={handleOpenNotes}
                onChapters={handleOpenChapters}
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

                  return (
                    <HomeScreenQueueItem
                      key={itemKey}
                      episode={episode}
                      itemKey={itemKey}
                      isMobile={isMobile}
                      isCurrentEpisode={isCurrentEpisode}
                      playing={playing}
                      canReorder={canReorder}
                      isDragging={draggedItemKey === itemKey}
                      duration={durationForQueueEpisode(episode) ?? undefined}
                      onBeginDrag={beginDragReorder}
                      onPreviewDrag={previewDragReorder}
                      onFinishDrag={finishDragReorder}
                      onPlayQueueItem={playQueueItem}
                      onPlayToggle={playToggle}
                      onRemoveFromPlaylist={removeFromPlaylist}
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
        <HomeScreenChaptersModal
          audiobook={selectedBookForChapters}
          currentTrackId={currentEpisode?.trackId}
          currentEpisodeDuration={currentEpisodeDuration}
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
