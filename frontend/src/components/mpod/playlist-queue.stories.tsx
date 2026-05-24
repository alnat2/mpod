import type { Meta, StoryObj } from "@storybook/react-vite";

import { EpisodeRow } from "./episode-row";
import { PlaylistQueue } from "./playlist-queue";
import { featuredEpisode, queueEpisodes } from "./story-fixtures";

const meta = {
  title: "mpod/PlaylistQueue",
  component: PlaylistQueue,
  tags: ["autodocs"],
  args: {
    summary: "2 episodes · 1h 42m",
  },
  render: (args) => (
    <PlaylistQueue {...args} className="max-w-[1040px]">
      {queueEpisodes.map((episode) => (
        <EpisodeRow
          current={episode.current}
          title={episode.title}
          podcastTitle={episode.podcastTitle}
          dateLabel={episode.dateLabel}
          durationLabel={episode.durationLabel}
          thumbnailUrl={featuredEpisode.artworkUrl}
          thumbnailAlt={featuredEpisode.artworkAlt}
          key={`${episode.title}-${episode.dateLabel}`}
        />
      ))}
    </PlaylistQueue>
  ),
} satisfies Meta<typeof PlaylistQueue>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};
