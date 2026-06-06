import type { Meta, StoryObj } from "@storybook/react-vite";

import { PodcastCard } from "./podcast-card";
import {
  mobileStoryGlobals,
  mobileStoryParameters,
} from "./storybook-viewport";
import { MobileComponentFrame } from "./storybook-mobile";

const meta = {
  title: "mpod/mobile/PodcastCard",
  component: PodcastCard,
  tags: ["autodocs"],
  globals: mobileStoryGlobals,
  parameters: mobileStoryParameters,
  args: {
    title: "Decoder Ring",
    description: "Culture stories behind everyday design",
    episodeCountLabel: "2 unlistened episodes",
    artworkUrl: undefined,
    artworkAlt: "Podcast artwork",
  },
  decorators: [
    (Story) => (
      <MobileComponentFrame>
        <Story />
      </MobileComponentFrame>
    ),
  ],
} satisfies Meta<typeof PodcastCard>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Selected: Story = {
  args: {
    selected: true,
  },
};
