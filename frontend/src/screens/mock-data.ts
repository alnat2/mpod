import episodeArtwork from "@/assets/episode-artwork.png";

export const featuredEpisode = {
  title: "Why store loyalty cards became a UX minefield",
  podcastTitle: "Decoder Ring",
  artworkUrl: episodeArtwork,
  artworkAlt: "Episode artwork",
  elapsedLabel: "23:14",
  durationLabel: "54:03",
  progressValue: 44,
};

export const queueEpisodes = [
  {
    title: "Why store loyalty cards became a UX minefield",
    podcastTitle: "Decoder Ring",
    durationLabel: "54m",
    current: true,
  },
  {
    title: "How public transit maps teach invisible habits",
    podcastTitle: "Decoder Ring",
    durationLabel: "36m",
  },
  {
    title: "The app menu nobody understands but everyone uses",
    podcastTitle: "Decoder Ring",
    durationLabel: "43m",
  },
];

export const showNotesText = `This modal version keeps the main player context visible behind a muted backdrop while giving long show notes enough dedicated space. It is useful when notes need more reading focus than a side panel can comfortably provide.

Some podcast feeds include full essays, dense links, guest bios, sponsor copy, chapters, transcript excerpts, and source references. In modal mode the text area should scroll independently, while the modal header and close action remain obvious.

Recommendation for MVP: use this modal pattern when show notes are opened from the focused player on smaller screens or when notes are long. On wider desktop layouts, the side panel can still work, but the modal is safer for overflow-heavy content.

The scrollbar on the right is intentionally visible here. It communicates that there is more content without inventing a fake button-like affordance.`;
