import type { Meta, StoryObj } from "@storybook/react-vite";

import { AuthCard } from "./auth-card";
import { MobileComponentFrame } from "./storybook-mobile";

const meta = {
  title: "mpod/mobile/AuthCard",
  component: AuthCard,
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <MobileComponentFrame>
        <Story />
      </MobileComponentFrame>
    ),
  ],
} satisfies Meta<typeof AuthCard>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const ErrorState: Story = {
  args: {
    error: "Username already exists",
  },
};
