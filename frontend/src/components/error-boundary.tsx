import { Component, type ReactNode, type ErrorInfo } from "react";

export const AUTO_RELOAD_KEY = "mpod_last_auto_reload";
export const AUTO_RELOAD_INTERVAL_MS = 10_000;

function safeGetSessionStorage(key: string): string | null {
  try {
    return typeof window !== "undefined" && window.sessionStorage
      ? window.sessionStorage.getItem(key)
      : null;
  } catch {
    return null;
  }
}

function safeSetSessionStorage(key: string, value: string): void {
  try {
    if (typeof window !== "undefined" && window.sessionStorage) {
      window.sessionStorage.setItem(key, value);
    }
  } catch {
    // Ignore quota or security errors
  }
}

export function safeRemoveSessionStorage(key: string): void {
  try {
    if (typeof window !== "undefined" && window.sessionStorage) {
      window.sessionStorage.removeItem(key);
    }
  } catch {
    // Ignore quota or security errors
  }
}

type ErrorBoundaryProps = {
  children: ReactNode;
};

type ErrorBoundaryState = {
  hasError: boolean;
  error?: Error;
};

export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);

    const lastReloadStr = safeGetSessionStorage(AUTO_RELOAD_KEY);
    const now = Date.now();
    const lastReload = lastReloadStr ? parseInt(lastReloadStr, 10) : 0;

    if (!lastReload || isNaN(lastReload) || now - lastReload > AUTO_RELOAD_INTERVAL_MS) {
      safeSetSessionStorage(AUTO_RELOAD_KEY, now.toString());
      if (typeof window !== "undefined") {
        window.location.replace(window.location.origin + window.location.pathname);
      }
    }
  }

  private handleManualReload = () => {
    safeRemoveSessionStorage(AUTO_RELOAD_KEY);
    if (typeof window !== "undefined") {
      window.location.href = window.location.origin + window.location.pathname;
    }
  };

  render() {
    if (this.state.hasError) {
      return (
        <div
          className="flex min-h-screen flex-col items-center justify-center bg-background p-6 text-center text-foreground"
          role="alert"
          aria-atomic="true"
        >
          <div className="flex max-w-md flex-col items-center gap-4 w-full">
            <h1 className="text-2xl font-bold">Something went wrong</h1>
            <p className="text-muted-foreground text-sm">
              An unexpected error occurred. Please reload the page to continue.
            </p>

            {this.state.error && (
              <div
                className="mt-2 max-h-32 w-full overflow-auto rounded-md bg-muted/60 p-3 text-left font-mono text-xs text-muted-foreground select-all border border-border"
                role="region"
                aria-label="Error details"
              >
                <div className="font-semibold text-foreground break-words">
                  {this.state.error.name}: {this.state.error.message}
                </div>
              </div>
            )}

            <button
              type="button"
              onClick={this.handleManualReload}
              className="mt-4 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              Reload application
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
