import type { ReactNode } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { api, type AuthSession } from "@/lib/api";

import App from "./App";

const setupScreenMock = vi.fn((props?: unknown) => {
  void props;
  return <div>Setup screen</div>;
});
const loginScreenMock = vi.fn((props?: unknown) => {
  void props;
  return <div>Login screen</div>;
});
const subscriptionsScreenMock = vi.fn((props?: unknown) => {
  void props;
  return <div>Subscriptions screen</div>;
});
const homeScreenMock = vi.fn((props?: unknown) => {
  void props;
  return <div>Home screen</div>;
});
const settingsScreenMock = vi.fn((props?: unknown) => {
  void props;
  return <div>Settings screen</div>;
});

vi.mock("@/lib/playback-context", () => ({
  PlaybackProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("@/components/mpod", () => ({
  AuthShell: ({
    headline,
    children,
  }: {
    headline: string;
    children?: ReactNode;
  }) => (
    <div>
      <h1>{headline}</h1>
      {children}
    </div>
  ),
}));

vi.mock("@/screens/auth-screens", () => ({
  SetupScreen: (props: unknown) => setupScreenMock(props),
  LoginScreen: (props: unknown) => loginScreenMock(props),
}));

vi.mock("@/screens/component-preview", () => ({
  ComponentPreview: () => <div>Component preview</div>,
}));

vi.mock("@/screens/home-screen", () => ({
  HomeScreen: () => homeScreenMock(),
}));

vi.mock("@/screens/settings-screen", () => ({
  SettingsScreen: (props: unknown) => settingsScreenMock(props),
}));

vi.mock("@/screens/subscriptions-screen", () => ({
  SubscriptionsScreen: () => subscriptionsScreenMock(),
}));

describe("App routing", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    setupScreenMock.mockClear();
    loginScreenMock.mockClear();
    subscriptionsScreenMock.mockClear();
    homeScreenMock.mockClear();
    settingsScreenMock.mockClear();
    window.history.replaceState({}, "", "/");
  });

  function mockSession(session: AuthSession) {
    vi.spyOn(api.auth, "session").mockResolvedValue(session);
  }

  it("routes setup-required users to setup", async () => {
    mockSession({
      authenticated: false,
      user: null,
      setupRequired: true,
    });

    render(<App />);

    expect(await screen.findByText("Setup screen")).toBeInTheDocument();
  });

  it("routes unauthenticated users to login", async () => {
    mockSession({
      authenticated: false,
      user: null,
      setupRequired: false,
    });

    render(<App />);

    expect(await screen.findByText("Login screen")).toBeInTheDocument();
  });

  it("renders protected routes for authenticated users", async () => {
    window.history.replaceState({}, "", "/settings");
    mockSession({
      authenticated: true,
      user: { id: 1, username: "qa" },
      setupRequired: false,
    });

    render(<App />);

    expect(await screen.findByText("Settings screen")).toBeInTheDocument();
  });

  it("shows a retry screen when session loading fails and recovers on retry", async () => {
    const user = userEvent.setup();
    const sessionSpy = vi
      .spyOn(api.auth, "session")
      .mockRejectedValueOnce(new Error("down"))
      .mockResolvedValueOnce({
        authenticated: true,
        user: { id: 1, username: "qa" },
        setupRequired: false,
      });

    render(<App />);

    expect(await screen.findByText("mpod is not reachable")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => {
      expect(sessionSpy).toHaveBeenCalledTimes(2);
    });
    expect(await screen.findByText("Subscriptions screen")).toBeInTheDocument();
  });
});
