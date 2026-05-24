import type { Preview } from "@storybook/react-vite";

import "../src/index.css";
import { StorybookProviders } from "./storybook-providers";

const preview: Preview = {
  decorators: [
    (Story) => (
      <StorybookProviders>
        <Story />
      </StorybookProviders>
    ),
  ],
  parameters: {
    layout: "padded",
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    options: {
      storySort: {
        order: ["UI", "mpod"],
      },
    },
  },
};

export default preview;
