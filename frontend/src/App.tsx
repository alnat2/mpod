import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { BrowserRouter, useLocation } from "react-router-dom";

import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthShell } from "@/components/mpod";
import { api, type AuthSession } from "@/lib/api";
import { LoginScreen, SetupScreen } from "@/screens/auth-screens";
import { ComponentPreview } from "@/screens/component-preview";
import { HomeScreen } from "@/screens/home-screen";
import { SettingsScreen } from "@/screens/settings-screen";
import { SubscriptionsScreen } from "@/screens/subscriptions-screen";

function LoadingScreen() {
  return (
    <AuthShell headline="Loading mpod">
      <div className="text-sm leading-5 text-muted-foreground">
        Checking session
      </div>
    </AuthShell>
  );
}

function SessionErrorScreen({ onRetry }: { onRetry: () => void }) {
  return (
    <AuthShell headline="mpod is not reachable">
      <button
        className="rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground"
        type="button"
        onClick={onRetry}
      >
        Retry
      </button>
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

function AppRoutes() {
  const location = useLocation();
  const [session, setSession] = useState<AuthSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [sessionError, setSessionError] = useState(false);

  const loadSession = useCallback(async () => {
    setLoading(true);
    setSessionError(false);
    try {
      setSession(await api.auth.session());
    } catch {
      setSessionError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void loadSession();
    }, 0);

    return () => window.clearTimeout(timeout);
  }, [loadSession]);

  if (location.pathname === "/component-preview") {
    return (
      <Routes>
        <Route path="/component-preview" element={<ComponentPreview />} />
      </Routes>
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

  return (
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
  );
}

export default function App() {
  return (
    <TooltipProvider>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </TooltipProvider>
  );
}
