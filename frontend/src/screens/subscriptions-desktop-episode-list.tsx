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

import {
  formatEpisodeDateLong,
  formatEpisodeDuration,
} from "./screen-utils";
import { useAudioMetadataDurations } from "./use-audio-metadata-durations";
import { useVirtualScroll } from "@/lib/use-virtual-scroll";

const EPISODE_ROW_HEIGHT = 70;
const EPISODE_ROW_GAP = 4;
const EPISODE_OVERSCAN_ROWS = 4;
const DEFAULT_EPISODE_VIEWPORT_HEIGHT = 350;

type SubscriptionsDesktopEpisodeListProps = {
  onAddToPlaylist: (episodeId: number) => void;
  onMarkAllListened: (podcastId: number) => void;
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
  onMarkAllListened,
  onMarkListened,
  onRemoveFromPlaylist,
  onShowNotes,
  podcast,
  visibleEpisodes,
}: SubscriptionsDesktopEpisodeListProps) {
  const {
    containerRef: episodeListRef,
    onScroll: onEpisodeScroll,
    virtualItems: virtualEpisodes,
    topSpacerHeight,
    bottomSpacerHeight,
  } = useVirtualScroll({
    items: visibleEpisodes,
    itemHeight: EPISODE_ROW_HEIGHT,
    itemGap: EPISODE_ROW_GAP,
    overscan: EPISODE_OVERSCAN_ROWS,
    defaultViewportHeight: DEFAULT_EPISODE_VIEWPORT_HEIGHT,
  });
  const durationForEpisode = useAudioMetadataDurations(virtualEpisodes);
  const unlistenedEpisodeCount = podcast.episodes.filter(
    (episode) => !episode.isListened
  ).length;

  const episodeRowPitch = EPISODE_ROW_HEIGHT + EPISODE_ROW_GAP;

  return (
    <PlaylistQueue
      className="min-h-0 w-full flex-1"
      bodyClassName="mpod-scroll block min-h-0 flex-1 overflow-y-auto pb-20 md:max-h-none md:pb-0"
      bodyRef={episodeListRef}
      bodyOnScroll={onEpisodeScroll}
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
              onClick={() => onMarkAllListened(podcast.id)}
            >
              Mark all listened
            </Button>
          )}
        </>
      }
    >
      {topSpacerHeight > 0 ? (
        <div
          aria-hidden="true"
          className="shrink-0"
          style={{ height: topSpacerHeight }}
        />
      ) : null}
      {virtualEpisodes.map((episode) => {
        const duration = formatEpisodeDuration(durationForEpisode(episode));
        const subtitle = episode.inPlaylist ? "In playlist" : undefined;
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
              subtitle={subtitle}
              inPlaylist={episode.inPlaylist}
              dateLabel={formatEpisodeDateLong(episode.publishedAt) || undefined}
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
      {bottomSpacerHeight > 0 ? (
        <div
          aria-hidden="true"
          className="shrink-0"
          style={{ height: bottomSpacerHeight }}
        />
      ) : null}
    </PlaylistQueue>
  );
}
