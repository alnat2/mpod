import type { Meta, StoryObj } from "@storybook/react-vite";

import {
  DownloadSquare01Icon,
  NoteIcon,
  PlayListRemoveIcon,
  ViewIcon,
} from "@hugeicons/core-free-icons";

import { Button } from "@/components/ui/button";

import { BottomSheet } from "./bottom-sheet";
import {
  mobileStoryGlobals,
  mobileStoryParameters,
} from "./storybook-viewport";
import { MobileComponentFrame } from "./storybook-mobile";

const meta = {
  title: "mpod/mobile/BottomSheet",
  component: BottomSheet,
  tags: ["autodocs"],
  globals: mobileStoryGlobals,
  parameters: mobileStoryParameters,
  args: {
    title: "Podlodka #486 – Spec-Driven Development",
    subtitle: "Podlodka Podcast",
    actions: [
      {
        label: "Remove from playlist",
        icon: PlayListRemoveIcon,
      },
      {
        label: "Show notes",
        icon: NoteIcon,
      },
      {
        label: "Download",
        icon: DownloadSquare01Icon,
      },
      {
        label: "Mark as listened",
        icon: ViewIcon,
      },
    ],
    trigger: <Button type="button">Open bottom sheet</Button>,
  },
  decorators: [
    (Story) => (
      <MobileComponentFrame>
        <Story />
      </MobileComponentFrame>
    ),
  ],
} satisfies Meta<typeof BottomSheet>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Open: Story = {
  args: {
    defaultOpen: true,
  },
};
