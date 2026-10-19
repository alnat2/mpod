import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import { ThemeProvider } from "next-themes";
import { Outlet, Navigate, Route, Routes } from "react-router-dom";
import { BrowserRouter, useLocation } from "react-router-dom";

import { TooltipProvider } from "@/components/ui/tooltip";
import { AppShell, AppShellContext, AuthShell } from "@/components/mpod";
import { AddPodcastModal, type AddPodcastModalMode } from "@/screens/add-podcast-modal";
import { ScreenErrorBoundary } from "@/components/screen-error-boundary";
import {
  api,
  subscribeToUnauthorized,
  type AuthSession,
} from "@/lib/api";
import { useLatestRequest } from "@/lib/use-latest-request";
import { PlaybackProvider } from "@/lib/playback-context";
import { SubscriptionsCacheProvider } from "@/lib/subscriptions-cache-provider";

const SetupScreen = lazy(async () => {
  const module = await import("@/screens/auth-screens");
  return { default: module.SetupScreen };
});

const LoginScreen = lazy(async () => {
  const module = await import("@/screens/auth-screens");
  return { default: module.LoginScreen };
});

const ComponentPreview = lazy(async () => {
  const module = await import("@/screens/component-preview");
  return { default: module.ComponentPreview };
});

const HomeScreen = lazy(async () => {
  const module = await import("@/screens/home-screen");
  return { default: module.HomeScreen };
});

const SettingsScreen = lazy(async () => {
  const module = await import("@/screens/settings-screen");
  return { default: module.SettingsScreen };
});

const SubscriptionsScreen = lazy(async () => {
  const module = await import("@/screens/subscriptions-screen");
  return { default: module.SubscriptionsScreen };
});

const AudiobooksScreen = lazy(async () => {
  const module = await import("@/screens/audiobooks-screen");
  return { default: module.AudiobooksScreen };
});

function LoadingScreen() {
  return (
    <AuthShell headline="Loading mpod">
      <div
        className="text-sm leading-5 text-muted-foreground"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        Checking session
      </div>
    </AuthShell>
  );
}

function SessionErrorScreen({ onRetry }: { onRetry: () => void }) {
  return (
    <AuthShell headline="mpod is not reachable">
      <div role="alert" aria-atomic="true">
        <span className="sr-only">mpod is not reachable.</span>
        <button
          className="rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground"
          type="button"
          onClick={onRetry}
        >
          Retry
        </button>
      </div>
    </AuthShell>
  );
}

function ProtectedRoute({
  authenticated,
  setupRequired,
  children,
}: {
  authenticated: boolean;
  setupRequired: boolean;
  children: ReactNode;
}) {
  if (setupRequired) {
    return <Navigate to="/setup" replace />;
  }

  if (!authenticated) {
    return <Navigate to="/login" replace />;
  }

  return children;
}

function RouteTransition({
  children,
  routeKey,
}: {
  children: ReactNode;
  routeKey: string;
}) {
  return (
    <div
      key={routeKey}
      className="h-full min-h-0 animate-in fade-in-0 slide-in-from-bottom-1 duration-150 ease-out motion-reduce:animate-none motion-reduce:transition-none"
    >
      {children}
    </div>
  );
}

function ScreenLoadingFallback() {
  return (
    <div
      className="flex h-full w-full items-center justify-center p-8 text-sm text-muted-foreground"
      role="status"
      aria-live="polite"
    >
      Loading...
    </div>
  );
}

function PublicLayout() {
  const location = useLocation();
  return (
    <RouteTransition routeKey={location.pathname}>
      <Suspense fallback={<ScreenLoadingFallback />}>
        <Outlet />
      </Suspense>
    </RouteTransition>
  );
}

function AuthenticatedAppLayout() {
  const location = useLocation();
  const [onAddHandler, setOnAddHandler] = useState<(() => void) | undefined>();
  const [addModalMode, setAddModalMode] = useState<AddPodcastModalMode>(null);

  const handleAdd = useCallback(() => {
    if (onAddHandler) {
      onAddHandler();
    } else {
      setAddModalMode("rss");
    }
  }, [onAddHandler]);

  const shellContextValue = useMemo(
    () => ({
      insideAppShell: true,
      setOnAddPodcast: setOnAddHandler,
    }),
    []
  );

  return (
    <AppShellContext.Provider value={shellContextValue}>
      <AppShell
        mainClassName="xl:max-w-[1280px]"
        pageHeaderVisible={false}
        onAddPodcast={handleAdd}
      >
        <RouteTransition routeKey={location.pathname}>
          <Suspense fallback={<ScreenLoadingFallback />}>
            <Outlet />
          </Suspense>
        </RouteTransition>
      </AppShell>
      <AddPodcastModal
        mode={addModalMode}
        onClose={() => setAddModalMode(null)}
        onModeChange={setAddModalMode}
      />
    </AppShellContext.Provider>
  );
}

