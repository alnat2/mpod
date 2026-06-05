import type { Meta, StoryObj } from "@storybook/react-vite";

import { AuthShell } from "./auth-shell";
import { MobileShellFrame } from "./storybook-mobile";

const meta = {
  title: "mpod/mobile/AuthShell",
  component: AuthShell,
  tags: ["autodocs"],
  args: {
    headline: "Create the only account for your podcast library",
    className: "min-h-0 h-full",
  },
  decorators: [
    (Story) => (
      <MobileShellFrame>
        <Story />
      </MobileShellFrame>
    ),
  ],
} satisfies Meta<typeof AuthShell>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Setup: Story = {};

export const Login: Story = {
  args: {
    headline: "Log in and keep listening",
  },
};
