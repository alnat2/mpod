import type { Meta, StoryObj } from "@storybook/react-vite";

import { AuthCard } from "./auth-card";

const meta = {
  title: "mpod/AuthCard",
  component: AuthCard,
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
  },
} satisfies Meta<typeof AuthCard>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const ErrorState: Story = {
  args: {
    error: "Username already exists",
  },
};
