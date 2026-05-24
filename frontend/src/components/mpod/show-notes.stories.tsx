import type { Meta, StoryObj } from "@storybook/react-vite";

import { ShowNotes } from "./show-notes";
import { featuredEpisode, showNotesText } from "./story-fixtures";

const meta = {
  title: "mpod/ShowNotes",
  component: ShowNotes,
  tags: ["autodocs"],
  args: {
    podcastTitle: featuredEpisode.podcastTitle,
    episodeTitle: featuredEpisode.title,
    children: showNotesText,
  },
  decorators: [
    (Story) => (
      <div className="w-[720px] max-w-full">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ShowNotes>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};
