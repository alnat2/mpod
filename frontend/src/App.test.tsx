import { useEffect, type ReactNode } from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { api, ApiError, type AuthSession } from "@/lib/api";
import { SESSION_RETRY_CONFIG } from "@/lib/session-recovery";

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
const playbackProviderMountSpy = vi.fn();
const playbackProviderUnmountSpy = vi.fn();
const playbackProviderMock = vi.fn(
  ({ children }: { children: ReactNode }) => {
    useEffect(() => {
      playbackProviderMountSpy();
      return () => {
        playbackProviderUnmountSpy();
      };
    }, []);
    return <>{children}</>;
  }
);

const reloadQueueMock = vi.fn();

vi.mock("@/lib/playback-context", () => ({
  PlaybackProvider: (props: { children: ReactNode }) => playbackProviderMock(props),
  usePlaybackDispatch: () => ({
    reloadQueue: reloadQueueMock,
  }),
}));

vi.mock("@/components/mpod", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("@/components/mpod");
  return {
    ...actual,
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
    AppShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  };
});

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
    playbackProviderMountSpy.mockClear();
    playbackProviderUnmountSpy.mockClear();
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

    expect(await screen.findByText("Home screen")).toBeInTheDocument();
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
    expect(await screen.findByText("Home screen")).toBeInTheDocument();
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
    expect(await screen.findByText("Home screen")).toBeInTheDocument();

    await act(async () => {
      olderRequest.resolve({
        authenticated: false,
        user: null,
        setupRequired: true,
      });
    });
    expect(screen.getByText("Home screen")).toBeInTheDocument();
    expect(screen.queryByText("Setup screen")).not.toBeInTheDocument();
  });

  it("does not unmount the playback provider or show loading screen on visibilitychange when authenticated", async () => {
    mockSession({
      authenticated: true,
      user: { id: 1, username: "qa" },
      setupRequired: false,
    });

    render(<App />);
    expect(await screen.findByText("Home screen")).toBeInTheDocument();
    expect(playbackProviderMountSpy).toHaveBeenCalledTimes(1);
    expect(playbackProviderUnmountSpy).not.toHaveBeenCalled();

    const sessionSpy = vi.spyOn(api.auth, "session").mockResolvedValueOnce({
      authenticated: true,
      user: { id: 1, username: "qa" },
      setupRequired: false,
    });

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });

    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(sessionSpy).toHaveBeenCalled();
    expect(screen.queryByText("Loading mpod")).not.toBeInTheDocument();
    expect(screen.getByText("Home screen")).toBeInTheDocument();
    expect(playbackProviderMountSpy).toHaveBeenCalledTimes(1);
    expect(playbackProviderUnmountSpy).not.toHaveBeenCalled();
  });

  it("does not unmount the playback provider or flash global loading screen when an authenticated route suspends", async () => {
    let resolveSettings: () => void;
    const settingsPromise = new Promise<void>((resolve) => {
      resolveSettings = resolve;
    });

    settingsScreenMock.mockImplementationOnce(() => {
      throw settingsPromise;
    });

    window.history.replaceState({}, "", "/settings");
    mockSession({
      authenticated: true,
      user: { id: 1, username: "qa" },
      setupRequired: false,
    });

    render(<App />);
    expect(await screen.findByText("Loading...")).toBeInTheDocument();
    expect(screen.queryByText("Checking session")).not.toBeInTheDocument();
    expect(playbackProviderMountSpy).toHaveBeenCalledTimes(1);
    expect(playbackProviderUnmountSpy).not.toHaveBeenCalled();

    await act(async () => {
      resolveSettings!();
    });

    expect(await screen.findByText("Settings screen")).toBeInTheDocument();
    expect(playbackProviderUnmountSpy).not.toHaveBeenCalled();
  });

  it("recovers automatically when initial session request experiences transient network failure", async () => {
    const networkError = new TypeError("Failed to fetch");
    const sessionSpy = vi
      .spyOn(api.auth, "session")
      .mockRejectedValueOnce(networkError)
      .mockResolvedValueOnce({
        authenticated: true,
        user: { id: 1, username: "qa" },
        setupRequired: false,
      });

    render(<App />);

    expect(await screen.findByText("Home screen")).toBeInTheDocument();
    expect(screen.queryByText("mpod is not reachable")).not.toBeInTheDocument();
    expect(sessionSpy).toHaveBeenCalledTimes(2);
  });

  it("recovers automatically when initial session request returns server 502", async () => {
    const server502 = new ApiError("Bad Gateway", "HTTP_ERROR", 502);
    const sessionSpy = vi
      .spyOn(api.auth, "session")
      .mockRejectedValueOnce(server502)
      .mockResolvedValueOnce({
        authenticated: true,
        user: { id: 1, username: "qa" },
        setupRequired: false,
      });

    render(<App />);

    expect(await screen.findByText("Home screen")).toBeInTheDocument();
    expect(sessionSpy).toHaveBeenCalledTimes(2);
  });

  it("does not retry 401 client errors", async () => {
    const unauthError = new ApiError("Unauthorized", "UNAUTHORIZED", 401);
    const sessionSpy = vi
      .spyOn(api.auth, "session")
      .mockRejectedValueOnce(unauthError);

    render(<App />);

    expect(await screen.findByText("mpod is not reachable")).toBeInTheDocument();
    expect(sessionSpy).toHaveBeenCalledTimes(1);
  });

  it("shows retry screen when all transient retry attempts fail", async () => {
    vi.useFakeTimers();
    try {
      const networkError = new TypeError("Failed to fetch");
      const sessionSpy = vi
        .spyOn(api.auth, "session")
        .mockRejectedValue(networkError);

      render(<App />);

      for (const delay of SESSION_RETRY_CONFIG.foreground.backoffDelays) {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(delay);
        });
      }

      expect(screen.getByText("mpod is not reachable")).toBeInTheDocument();
      expect(sessionSpy).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("automatically retries session loading on window online event when session error is displayed", async () => {
    vi.useFakeTimers();
    try {
      const networkError = new TypeError("Failed to fetch");
      const sessionSpy = vi
        .spyOn(api.auth, "session")
        .mockRejectedValue(networkError);

      render(<App />);

      for (const delay of SESSION_RETRY_CONFIG.foreground.backoffDelays) {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(delay);
        });
      }

      expect(screen.getByText("mpod is not reachable")).toBeInTheDocument();
      expect(sessionSpy).toHaveBeenCalledTimes(3);

      sessionSpy.mockResolvedValueOnce({
        authenticated: true,
        user: { id: 1, username: "qa" },
        setupRequired: false,
      });

      await act(async () => {
        window.dispatchEvent(new Event("online"));
      });

      expect(screen.getByText("Home screen")).toBeInTheDocument();
      expect(sessionSpy).toHaveBeenCalledTimes(4);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not trigger extra session loading on window online event when session is already loaded", async () => {
    const sessionSpy = vi.spyOn(api.auth, "session").mockResolvedValue({
      authenticated: true,
      user: { id: 1, username: "qa" },
      setupRequired: false,
    });

    render(<App />);
    expect(await screen.findByText("Home screen")).toBeInTheDocument();
    expect(sessionSpy).toHaveBeenCalledTimes(1);
    sessionSpy.mockClear();

    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });

    expect(sessionSpy).not.toHaveBeenCalled();
  });

  it("cancels ongoing session request when a new session load begins", async () => {
    let callCount = 0;
    let firstSignal: AbortSignal | undefined;

    vi.spyOn(api.auth, "session").mockImplementation(async ({ signal } = {}) => {
      callCount++;
      if (callCount === 2) {
        firstSignal = signal;
        return new Promise((_, reject) => {
          signal?.addEventListener("abort", () => {
            const err = new Error("Aborted");
            err.name = "AbortError";
            reject(err);
          });
        });
      }
      return {
        authenticated: false,
        user: null,
        setupRequired: true,
      };
    });

    render(<App />);

    await screen.findByText("Setup screen");
    const setupProps = setupScreenMock.mock.calls.at(-1)?.[0];
    expect(setupProps?.onAuthenticated).toBeDefined();

    act(() => {
      void setupProps?.onAuthenticated?.();
    });

    await waitFor(() => {
      expect(callCount).toBe(2);
      expect(firstSignal).toBeDefined();
    });

    expect(firstSignal?.aborted).toBe(false);

    act(() => {
      void setupProps?.onAuthenticated?.();
    });

    await waitFor(() => {
      expect(firstSignal?.aborted).toBe(true);
    });
  });

  it("cancels ongoing retry loop during backoff sleep when a new session load begins", async () => {
    let callCount = 0;

    vi.spyOn(api.auth, "session").mockImplementation(async () => {
      callCount++;
      if (callCount === 2) {
        // First retry loop attempt 1 fails
        throw new TypeError("Failed to fetch");
      }
      if (callCount === 3) {
        // New session load succeeds
        return {
          authenticated: true,
          user: { id: 1, username: "qa" },
          setupRequired: false,
        };
      }
      return {
        authenticated: false,
        user: null,
        setupRequired: true,
      };
    });

    render(<App />);

    await screen.findByText("Setup screen");
    const setupProps = setupScreenMock.mock.calls.at(-1)?.[0];
    expect(setupProps?.onAuthenticated).toBeDefined();

    // Start first loadSession which will fail attempt 1 and enter backoff sleep
    act(() => {
      void setupProps?.onAuthenticated?.();
    });

    await waitFor(() => {
      expect(callCount).toBe(2);
    });

    // Start new session load while the first loop is in backoff delay
    act(() => {
      void setupProps?.onAuthenticated?.();
    });

    expect(await screen.findByText("Home screen")).toBeInTheDocument();

    // Wait past the original 400ms backoff to ensure the first loop did not fire attempts 2 and 3
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(callCount).toBe(3);
  });
});
