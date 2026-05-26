import type { Meta, StoryObj } from "@storybook/react-vite";

import { ShowNotes } from "./show-notes";
import { featuredEpisode, showNotesText } from "./story-fixtures";
import { MobileComponentFrame } from "./storybook-mobile";

const meta = {
  title: "mpod/mobile/ShowNotes",
  component: ShowNotes,
  tags: ["autodocs"],
  args: {
    podcastTitle: featuredEpisode.podcastTitle,
    episodeTitle: featuredEpisode.title,
    children: showNotesText,
  },
  decorators: [
    (Story) => (
      <MobileComponentFrame>
        <Story />
      </MobileComponentFrame>
    ),
  ],
} satisfies Meta<typeof ShowNotes>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};
