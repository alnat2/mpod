import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { ThemeProvider } from "next-themes";
import { Navigate, Route, Routes } from "react-router-dom";
import { BrowserRouter, useLocation } from "react-router-dom";

import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthShell } from "@/components/mpod";
import { api, type AuthSession } from "@/lib/api";
import { useLatestRequest } from "@/lib/use-latest-request";
import { SubscriptionsCacheProvider } from "@/lib/subscriptions-cache-provider";

const AuthenticatedPlaybackProvider = lazy(async () => {
  const module = await import("@/lib/playback-context");
  return { default: module.PlaybackProvider };
});

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

function AppRoutes() {
  const location = useLocation();
  const [session, setSession] = useState<AuthSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [sessionError, setSessionError] = useState(false);
  const sessionRequests = useLatestRequest();

  const loadSession = useCallback(async () => {
    const requestGeneration = sessionRequests.beginRequest();
    setLoading(true);
    setSessionError(false);
    try {
      const nextSession = await api.auth.session();
      if (sessionRequests.isLatestRequest(requestGeneration)) {
        setSession(nextSession);
      }
    } catch {
      if (sessionRequests.isLatestRequest(requestGeneration)) {
        setSessionError(true);
      }
    } finally {
      if (sessionRequests.isLatestRequest(requestGeneration)) {
        setLoading(false);
      }
    }
  }, [sessionRequests]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void loadSession();
    }, 0);

    return () => window.clearTimeout(timeout);
  }, [loadSession]);

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
    <RouteTransition routeKey={location.pathname}>
      <Routes>
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
          <Route
            path="/subscriptions"
            element={
              <ProtectedRoute
                authenticated={authenticated}
                setupRequired={setupRequired}
              >
                <SubscriptionsScreen />
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
                <HomeScreen />
              </ProtectedRoute>
            }
          />
          <Route
            path="/settings"
            element={
              <ProtectedRoute
                authenticated={authenticated}
                setupRequired={setupRequired}
              >
                <SettingsScreen onSessionChange={loadSession} />
              </ProtectedRoute>
            }
          />
      </Routes>
    </RouteTransition>
  );

  return (
    <Suspense fallback={<LoadingScreen />}>
      {authenticated ? (
        <AuthenticatedPlaybackProvider>
          <SubscriptionsCacheProvider>{routes}</SubscriptionsCacheProvider>
        </AuthenticatedPlaybackProvider>
      ) : (
        routes
      )}
    </Suspense>
  );
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
