import type { Meta, StoryObj } from "@storybook/react-vite";

import { SettingItem } from "./setting-item";
import { settingsAction } from "./story-fixtures";

const meta = {
  title: "mpod/SettingItem",
  component: SettingItem,
  tags: ["autodocs"],
  args: {
    title: "Export OPML",
    description: "Download the current subscription list as an OPML file.",
    action: settingsAction,
  },
  decorators: [
    (Story) => (
      <div className="w-full max-w-[720px]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof SettingItem>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};
