import type { Meta, StoryObj } from "@storybook/react-vite";

import { PageHeader } from "./page-header";

const meta = {
  title: "mpod/PageHeader",
  component: PageHeader,
  tags: ["autodocs"],
  args: {
    title: "Subscriptions",
    subtitle: "Short description",
  },
  render: (args) => (
    <div className="w-full max-w-[1200px]">
      <PageHeader {...args} />
    </div>
  ),
} satisfies Meta<typeof PageHeader>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithoutActions: Story = {
  args: {
    actions: [],
  },
};
