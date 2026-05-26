import type { Meta, StoryObj } from "@storybook/react-vite";

import { AddPodcast } from "./add-podcast";
import { MobileComponentFrame } from "./storybook-mobile";

const meta = {
  title: "mpod/mobile/AddPodcast",
  component: AddPodcast,
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <MobileComponentFrame>
        <Story />
      </MobileComponentFrame>
    ),
  ],
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
