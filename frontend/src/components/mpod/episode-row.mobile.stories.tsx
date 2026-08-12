import type { Meta, StoryObj } from "@storybook/react-vite";

import {
  NoteIcon,
  PauseIcon,
  PlayIcon,
  PlayListAddIcon,
  PlayListRemoveIcon,
  ViewIcon,
} from "@hugeicons/core-free-icons";

import { EpisodeRow } from "./episode-row";
import { featuredEpisode } from "./story-fixtures";
import {
  mobileStoryGlobals,
  mobileStoryParameters,
} from "./storybook-viewport";
import { MobileComponentFrame } from "./storybook-mobile";

const meta = {
  title: "mpod/mobile/EpisodeRow",
  component: EpisodeRow,
  tags: ["autodocs"],
  globals: mobileStoryGlobals,
  parameters: mobileStoryParameters,
  args: {
    layout: "mobile",
    title: featuredEpisode.title,
    podcastTitle: featuredEpisode.podcastTitle,
    dateLabel: "31.03.26",
    durationLabel: "54m",
    showArtwork: false,
    actions: [
      { label: "Add to playlist", icon: PlayListAddIcon },
      { label: "Show notes", icon: NoteIcon },
      { label: "Mark as listened", icon: ViewIcon },
    ],
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
    dateLabel: undefined,
    showDragHandle: true,
    actions: [
      { label: "Remove from playlist", icon: PlayListRemoveIcon },
      { label: "Pause", icon: PauseIcon },
    ],
  },
};

export const Downloaded: Story = {
  args: {
    downloaded: true,
  },
};

export const InPlaylist: Story = {
  args: {
    inPlaylist: true,
    actions: [
      { label: "Remove from playlist", icon: PlayListRemoveIcon },
      { label: "Show notes", icon: NoteIcon },
      { label: "Mark as listened", icon: ViewIcon },
    ],
  },
};

export const DownloadedAndInPlaylist: Story = {
  args: {
    downloaded: true,
    inPlaylist: true,
  },
};

export const PlayerQueued: Story = {
  args: {
    dateLabel: undefined,
    showDragHandle: true,
    actions: [
      { label: "Remove from playlist", icon: PlayListRemoveIcon },
      { label: "Play", icon: PlayIcon },
    ],
  },
};
