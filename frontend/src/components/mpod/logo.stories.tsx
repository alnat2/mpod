import type { Meta, StoryObj } from "@storybook/react-vite";

import { Logo } from "./logo";

const meta = {
  title: "mpod/Logo",
  component: Logo,
  tags: ["autodocs"],
} satisfies Meta<typeof Logo>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};
