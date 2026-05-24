import type { Meta, StoryObj } from "@storybook/react-vite";

import { AddPodcast } from "./add-podcast";

const meta = {
  title: "mpod/AddPodcast",
  component: AddPodcast,
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
  },
} satisfies Meta<typeof AddPodcast>;

export default meta;

type Story = StoryObj<typeof meta>;

export const RssMode: Story = {};

export const OpmlMode: Story = {
  args: {
    mode: "opml",
    onModeChange: () => undefined,
  },
};
