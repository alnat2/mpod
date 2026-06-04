import type { Preview } from "@storybook/react-vite";

import { mpodMobileViewport } from "../src/components/mpod/storybook-viewport";
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
    viewport: {
      options: {
        mpodMobile: mpodMobileViewport,
      },
    },
  },
};

export default preview;
