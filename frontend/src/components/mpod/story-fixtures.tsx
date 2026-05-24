import { Button } from "@/components/ui/button";

export const featuredEpisode = {
  title: "Why store loyalty cards became a UX minefield",
  podcastTitle: "Decoder Ring",
  artworkUrl: undefined,
  artworkAlt: "Artwork",
  elapsedLabel: "23:14",
  durationLabel: "54:03",
  progressValue: 44,
};

export const queueEpisodes = [
  {
    title: featuredEpisode.title,
    podcastTitle: featuredEpisode.podcastTitle,
    dateLabel: "Mar 31, 2026",
    durationLabel: "54m",
    current: true,
  },
  {
    title: "The hidden ergonomics of habit trackers",
    podcastTitle: "Decoder Ring",
    dateLabel: "Apr 2, 2026",
    durationLabel: "48m",
    current: false,
  },
];

export const showNotesText = `This modal version keeps the main player context visible behind a muted backdrop while giving long show notes enough dedicated space.

Some podcast feeds include full essays, dense links, guest bios, sponsor copy, chapters, transcript excerpts, and source references.

Recommendation for MVP: use this modal pattern when show notes are opened from the focused player on smaller screens or when notes are long.`;

export const settingsAction = (
  <Button size="sm" type="button">
    Export OPML
  </Button>
);
