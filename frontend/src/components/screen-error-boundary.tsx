import { Component, Fragment, type ErrorInfo, type ReactNode } from "react";

import { AppShell } from "@/components/mpod";
import { Button } from "@/components/ui/button";

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

  static getDerivedStateFromError(error: Error): ScreenErrorBoundaryState {
    return { error, retryKey: 0 };
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
    this.setState((current) => ({
      error: null,
      retryKey: current.retryKey + 1,
    }));
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
            <div className="flex max-w-96 flex-col items-center gap-6">
              <div className="flex flex-col gap-2">
                <h1 className="text-lg leading-7 font-medium text-card-foreground">
                  Couldn&apos;t load {this.props.screenName}
                </h1>
                <p className="text-sm leading-5 text-muted-foreground">
                  This screen stopped unexpectedly. Retry it without reloading
                  the rest of mpod.
                </p>
              </div>
              <Button type="button" onClick={this.retry}>
                Retry screen
              </Button>
            </div>
          </section>
        </AppShell>
      );
    }

    return <Fragment key={this.state.retryKey}>{this.props.children}</Fragment>;
  }
}
