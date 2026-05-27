import type { Meta, StoryObj } from "@storybook/react-vite";

import { PageHeader } from "./page-header";
import { MobileComponentFrame } from "./storybook-mobile";

const meta = {
  title: "mpod/mobile/PageHeader",
  component: PageHeader,
  tags: ["autodocs"],
  args: {
    layout: "mobile",
    title: "Subscriptions",
    subtitle: "Last refresh · today 3:04",
  },
  decorators: [
    (Story) => (
      <MobileComponentFrame>
        <div className="w-[320px]">
          <Story />
        </div>
      </MobileComponentFrame>
    ),
  ],
} satisfies Meta<typeof PageHeader>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithoutActions: Story = {
  args: {
    actions: [],
  },
};
