import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import {
  DownloadSquare01Icon,
  DownloadSquare02Icon,
  Loading02Icon,
  NoteIcon,
  PlayListAddIcon,
  PlayListRemoveIcon,
  ViewIcon,
  ViewOffIcon,
} from "@hugeicons/core-free-icons";

import { EpisodeRow, PlaylistQueue } from "@/components/mpod";
import { Button } from "@/components/ui/button";
import { api, type Episode, type Podcast } from "@/lib/api";

import { formatDuration, formatEpisodeDate } from "./screen-utils";
import { useAudioMetadataDurations } from "./use-audio-metadata-durations";

type PodcastWithEpisodes = Podcast & {
  episodes: Array<Episode & { inPlaylist: boolean }>;
};

const MOBILE_EPISODE_ROW_HEIGHT = 76;
const EPISODE_ROW_GAP = 4;
const EPISODE_OVERSCAN_ROWS = 4;
const MOBILE_EPISODE_VIEWPORT_HEIGHT = 152;

function episodeSummaryLabel(totalCount: number, unlistenedCount: number) {
  return `${totalCount} / ${unlistenedCount} episodes`;
}

type MobilePodcastColumnProps = {
  downloadingEpisodeIds: Set<number>;
  onAddToPlaylist: (episodeId: number) => void;
  onDownload: (episodeId: number) => void;
  onMarkListened: (
    episodes: Array<Pick<Episode, "id" | "title">>,
    isListened: boolean
  ) => void;
  onRemoveFromPlaylist: (episode: Pick<Episode, "id" | "title">) => void;
  onShowNotes: (episodeId: number) => void;
  podcast: PodcastWithEpisodes;
  podcastCardNode: ReactNode;
  showAll: boolean;
  visibleEpisodes: Array<Episode & { inPlaylist: boolean }>;
};

export function MobilePodcastColumn({
  downloadingEpisodeIds,
  onAddToPlaylist,
  onDownload,
  onMarkListened,
  onRemoveFromPlaylist,
  onShowNotes,
  podcast,
  podcastCardNode,
  showAll,
  visibleEpisodes,
}: MobilePodcastColumnProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [episodeScrollTop, setEpisodeScrollTop] = useState(0);
  const [episodeViewportHeight, setEpisodeViewportHeight] = useState(
    MOBILE_EPISODE_VIEWPORT_HEIGHT
  );
  const columnRef = useRef<HTMLDivElement>(null);
  const episodeListRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        setIsVisible(entry.isIntersecting);
      },
      { rootMargin: "100% 0px" }
    );
    if (columnRef.current) {
      observer.observe(columnRef.current);
    }
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!isVisible) {
      return;
    }

    const container = episodeListRef.current;
    if (!container) {
      return;
    }

    const syncMetrics = () => {
      setEpisodeViewportHeight(
        container.clientHeight || MOBILE_EPISODE_VIEWPORT_HEIGHT
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
  }, [isVisible, showAll, visibleEpisodes.length]);

  const episodeRowPitch = MOBILE_EPISODE_ROW_HEIGHT + EPISODE_ROW_GAP;
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
      bottomSpacerHeight: (visibleEpisodes.length - endIndex) * episodeRowPitch,
      items: visibleEpisodes.slice(startIndex, endIndex),
      topSpacerHeight: startIndex * episodeRowPitch,
    };
  }, [episodeRowPitch, episodeScrollTop, episodeViewportHeight, visibleEpisodes]);
  const durationForEpisode = useAudioMetadataDurations(
    virtualEpisodeWindow.items
  );

  const podcastTotalEpisodeCount = podcast.episodes.length;
  const podcastUnlistenedEpisodeCount = podcast.episodes.filter(
    (episode) => !episode.isListened
  ).length;

  return (
    <div ref={columnRef} className="flex h-full flex-col gap-4">
      <div className="shrink-0">{podcastCardNode}</div>
      {isVisible ? (
        <PlaylistQueue
          className="min-h-0 w-full flex-1"
          bodyClassName="mpod-scroll block min-h-0 flex-1 overflow-y-auto pb-20"
          bodyRef={episodeListRef}
          bodyOnScroll={(event) =>
            setEpisodeScrollTop(event.currentTarget.scrollTop)
          }
          summary={episodeSummaryLabel(
            podcastTotalEpisodeCount,
            podcastUnlistenedEpisodeCount
          )}
          headerAction={
            <>
              {visibleEpisodes.some((episode) => !episode.isListened) && (
                <Button
                  variant="link"
                  type="button"
                  className="h-auto whitespace-normal py-1 text-right leading-tight"
                  onClick={() =>
                    onMarkListened(
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
                  : () => onDownload(episode.id),
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
                  ? onRemoveFromPlaylist(episode)
                  : onAddToPlaylist(episode.id),
            };
            const notesAction = {
              label: "Show notes",
              icon: NoteIcon,
              onClick: () => onShowNotes(episode.id),
            };
            const listenedAction = {
              label: episode.isListened
                ? "Mark as unlistened"
                : "Mark as listened",
              icon: episode.isListened ? ViewOffIcon : ViewIcon,
              onClick: () =>
                onMarkListened([episode], !episode.isListened),
            };

            return (
              <div
                key={episode.id}
                className="shrink-0"
                style={{ height: episodeRowPitch }}
              >
                <EpisodeRow
                  layout="mobile"
                  title={episode.title}
                  podcastTitle={podcast.title}
                  downloaded={episode.downloaded}
                  inPlaylist={episode.inPlaylist}
                  dateLabel={publishedAt || undefined}
                  durationLabel={duration || undefined}
                  thumbnailUrl={
                    podcast.imageUrl
                      ? api.podcasts.imagePath(podcast.id)
                      : undefined
                  }
                  thumbnailAlt={`${podcast.title} artwork`}
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
      ) : (
        <div className="min-h-0 w-full flex-1" />
      )}
    </div>
  );
}
