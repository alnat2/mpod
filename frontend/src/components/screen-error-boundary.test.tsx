import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

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
  it("keeps surrounding state mounted and retries only the failed screen", async () => {
    const user = userEvent.setup();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
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
});
