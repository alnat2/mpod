import { Suspense, Component, type ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  CHUNK_RELOAD_STORAGE_KEY,
  isChunkLoadError,
  lazyWithRetry,
  triggerChunkReload,
} from "./lazy-retry";

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
  beforeEach(() => {
    vi.restoreAllMocks();
    sessionStorage.clear();
  });

  it("identifies chunk load errors correctly", () => {
    expect(isChunkLoadError(new Error("Failed to fetch dynamically imported module: http://example.com/asset.js"))).toBe(true);
    expect(isChunkLoadError(new Error("error loading dynamically imported module"))).toBe(true);
    expect(isChunkLoadError(new Error("Importing a module script failed."))).toBe(true);
    expect(isChunkLoadError(new Error("ChunkLoadError: Loading chunk 4 failed"))).toBe(true);
    expect(isChunkLoadError(new Error("TypeError: Failed to load resource: the server responded with a status of 404 (module)"))).toBe(true);
    // Safari-specific TypeError: Load failed
    expect(isChunkLoadError(new TypeError("Load failed"))).toBe(true);
    const customTypeError = new Error("Load failed");
    customTypeError.name = "TypeError";
    expect(isChunkLoadError(customTypeError)).toBe(true);

    // Negative tests: generic Error or other messages should not match
    expect(isChunkLoadError(new Error("Load failed"))).toBe(false);
    expect(isChunkLoadError(new Error("Failed to load module script: Expected a JavaScript module script but the server responded with a MIME type of \"text/html\""))).toBe(false);
    expect(isChunkLoadError(new TypeError("Network request failed"))).toBe(false);
    expect(isChunkLoadError(new Error("ReferenceError: foo is not defined"))).toBe(false);
    expect(isChunkLoadError(null)).toBe(false);
  });

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
      .mockRejectedValueOnce(new Error("Temporary network glitch"))
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

  it("propagates error when autoReload is false and all retries fail", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const importer = vi
      .fn()
      .mockRejectedValue(new Error("ChunkLoadError: Network timeout"));

    const LazyComponent = lazyWithRetry(importer, {
      retries: 2,
      delay: 5,
      backoff: false,
      autoReload: false,
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

  it("triggers onReload on chunk load error after retries fail", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const onReload = vi.fn();
    const importer = vi
      .fn()
      .mockRejectedValue(
        new Error("Failed to fetch dynamically imported module: /assets/test.js")
      );

    const LazyComponent = lazyWithRetry(importer, {
      retries: 1,
      delay: 5,
      backoff: false,
      onReload,
    });

    render(
      <CustomErrorBoundary fallback={(error) => <div>Caught: {error.message}</div>}>
        <Suspense fallback={<div>Loading chunk...</div>}>
          <LazyComponent />
        </Suspense>
      </CustomErrorBoundary>
    );

    expect(screen.getByText("Loading chunk...")).toBeInTheDocument();
    await vi.waitFor(() => {
      expect(onReload).toHaveBeenCalledTimes(1);
    });

    // Session storage timestamp was recorded
    expect(sessionStorage.getItem(CHUNK_RELOAD_STORAGE_KEY)).toBeTruthy();
    // Error screen was not shown because page is reloading
    expect(screen.queryByText(/Caught:/)).not.toBeInTheDocument();
  });

  it("does not trigger infinite reload if chunk reload was already attempted within cooldown", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const onReload = vi.fn();
    // Simulate a reload that occurred 2 seconds ago
    sessionStorage.setItem(CHUNK_RELOAD_STORAGE_KEY, (Date.now() - 2000).toString());

    const importer = vi
      .fn()
      .mockRejectedValue(
        new Error("Failed to fetch dynamically imported module: /assets/test.js")
      );

    const LazyComponent = lazyWithRetry(importer, {
      retries: 1,
      delay: 5,
      backoff: false,
      onReload,
    });

    render(
      <CustomErrorBoundary fallback={(error) => <div>Caught: {error.message}</div>}>
        <Suspense fallback={<div>Loading chunk...</div>}>
          <LazyComponent />
        </Suspense>
      </CustomErrorBoundary>
    );

    // Propagates error to boundary so user sees error screen with retry
    expect(
      await screen.findByText(
        "Caught: Failed to fetch dynamically imported module: /assets/test.js"
      )
    ).toBeInTheDocument();
    // Verified after awaiting final render state to prevent premature assertions
    expect(onReload).not.toHaveBeenCalled();
  });

  it("does not reload on non-chunk errors and propagates directly to boundary", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const onReload = vi.fn();
    const importer = vi
      .fn()
      .mockRejectedValue(new Error("Cannot find variable: someMissingVar"));

    const LazyComponent = lazyWithRetry(importer, {
      retries: 1,
      delay: 5,
      backoff: false,
      onReload,
    });

    render(
      <CustomErrorBoundary fallback={(error) => <div>Caught: {error.message}</div>}>
        <Suspense fallback={<div>Loading chunk...</div>}>
          <LazyComponent />
        </Suspense>
      </CustomErrorBoundary>
    );

    expect(
      await screen.findByText("Caught: Cannot find variable: someMissingVar")
    ).toBeInTheDocument();
    expect(onReload).not.toHaveBeenCalled();
  });

  it("does not reload and returns false when sessionStorage is unavailable or throws", () => {
    const onReload = vi.fn();
    const storageSpy = vi.spyOn(window, "sessionStorage", "get").mockImplementation(() => {
      throw new Error("SecurityError: The operation is insecure.");
    });

    const result = triggerChunkReload(onReload);
    expect(result).toBe(false);
    expect(onReload).not.toHaveBeenCalled();

    storageSpy.mockRestore();
  });

  it("falls back to throwing error if reloadFallbackTimeoutMs expires", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const onReload = vi.fn();
    const importer = vi
      .fn()
      .mockRejectedValue(
        new Error("Failed to fetch dynamically imported module: /assets/test.js")
      );

    const LazyComponent = lazyWithRetry(importer, {
      retries: 1,
      delay: 5,
      backoff: false,
      onReload,
      reloadFallbackTimeoutMs: 50,
    });

    render(
      <CustomErrorBoundary fallback={(error) => <div>Caught: {error.message}</div>}>
        <Suspense fallback={<div>Loading chunk...</div>}>
          <LazyComponent />
        </Suspense>
      </CustomErrorBoundary>
    );

    expect(screen.getByText("Loading chunk...")).toBeInTheDocument();
    await vi.waitFor(() => {
      expect(onReload).toHaveBeenCalledTimes(1);
    });

    // After fallback timeout expires, error should be caught by boundary
    expect(
      await screen.findByText(
        "Caught: Failed to fetch dynamically imported module: /assets/test.js"
      )
    ).toBeInTheDocument();
  });
});
