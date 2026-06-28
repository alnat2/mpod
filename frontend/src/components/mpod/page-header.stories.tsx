import type { Meta, StoryObj } from "@storybook/react-vite";
import { HugeiconsIcon } from "@hugeicons/react";
import { RefreshDotIcon, ViewIcon } from "@hugeicons/core-free-icons";

import { PageHeader } from "./page-header";

const meta = {
  title: "mpod/PageHeader",
  component: PageHeader,
  tags: ["autodocs"],
  args: {
    title: "Subscriptions",
    subtitle: "Short description",
    actions: [
      {
        label: "Refresh all",
        icon: <HugeiconsIcon icon={RefreshDotIcon} />,
      },
      {
        label: "Show all",
        icon: <HugeiconsIcon icon={ViewIcon} />,
        variant: "default",
      },
    ],
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
