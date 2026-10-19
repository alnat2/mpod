export function prefetchRoute(href: string): void {
  switch (href) {
    case "/home":
      void import("@/screens/home-screen");
      break;
    case "/subscriptions":
      void import("@/screens/subscriptions-screen");
      break;
    case "/audiobooks":
    case "/abooks":
      void import("@/screens/audiobooks-screen");
      break;
    case "/settings":
      void import("@/screens/settings-screen");
      break;
    default:
      break;
  }
}
