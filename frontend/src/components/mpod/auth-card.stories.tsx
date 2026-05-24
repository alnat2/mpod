import type { Meta, StoryObj } from "@storybook/react-vite";

import { AuthCard } from "./auth-card";

const meta = {
  title: "mpod/AuthCard",
  component: AuthCard,
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <div className="w-[430px] max-w-full">
        <Story />
      </div>
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
