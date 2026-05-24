import type { Meta, StoryObj } from "@storybook/react-vite";

import { TopNav } from "./top-nav";

const meta = {
  title: "mpod/TopNav",
  component: TopNav,
  tags: ["autodocs"],
  args: {
    activeItem: "Subscriptions",
  },
  render: (args) => (
    <div className="w-full min-w-[1100px] rounded-lg border border-border">
      <TopNav {...args} />
    </div>
  ),
} satisfies Meta<typeof TopNav>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};
