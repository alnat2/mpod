import type { Meta, StoryObj } from "@storybook/react-vite";

import { Player } from "./player";
import { featuredEpisode } from "./story-fixtures";

const meta = {
  title: "mpod/Player",
  component: Player,
  tags: ["autodocs"],
  args: {
    title: featuredEpisode.title,
    podcastTitle: featuredEpisode.podcastTitle,
    artworkUrl: featuredEpisode.artworkUrl,
    artworkAlt: featuredEpisode.artworkAlt,
    elapsedLabel: featuredEpisode.elapsedLabel,
    durationLabel: featuredEpisode.durationLabel,
    progressValue: featuredEpisode.progressValue,
  },
  parameters: {
    layout: "centered",
  },
} satisfies Meta<typeof Player>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Playing: Story = {
  args: {
    playing: true,
  },
};
