function safeImport(importer: () => Promise<unknown>): void {
  void importer().catch((error) => {
    console.debug("Prefetch failed:", error);
  });
}

export function prefetchAllRoutes(): void {
  safeImport(() => import("@/screens/home-screen"));
  safeImport(() => import("@/screens/subscriptions-screen"));
  safeImport(() => import("@/screens/audiobooks-screen"));
  safeImport(() => import("@/screens/settings-screen"));
}

export function prefetchRoute(href: string): void {
  switch (href) {
    case "/home":
      safeImport(() => import("@/screens/home-screen"));
      break;
    case "/subscriptions":
      safeImport(() => import("@/screens/subscriptions-screen"));
      break;
    case "/audiobooks":
    case "/abooks":
      safeImport(() => import("@/screens/audiobooks-screen"));
      break;
    case "/settings":
      safeImport(() => import("@/screens/settings-screen"));
      break;
    default:
      break;
  }
}
