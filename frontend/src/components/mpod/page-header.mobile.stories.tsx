import type { Meta, StoryObj } from "@storybook/react-vite";
import { HugeiconsIcon } from "@hugeicons/react";
import { RefreshDotIcon, ViewIcon } from "@hugeicons/core-free-icons";

import { PageHeader } from "./page-header";
import {
  mobileStoryGlobals,
  mobileStoryParameters,
} from "./storybook-viewport";
import { MobileComponentFrame } from "./storybook-mobile";

const meta = {
  title: "mpod/mobile/PageHeader",
  component: PageHeader,
  tags: ["autodocs"],
  globals: mobileStoryGlobals,
  parameters: mobileStoryParameters,
  args: {
    layout: "mobile",
    title: "Subscriptions",
    subtitle: "Short description",
    actions: [
      {
        label: "Refresh all",
        icon: <HugeiconsIcon icon={RefreshDotIcon} />,
      },
      {
        label: "Show all",
        icon: <HugeiconsIcon icon={ViewIcon} />,
        variant: "default",
      },
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
} satisfies Meta<typeof PageHeader>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithoutActions: Story = {
  args: {
    actions: [],
  },
};
