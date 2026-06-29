import type { Meta, StoryObj } from "@storybook/react-vite";

import { PodcastCard } from "./podcast-card";

const meta = {
  title: "mpod/PodcastCard",
  component: PodcastCard,
  tags: ["autodocs"],
  args: {
    title: "Decoder Ring",
    description: "Culture stories behind everyday design",
    artworkUrl: undefined,
    artworkAlt: "Podcast artwork",
  },
  parameters: {
    layout: "centered",
  },
} satisfies Meta<typeof PodcastCard>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Selected: Story = {
  args: {
    selected: true,
  },
};

export const LongCopy: Story = {
  args: {
    title: "Grammar Girl: For Writers and Language Lovers.",
    description:
      "Five-time winner of Best Education Podcast in the Podcast Awards.",
  },
};
