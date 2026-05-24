import type { Meta, StoryObj } from "@storybook/react-vite";

import { FileDropzone } from "./file-dropzone";

const meta = {
  title: "mpod/FileDropzone",
  component: FileDropzone,
  tags: ["autodocs"],
  args: {},
  decorators: [
    (Story) => (
      <div className="w-[720px] max-w-full">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof FileDropzone>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithFile: Story = {
  args: {
    fileName: "subscriptions.opml",
  },
};
