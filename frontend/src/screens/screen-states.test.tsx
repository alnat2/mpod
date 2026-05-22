import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ErrorBanner, ScreenBannerStack, UndoBanner } from "./screen-states";

describe("screen state helpers", () => {
  it("renders error banner content and dismisses it", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    render(<ErrorBanner onClose={onClose}>Failed to update episode</ErrorBanner>);

    expect(screen.getByText("Failed to update episode")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Dismiss error" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renders undo banner countdown and undo action", async () => {
    const user = userEvent.setup();
    const onUndo = vi.fn();

    render(
      <UndoBanner
        expiresAt={Date.now() + 15_000}
        message="Removed from playlist."
        onUndo={onUndo}
      />
    );

    expect(screen.getByText(/Removed from playlist\./)).toBeInTheDocument();
    expect(screen.getByText(/Applying in \d+ sec\./)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(onUndo).toHaveBeenCalledTimes(1);
  });

  it("keeps screen-level banners in a fixed top overlay", () => {
    const { container } = render(
      <ScreenBannerStack>
        <div>Banner content</div>
      </ScreenBannerStack>
    );

    expect(container.firstChild).toHaveClass(
      "fixed",
      "top-[100px]",
      "pointer-events-none"
    );
  });
});
