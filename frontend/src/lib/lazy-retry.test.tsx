import { Suspense, Component, type ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { lazyWithRetry } from "./lazy-retry";

class CustomErrorBoundary extends Component<
  { children: ReactNode; fallback: (error: Error) => ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return this.props.fallback(this.state.error);
    }
    return this.props.children;
  }
}

describe("lazyWithRetry", () => {
  it("resolves immediately when importer succeeds on first attempt", async () => {
    const Component = () => <div>Success Component</div>;
    const importer = vi.fn().mockResolvedValue({ default: Component });

    const LazyComponent = lazyWithRetry(importer, { retries: 2, delay: 10 });

    render(
      <Suspense fallback={<div>Loading...</div>}>
        <LazyComponent />
      </Suspense>
    );

    expect(screen.getByText("Loading...")).toBeInTheDocument();
    expect(await screen.findByText("Success Component")).toBeInTheDocument();
    expect(importer).toHaveBeenCalledTimes(1);
  });

  it("retries on failure and resolves when subsequent attempt succeeds", async () => {
    const Component = () => <div>Recovered Component</div>;
    const importer = vi
      .fn()
      .mockRejectedValueOnce(new Error("Failed to fetch dynamically imported module"))
      .mockResolvedValueOnce({ default: Component });

    const LazyComponent = lazyWithRetry(importer, { retries: 2, delay: 10 });

    render(
      <Suspense fallback={<div>Loading...</div>}>
        <LazyComponent />
      </Suspense>
    );

    expect(await screen.findByText("Recovered Component")).toBeInTheDocument();
    expect(importer).toHaveBeenCalledTimes(2);
  });

  it("propagates error when all retry attempts fail", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const importer = vi
      .fn()
      .mockRejectedValue(new Error("ChunkLoadError: Network timeout"));

    const LazyComponent = lazyWithRetry(importer, {
      retries: 2,
      delay: 5,
      backoff: false,
    });

    render(
      <CustomErrorBoundary
        fallback={(error) => <div>Caught: {error.message}</div>}
      >
        <Suspense fallback={<div>Loading...</div>}>
          <LazyComponent />
        </Suspense>
      </CustomErrorBoundary>
    );

    expect(
      await screen.findByText("Caught: ChunkLoadError: Network timeout")
    ).toBeInTheDocument();
    expect(importer).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
  });
});
