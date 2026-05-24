import type { Meta, StoryObj } from "@storybook/react-vite";

import { Input } from "./input";

const meta = {
  title: "UI/Input",
  component: Input,
  tags: ["autodocs"],
  args: {
    placeholder: "Type here",
  },
  decorators: [
    (Story) => (
      <div className="w-full max-w-sm">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Input>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Disabled: Story = {
  args: {
    value: "Locked value",
    disabled: true,
  },
};
