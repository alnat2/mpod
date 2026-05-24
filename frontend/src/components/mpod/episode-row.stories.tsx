import type { Meta, StoryObj } from "@storybook/react-vite";

import { EpisodeRow } from "./episode-row";
import { featuredEpisode } from "./story-fixtures";

const meta = {
  title: "mpod/EpisodeRow",
  component: EpisodeRow,
  tags: ["autodocs"],
  args: {
    title: featuredEpisode.title,
    podcastTitle: featuredEpisode.podcastTitle,
    dateLabel: "Mar 31, 2026",
    durationLabel: "54m",
    thumbnailUrl: featuredEpisode.artworkUrl,
    thumbnailAlt: featuredEpisode.artworkAlt,
  },
  decorators: [
    (Story) => (
      <div className="w-full max-w-[1040px]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof EpisodeRow>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Current: Story = {
  args: {
    current: true,
  },
};
