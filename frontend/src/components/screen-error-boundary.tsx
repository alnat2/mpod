import { Component, Fragment, type ErrorInfo, type ReactNode } from "react";

import { AppShell } from "@/components/mpod";
import { Button } from "@/components/ui/button";
import { clearCachedAudiobooks, clearCachedSettings } from "@/lib/screen-cache";

type ScreenErrorBoundaryProps = {
  activeNavItem?: string;
  children: ReactNode;
  resetKey: string;
  screenName: string;
};

type ScreenErrorBoundaryState = {
  error: Error | null;
  retryKey: number;
};

export class ScreenErrorBoundary extends Component<
  ScreenErrorBoundaryProps,
  ScreenErrorBoundaryState
> {
  state: ScreenErrorBoundaryState = { error: null, retryKey: 0 };

  static getDerivedStateFromError(error: Error): Partial<ScreenErrorBoundaryState> {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error(`Uncaught ${this.props.screenName} screen error:`, error, errorInfo);
  }

  componentDidUpdate(previousProps: ScreenErrorBoundaryProps) {
    if (
      this.state.error &&
      previousProps.resetKey !== this.props.resetKey
    ) {
      this.setState({ error: null, retryKey: 0 });
    }
  }

  private retry = () => {
    clearCachedAudiobooks();
    clearCachedSettings();
    this.setState((current) => ({
      error: null,
      retryKey: current.retryKey + 1,
    }));
  };

  private handleReload = () => {
    if (typeof window !== "undefined") {
      window.location.href = window.location.origin + window.location.pathname;
    }
  };

  render() {
    if (this.state.error) {
      return (
        <AppShell
          activeNavItem={this.props.activeNavItem}
          pageTitle={this.props.screenName}
          pageHeaderVisible={false}
        >
          <section
            className="flex h-full min-h-[228px] items-center justify-center rounded-md bg-card p-6 text-center md:min-h-[560px] md:rounded-lg md:p-12"
            role="alert"
            aria-atomic="true"
          >
            <div className="flex max-w-md flex-col items-center gap-6 w-full">
              <div className="flex flex-col gap-2 w-full">
                <h1 className="text-lg leading-7 font-medium text-card-foreground">
                  Couldn&apos;t load {this.props.screenName}
                </h1>
                <p className="text-sm leading-5 text-muted-foreground">
                  This screen stopped unexpectedly. Retry it without reloading
                  the rest of mpod, or reload the application.
                </p>

                {this.state.error && (
                  <div
                    className="mt-3 max-h-32 w-full overflow-auto rounded-md bg-muted/60 p-3 text-left font-mono text-xs text-muted-foreground select-all border border-border"
                    role="region"
                    aria-label="Error details"
                  >
                    <div className="font-semibold text-foreground break-words">
                      {this.state.error.name}: {this.state.error.message}
                    </div>
                  </div>
                )}
              </div>

              <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto justify-center">
                <Button type="button" onClick={this.retry}>
                  Retry screen
                </Button>
                <Button variant="outline" type="button" onClick={this.handleReload}>
                  Reload application
                </Button>
              </div>
            </div>
          </section>
        </AppShell>
      );
    }

    return <Fragment key={this.state.retryKey}>{this.props.children}</Fragment>;
  }
}
