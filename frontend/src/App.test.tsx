import type { ReactNode } from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { api, type AuthSession } from "@/lib/api";

import App from "./App";

const setupScreenMock = vi.fn(
  (props?: { onAuthenticated?: () => void | Promise<void> }) => (
    <div>
      Setup screen
      <button
        type="button"
        onClick={() => void props?.onAuthenticated?.()}
      >
        Reload session
      </button>
    </div>
  )
);
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
const playbackProviderMock = vi.fn(
  ({ children }: { children: ReactNode }) => <>{children}</>
);

vi.mock("@/lib/playback-context", () => ({
  PlaybackProvider: (props: { children: ReactNode }) => playbackProviderMock(props),
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
  SetupScreen: (props: { onAuthenticated?: () => void | Promise<void> }) =>
    setupScreenMock(props),
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
  function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((promiseResolve) => {
      resolve = promiseResolve;
    });

    return { promise, resolve };
  }

  beforeEach(() => {
    vi.restoreAllMocks();
    setupScreenMock.mockClear();
    loginScreenMock.mockClear();
    subscriptionsScreenMock.mockClear();
    homeScreenMock.mockClear();
    settingsScreenMock.mockClear();
    playbackProviderMock.mockClear();
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
    expect(playbackProviderMock).not.toHaveBeenCalled();
  });

  it("does not start playback loading before session authentication completes", async () => {
    let resolveSession: (session: AuthSession) => void;
    vi.spyOn(api.auth, "session").mockReturnValue(
      new Promise<AuthSession>((resolve) => {
        resolveSession = resolve;
      })
    );

    render(<App />);

    expect(await screen.findByText("Loading mpod")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Checking session");
    expect(playbackProviderMock).not.toHaveBeenCalled();

    resolveSession!({
      authenticated: true,
      user: { id: 1, username: "qa" },
      setupRequired: false,
    });

    expect(await screen.findByText("Subscriptions screen")).toBeInTheDocument();
    expect(playbackProviderMock).toHaveBeenCalled();
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

  it("drops protected UI and routes to login after an API 401", async () => {
    window.history.replaceState({}, "", "/subscriptions");
    const sessionSpy = vi
      .spyOn(api.auth, "session")
      .mockResolvedValueOnce({
        authenticated: true,
        user: { id: 1, username: "qa" },
        setupRequired: false,
      })
      .mockResolvedValueOnce({
        authenticated: false,
        user: null,
        setupRequired: false,
      });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: "UNAUTHORIZED",
            message: "Authentication is required",
          },
        }),
        {
          status: 401,
          headers: { "Content-Type": "application/json" },
        }
      )
    );

    render(<App />);
    expect(await screen.findByText("Subscriptions screen")).toBeInTheDocument();

    await expect(api.podcasts.list()).rejects.toMatchObject({ status: 401 });

    expect(await screen.findByText("Login screen")).toBeInTheDocument();
    expect(screen.queryByText("Subscriptions screen")).not.toBeInTheDocument();
    expect(sessionSpy).toHaveBeenCalledTimes(2);
  });

  it("rechecks an authenticated session when a cached page is restored", async () => {
    window.history.replaceState({}, "", "/settings");
    const sessionSpy = vi
      .spyOn(api.auth, "session")
      .mockResolvedValueOnce({
        authenticated: true,
        user: { id: 1, username: "qa" },
        setupRequired: false,
      })
      .mockResolvedValueOnce({
        authenticated: false,
        user: null,
        setupRequired: false,
      });

    render(<App />);
    expect(await screen.findByText("Settings screen")).toBeInTheDocument();

    act(() => {
      window.dispatchEvent(
        Object.assign(new Event("pageshow"), { persisted: true })
      );
    });

    expect(await screen.findByText("Login screen")).toBeInTheDocument();
    expect(screen.queryByText("Settings screen")).not.toBeInTheDocument();
    expect(sessionSpy).toHaveBeenCalledTimes(2);
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
    expect(screen.getByRole("alert")).toHaveTextContent("mpod is not reachable");

    await user.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => {
      expect(sessionSpy).toHaveBeenCalledTimes(2);
    });
    expect(await screen.findByText("Subscriptions screen")).toBeInTheDocument();
  });

  it("does not let an older session response replace a newer one", async () => {
    const olderRequest = deferred<AuthSession>();
    const newerRequest = deferred<AuthSession>();
    vi.spyOn(api.auth, "session")
      .mockResolvedValueOnce({
        authenticated: false,
        user: null,
        setupRequired: true,
      })
      .mockReturnValueOnce(olderRequest.promise)
      .mockReturnValueOnce(newerRequest.promise);

    render(<App />);
    await screen.findByText("Setup screen");
    const setupProps = setupScreenMock.mock.calls.at(-1)?.[0];
    expect(setupProps?.onAuthenticated).toBeDefined();
    act(() => {
      void setupProps?.onAuthenticated?.();
      void setupProps?.onAuthenticated?.();
    });

    await act(async () => {
      newerRequest.resolve({
        authenticated: true,
        user: { id: 1, username: "qa" },
        setupRequired: false,
      });
    });
    expect(await screen.findByText("Subscriptions screen")).toBeInTheDocument();

    await act(async () => {
      olderRequest.resolve({
        authenticated: false,
        user: null,
        setupRequired: true,
      });
    });
    expect(screen.getByText("Subscriptions screen")).toBeInTheDocument();
    expect(screen.queryByText("Setup screen")).not.toBeInTheDocument();
  });
});
