export function prefetchAllRoutes(): void {
  void import("@/screens/home-screen");
  void import("@/screens/subscriptions-screen");
  void import("@/screens/audiobooks-screen");
  void import("@/screens/settings-screen");
}

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
