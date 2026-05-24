import type { Meta, StoryObj } from "@storybook/react-vite";

import { Button } from "./button";

const meta = {
  title: "UI/Button",
  component: Button,
  tags: ["autodocs"],
  args: {
    children: "Button",
    variant: "default",
  },
} satisfies Meta<typeof Button>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Primary: Story = {};

export const Secondary: Story = {
  args: {
    variant: "secondary",
    children: "Secondary action",
  },
};

export const Outline: Story = {
  args: {
    variant: "outline",
    children: "Outline action",
  },
};

export const Ghost: Story = {
  args: {
    variant: "ghost",
    children: "Ghost action",
  },
};
