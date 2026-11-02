import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AUTO_RELOAD_INTERVAL_MS,
  AUTO_RELOAD_KEY,
  ErrorBoundary,
} from "./error-boundary";

function ProblematicComponent({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) {
    throw new Error("Simulated critical render crash");
  }
  return <div>Application content is fine</div>;
}

describe("ErrorBoundary", () => {
  const originalLocation = window.location;

  beforeEach(() => {
    sessionStorage.clear();
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    // Mock window.location
    delete (window as any).location;
    window.location = {
      ...originalLocation,
      origin: "http://192.168.0.222:5050",
      pathname: "/subscriptions",
      href: "http://192.168.0.222:5050/subscriptions",
      replace: vi.fn(),
    } as any;
  });

  afterEach(() => {
    (window as any).location = originalLocation;
    vi.restoreAllMocks();
  });

  it("renders children when no error occurs", () => {
    render(
      <ErrorBoundary>
        <ProblematicComponent shouldThrow={false} />
      </ErrorBoundary>
    );

    expect(screen.getByText("Application content is fine")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("triggers silent auto-reload on first error and sets timestamp in sessionStorage", () => {
    render(
      <ErrorBoundary>
        <ProblematicComponent shouldThrow={true} />
      </ErrorBoundary>
    );

    // Should have attempted location.replace
    expect(window.location.replace).toHaveBeenCalledWith(
      "http://192.168.0.222:5050/subscriptions"
    );

    // Should have recorded timestamp in sessionStorage
    const storedTimestamp = sessionStorage.getItem(AUTO_RELOAD_KEY);
    expect(storedTimestamp).toBeTruthy();
    expect(Number(storedTimestamp)).toBeGreaterThan(0);
  });

  it("shows fallback UI with error diagnostic if auto-reload was already attempted recently", () => {
    // Set reload timestamp to 2 seconds ago (within the 10-second threshold)
    sessionStorage.setItem(AUTO_RELOAD_KEY, (Date.now() - 2000).toString());

    render(
      <ErrorBoundary>
        <ProblematicComponent shouldThrow={true} />
      </ErrorBoundary>
    );

    // Should NOT call replace again to prevent infinite loop
    expect(window.location.replace).not.toHaveBeenCalled();

    // Fallback UI should be visible
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Something went wrong" })).toBeInTheDocument();
    expect(
      screen.getByText(/Error: Simulated critical render crash/)
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Reload application" })
    ).toBeInTheDocument();
  });

  it("clears auto-reload timestamp and triggers hard navigation when 'Reload application' is clicked", async () => {
    const user = userEvent.setup();
    sessionStorage.setItem(AUTO_RELOAD_KEY, (Date.now() - 2000).toString());

    render(
      <ErrorBoundary>
        <ProblematicComponent shouldThrow={true} />
      </ErrorBoundary>
    );

    const reloadButton = screen.getByRole("button", { name: "Reload application" });
    await user.click(reloadButton);

    // Timestamp should be cleared
    expect(sessionStorage.getItem(AUTO_RELOAD_KEY)).toBeNull();

    // Hard navigation via href
    expect(window.location.href).toBe("http://192.168.0.222:5050/subscriptions");
  });

  it("triggers auto-reload again if last reload occurred longer than the threshold", () => {
    // Set reload timestamp to 15 seconds ago (exceeding 10s threshold)
    sessionStorage.setItem(
      AUTO_RELOAD_KEY,
      (Date.now() - AUTO_RELOAD_INTERVAL_MS - 5000).toString()
    );

    render(
      <ErrorBoundary>
        <ProblematicComponent shouldThrow={true} />
      </ErrorBoundary>
    );

    expect(window.location.replace).toHaveBeenCalledWith(
      "http://192.168.0.222:5050/subscriptions"
    );
  });
});
