export const mpodMobileViewport = {
  name: "mpod mobile",
  styles: {
    width: "360px",
    height: "800px",
  },
  type: "mobile",
} as const;

export const mobileStoryGlobals = {
  viewport: {
    value: "mpodMobile",
  },
} as const;

export const mobileStoryParameters = {
  viewport: {
    options: {
      mpodMobile: mpodMobileViewport,
    },
  },
} as const;
