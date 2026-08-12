import { useEffect, useMemo, useRef, useState } from "react";

import {
  NoteIcon,
  PlayListAddIcon,
  PlayListRemoveIcon,
  ViewIcon,
  ViewOffIcon,
} from "@hugeicons/core-free-icons";

import { EpisodeRow, PlaylistQueue } from "@/components/mpod";
import { Button } from "@/components/ui/button";
import { api, type Episode } from "@/lib/api";
import type {
  CachedSubscriptionEpisode,
  CachedSubscriptionPodcast,
} from "@/lib/subscriptions-cache";

import { formatDuration, formatEpisodeDate } from "./screen-utils";
import { useAudioMetadataDurations } from "./use-audio-metadata-durations";

const EPISODE_ROW_HEIGHT = 70;
const EPISODE_ROW_GAP = 4;
const EPISODE_OVERSCAN_ROWS = 4;
const DEFAULT_EPISODE_VIEWPORT_HEIGHT = 350;

type SubscriptionsDesktopEpisodeListProps = {
  onAddToPlaylist: (episodeId: number) => void;
  onMarkListened: (
    episodes: Array<Pick<Episode, "id" | "title">>,
    isListened: boolean
  ) => void;
  onRemoveFromPlaylist: (episode: Pick<Episode, "id" | "title">) => void;
  onShowNotes: (episodeId: number) => void;
  podcast: CachedSubscriptionPodcast;
  visibleEpisodes: CachedSubscriptionEpisode[];
};

function episodeSummaryLabel(totalCount: number, unlistenedCount: number) {
  return `${totalCount} / ${unlistenedCount} episodes`;
}

export function SubscriptionsDesktopEpisodeList({
  onAddToPlaylist,
  onMarkListened,
  onRemoveFromPlaylist,
  onShowNotes,
  podcast,
  visibleEpisodes,
}: SubscriptionsDesktopEpisodeListProps) {
  const [episodeScrollTop, setEpisodeScrollTop] = useState(0);
  const [episodeViewportHeight, setEpisodeViewportHeight] = useState(
    DEFAULT_EPISODE_VIEWPORT_HEIGHT
  );
  const episodeListRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = episodeListRef.current;
    if (!container) {
      return;
    }

    const syncMetrics = () => {
      setEpisodeViewportHeight(
        container.clientHeight || DEFAULT_EPISODE_VIEWPORT_HEIGHT
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
  }, [visibleEpisodes.length]);

  const episodeRowPitch = EPISODE_ROW_HEIGHT + EPISODE_ROW_GAP;
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
  const unlistenedEpisodeCount = podcast.episodes.filter(
    (episode) => !episode.isListened
  ).length;

  return (
    <PlaylistQueue
      className="min-h-0 w-full flex-1"
      bodyClassName="mpod-scroll block min-h-0 flex-1 overflow-y-auto pb-20 md:max-h-none md:pb-0"
      bodyRef={episodeListRef}
      bodyOnScroll={(event) =>
        setEpisodeScrollTop(event.currentTarget.scrollTop)
      }
      summary={episodeSummaryLabel(
        podcast.episodes.length,
        unlistenedEpisodeCount
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
        const subtitle = episode.downloaded
          ? episode.inPlaylist
            ? "Downloaded · In playlist"
            : "Downloaded"
          : episode.inPlaylist
            ? "In playlist"
            : undefined;
        const playlistAction = {
          label: episode.inPlaylist
            ? "Remove from playlist"
            : "Add to playlist",
          icon: episode.inPlaylist ? PlayListRemoveIcon : PlayListAddIcon,
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
          onClick: () => onMarkListened([episode], !episode.isListened),
        };

        return (
          <div
            key={episode.id}
            className="shrink-0"
            style={{ height: episodeRowPitch }}
          >
            <EpisodeRow
              layout="desktop"
              title={episode.title}
              podcastTitle={podcast.title}
              subtitle={subtitle}
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
                playlistAction,
                notesAction,
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
  );
}