function AppRoutes() {
  const location = useLocation();
  const [session, setSession] = useState<AuthSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [sessionError, setSessionError] = useState(false);
  const sessionRequests = useLatestRequest();
  const passiveSessionRefreshRef = useRef<Promise<void> | null>(null);

  const loadSession = useCallback(
    async (options: { background?: boolean } = {}) => {
      const isBackground = options.background ?? false;
      const requestGeneration = sessionRequests.beginRequest();
      if (!isBackground) {
        setLoading(true);
        setSessionError(false);
      }
      try {
        const nextSession = await api.auth.session();
        if (sessionRequests.isLatestRequest(requestGeneration)) {
          setSession(nextSession);
        }
      } catch {
        if (sessionRequests.isLatestRequest(requestGeneration)) {
          if (!isBackground) {
            setSessionError(true);
          }
        }
      } finally {
        if (sessionRequests.isLatestRequest(requestGeneration)) {
          if (!isBackground) {
            setLoading(false);
          }
        }
      }
    },
    [sessionRequests]
  );

  const refreshSessionOnce = useCallback(() => {
    if (passiveSessionRefreshRef.current) {
      return;
    }

    const refresh = loadSession({ background: true });
    passiveSessionRefreshRef.current = refresh;
    void refresh.finally(() => {
      if (passiveSessionRefreshRef.current === refresh) {
        passiveSessionRefreshRef.current = null;
      }
    });
  }, [loadSession]);

  useEffect(() => {
    void loadSession();
  }, [loadSession]);

  useEffect(
    () => subscribeToUnauthorized(refreshSessionOnce),
    [refreshSessionOnce]
  );

  useEffect(() => {
    if (!session?.authenticated) {
      return;
    }

    const refreshVisibleSession = () => {
      refreshSessionOnce();
    };
    const refreshRestoredSession = (event: PageTransitionEvent) => {
      if (event.persisted) {
        refreshSessionOnce();
      }
    };
    const refreshForegroundSession = () => {
      if (document.visibilityState === "visible") {
        refreshSessionOnce();
      }
    };

    window.addEventListener("focus", refreshVisibleSession);
    window.addEventListener("pageshow", refreshRestoredSession);
    document.addEventListener("visibilitychange", refreshForegroundSession);

    return () => {
      window.removeEventListener("focus", refreshVisibleSession);
      window.removeEventListener("pageshow", refreshRestoredSession);
      document.removeEventListener(
        "visibilitychange",
        refreshForegroundSession
      );
    };
  }, [refreshSessionOnce, session?.authenticated]);

  if (location.pathname === "/component-preview") {
    return (
      <Suspense fallback={<LoadingScreen />}>
        <Routes>
          <Route path="/component-preview" element={<ComponentPreview />} />
        </Routes>
      </Suspense>
    );
  }

  if (loading) {
    return <LoadingScreen />;
  }

  if (sessionError || !session) {
    return <SessionErrorScreen onRetry={() => void loadSession()} />;
  }

  const authenticated = session.authenticated;
  const setupRequired = session.setupRequired;
  const authenticatedHome = authenticated ? "/subscriptions" : "/login";

  const routes = (
    <Routes>
      <Route element={<PublicLayout />}>
        <Route
          path="/"
          element={
            <Navigate
              to={setupRequired ? "/setup" : authenticatedHome}
              replace
            />
          }
        />
        <Route
          path="/setup"
          element={
            setupRequired ? (
              <SetupScreen onAuthenticated={loadSession} />
            ) : (
              <Navigate to={authenticatedHome} replace />
            )
          }
        />
        <Route
          path="/login"
          element={
            setupRequired ? (
              <Navigate to="/setup" replace />
            ) : authenticated ? (
              <Navigate to="/subscriptions" replace />
            ) : (
              <LoginScreen onAuthenticated={loadSession} />
            )
          }
        />
      </Route>
      <Route element={<AuthenticatedAppLayout />}>
        <Route
          path="/subscriptions"
          element={
            <ProtectedRoute
              authenticated={authenticated}
              setupRequired={setupRequired}
            >
              <ScreenErrorBoundary
                activeNavItem="Subscriptions"
                resetKey={location.pathname}
                screenName="Subscriptions"
              >
                <SubscriptionsScreen />
              </ScreenErrorBoundary>
            </ProtectedRoute>
          }
        />
        <Route
          path="/home"
          element={
            <ProtectedRoute
              authenticated={authenticated}
              setupRequired={setupRequired}
            >
              <ScreenErrorBoundary
                activeNavItem="Player"
                resetKey={location.pathname}
                screenName="Player"
              >
                <HomeScreen />
              </ScreenErrorBoundary>
            </ProtectedRoute>
          }
        />
        <Route
          path="/audiobooks"
          element={
            <ProtectedRoute
              authenticated={authenticated}
              setupRequired={setupRequired}
            >
              <ScreenErrorBoundary
                activeNavItem="Abooks"
                resetKey={location.pathname}
                screenName="Audiobooks"
              >
                <AudiobooksScreen onSessionChange={loadSession} />
              </ScreenErrorBoundary>
            </ProtectedRoute>
          }
        />
        <Route path="/abooks" element={<Navigate to="/audiobooks" replace />} />
        <Route
          path="/settings"
          element={
            <ProtectedRoute
              authenticated={authenticated}
              setupRequired={setupRequired}
            >
              <ScreenErrorBoundary
                activeNavItem="Settings"
                resetKey={location.pathname}
                screenName="Settings"
              >
                <SettingsScreen onSessionChange={loadSession} />
              </ScreenErrorBoundary>
            </ProtectedRoute>
          }
        />
      </Route>
    </Routes>
  );

  const content = authenticated ? (
    <PlaybackProvider>
      <SubscriptionsCacheProvider>{routes}</SubscriptionsCacheProvider>
    </PlaybackProvider>
  ) : (
    routes
  );

  return <Suspense fallback={<LoadingScreen />}>{content}</Suspense>;
}

export default function App() {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <TooltipProvider>
        <BrowserRouter>
          <AppRoutes />
        </BrowserRouter>
      </TooltipProvider>
    </ThemeProvider>
  );
}
