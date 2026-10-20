import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { api, type AuthSession } from "@/lib/api";

import App from "./App";

vi.mock("@/screens/auth-screens", () => ({
  SetupScreen: () => <div>Setup screen</div>,
  LoginScreen: () => <div>Login screen</div>,
}));

vi.mock("@/screens/subscriptions-screen", () => ({
  SubscriptionsScreen: () => <div>Subscriptions screen content</div>,
}));

vi.mock("@/screens/home-screen", () => ({
  HomeScreen: () => <div>Home screen content</div>,
}));

vi.mock("@/screens/settings-screen", () => ({
  SettingsScreen: () => <div>Settings screen content</div>,
}));

vi.mock("@/screens/audiobooks-screen", () => ({
  AudiobooksScreen: () => <div>Audiobooks screen content</div>,
}));

vi.mock("@/lib/playback-context", () => ({
  PlaybackProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  usePlaybackDispatch: () => ({
    reloadQueue: vi.fn(),
  }),
}));

describe("App persistent layout navigation", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    window.history.replaceState({}, "", "/subscriptions");
  });

  function mockSession(session: AuthSession) {
    vi.spyOn(api.auth, "session").mockResolvedValue(session);
  }

  it("renders desktop TopNav and mobile BottomNav for authenticated users", async () => {
    mockSession({
      authenticated: true,
      user: { id: 1, username: "qa" },
      setupRequired: false,
    });

    render(<App />);

    expect(await screen.findByText("Subscriptions screen content")).toBeInTheDocument();

    const navs = screen.getAllByRole("navigation", { name: "Primary navigation" });
    expect(navs).toHaveLength(2);

    const mobileBottomNav = navs.find((nav) => nav.classList.contains("md:hidden"));
    expect(mobileBottomNav).toBeDefined();
    expect(mobileBottomNav).toHaveClass("fixed", "bottom-0");

    // Verify nav links inside mobile BottomNav
    const playerLink = mobileBottomNav?.querySelector('a[href="/home"]');
    expect(playerLink).toBeInTheDocument();
    expect(playerLink).toHaveTextContent("Player");

    const podcastsLink = mobileBottomNav?.querySelector('a[href="/subscriptions"]');
    expect(podcastsLink).toBeInTheDocument();
    expect(podcastsLink).toHaveTextContent("Podcasts");

    const abooksLink = mobileBottomNav?.querySelector('a[href="/audiobooks"]');
    expect(abooksLink).toBeInTheDocument();
    expect(abooksLink).toHaveTextContent("Abooks");

    const settingsLink = mobileBottomNav?.querySelector('a[href="/settings"]');
    expect(settingsLink).toBeInTheDocument();
    expect(settingsLink).toHaveTextContent("Settings");

    // Podcasts tab is active on /subscriptions
    expect(podcastsLink?.querySelector(".text-primary")).toBeInTheDocument();

    // Verify desktop TopNav active state
    const desktopNav = navs.find((nav) => !nav.classList.contains("md:hidden"));
    expect(desktopNav).toBeDefined();
    const activeDesktopBtn = desktopNav?.querySelector('a[href="/subscriptions"]');
    expect(activeDesktopBtn).toHaveClass("font-semibold");
  });
});
