import type { Meta, StoryObj } from "@storybook/react-vite";

import { AppShell } from "./app-shell";
import {
  mobileStoryGlobals,
  mobileStoryParameters,
} from "./storybook-viewport";
import { MobileShellFrame } from "./storybook-mobile";

const meta = {
  title: "mpod/mobile/AppShell",
  component: AppShell,
  tags: ["autodocs"],
  globals: mobileStoryGlobals,
  parameters: mobileStoryParameters,
  args: {
    activeNavItem: "Subscriptions",
    pageTitle: "Subscriptions",
    pageSubtitle: "Short description",
    children: <div className="min-h-0 flex-1 rounded-md bg-card" />,
  },
  decorators: [
    (Story) => (
      <MobileShellFrame>
        <Story />
      </MobileShellFrame>
    ),
  ],
} satisfies Meta<typeof AppShell>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};
