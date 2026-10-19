export function getActiveNavItem(pathname: string): string {
  if (pathname.startsWith("/subscriptions")) return "Subscriptions";
  if (pathname.startsWith("/audiobooks") || pathname.startsWith("/abooks")) return "Audiobooks";
  if (pathname.startsWith("/settings")) return "Settings";
  return "Player";
}
