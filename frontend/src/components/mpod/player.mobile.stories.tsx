import type { Meta, StoryObj } from "@storybook/react-vite";

import { Player } from "./player";
import { featuredEpisode } from "./story-fixtures";
import {
  mobileStoryGlobals,
  mobileStoryParameters,
} from "./storybook-viewport";
import { MobileComponentFrame } from "./storybook-mobile";

const meta = {
  title: "mpod/mobile/Player",
  component: Player,
  tags: ["autodocs"],
  globals: mobileStoryGlobals,
  parameters: mobileStoryParameters,
  args: {
    title: featuredEpisode.title,
    podcastTitle: featuredEpisode.podcastTitle,
    artworkUrl: featuredEpisode.artworkUrl,
    artworkAlt: featuredEpisode.artworkAlt,
    elapsedLabel: featuredEpisode.elapsedLabel,
    durationLabel: featuredEpisode.durationLabel,
    progressValue: featuredEpisode.progressValue,
    speedLabel: "Speed 1.5x",
    notesDisabled: false,
  },
  decorators: [
    (Story) => (
      <MobileComponentFrame>
        <Story />
      </MobileComponentFrame>
    ),
  ],
} satisfies Meta<typeof Player>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Playing: Story = {
  args: {
    playing: true,
  },
};
