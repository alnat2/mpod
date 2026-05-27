import type { Meta, StoryObj } from "@storybook/react-vite";

import { MoreVerticalIcon } from "@hugeicons/core-free-icons";

import { EpisodeRow } from "./episode-row";
import { featuredEpisode } from "./story-fixtures";
import { MobileComponentFrame } from "./storybook-mobile";

const meta = {
  title: "mpod/mobile/EpisodeRow",
  component: EpisodeRow,
  tags: ["autodocs"],
  args: {
    layout: "mobile",
    title: featuredEpisode.title,
    podcastTitle: featuredEpisode.podcastTitle,
    dateLabel: "31.03.26",
    durationLabel: "54m",
    showArtwork: false,
    mobileMenuAction: {
      label: "More actions",
      icon: MoreVerticalIcon,
    },
  },
  decorators: [
    (Story) => (
      <MobileComponentFrame>
        <div className="w-[320px]">
          <Story />
        </div>
      </MobileComponentFrame>
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
