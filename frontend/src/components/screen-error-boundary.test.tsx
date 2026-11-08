import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CHUNK_RELOAD_STORAGE_KEY } from "@/lib/lazy-retry";
import { ScreenErrorBoundary } from "./screen-error-boundary";

function ThrowingScreen({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) {
    throw new Error("screen failed");
  }
  return <div>Recovered screen</div>;
}

function RetryHarness() {
  const [shouldThrow, setShouldThrow] = useState(true);

  return (
    <>
      <div>Persistent provider content</div>
      <ScreenErrorBoundary
        activeNavItem="Settings"
        resetKey="/settings"
        screenName="Settings"
      >
        <ThrowingScreen shouldThrow={shouldThrow} />
      </ScreenErrorBoundary>
      <button type="button" onClick={() => setShouldThrow(false)}>
        Repair test screen
      </button>
    </>
  );
}

describe("ScreenErrorBoundary", () => {
  const originalLocation = window.location;

  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    delete (window as any).location;
    window.location = {
      ...originalLocation,
      origin: "http://192.168.0.222:5050",
      pathname: "/subscriptions",
      href: "http://192.168.0.222:5050/subscriptions?initial=true",
    } as any;
  });

  afterEach(() => {
    (window as any).location = originalLocation;
    vi.restoreAllMocks();
  });

  it("keeps surrounding state mounted and retries only the failed screen", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <RetryHarness />
      </MemoryRouter>
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Couldn't load Settings"
    );
    expect(screen.getByText("Persistent provider content")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Repair test screen" }));
    await user.click(screen.getByRole("button", { name: "Retry screen" }));

    expect(screen.getByText("Recovered screen")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText("Persistent provider content")).toBeInTheDocument();
  });

  it("displays diagnostic error details on failure", () => {
    render(
      <MemoryRouter>
        <RetryHarness />
      </MemoryRouter>
    );

    expect(
      screen.getByText("Error: screen failed")
    ).toBeInTheDocument();
  });

  it("triggers hard navigation when 'Reload application' is clicked", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <RetryHarness />
      </MemoryRouter>
    );

    expect(window.location.href).toBe(
      "http://192.168.0.222:5050/subscriptions?initial=true"
    );
    const reloadBtn = screen.getByRole("button", { name: "Reload application" });
    await user.click(reloadBtn);

    expect(window.location.href).toBe("http://192.168.0.222:5050/subscriptions");
  });

  it("resets chunk reload cooldown when 'Retry screen' is clicked", async () => {
    const user = userEvent.setup();
    sessionStorage.setItem(CHUNK_RELOAD_STORAGE_KEY, "12345");

    render(
      <MemoryRouter>
        <RetryHarness />
      </MemoryRouter>
    );

    expect(sessionStorage.getItem(CHUNK_RELOAD_STORAGE_KEY)).toBe("12345");
    const retryBtn = screen.getByRole("button", { name: "Retry screen" });
    await user.click(retryBtn);

    expect(sessionStorage.getItem(CHUNK_RELOAD_STORAGE_KEY)).toBeNull();
  });
});
