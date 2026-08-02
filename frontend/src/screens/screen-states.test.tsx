import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import {
  CenterLoadingState,
  ErrorBanner,
  ListLoadingState,
  ScreenBannerStack,
  UndoBanner,
} from "./screen-states";

describe("screen state helpers", () => {
  it("renders error banner content and dismisses it", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    render(<ErrorBanner onClose={onClose}>Failed to update episode</ErrorBanner>);

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Failed to update episode");
    expect(alert).toHaveAttribute("aria-atomic", "true");
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

    expect(screen.getByText(/Applying in \d+ sec\./)).toBeInTheDocument();
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent(
      /Removed from playlist\. Undo available for \d+ seconds\./
    );
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(screen.getByText(/Applying in \d+ sec\./)).toHaveAttribute(
      "aria-hidden",
      "true"
    );

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
      "top-[56px]",
      "pointer-events-none"
    );
  });

  it("announces loading states politely", () => {
    render(
      <>
        <ListLoadingState label="Loading subscriptions" />
        <CenterLoadingState label="Loading playlist" />
      </>
    );

    const statuses = screen.getAllByRole("status");
    expect(statuses).toHaveLength(2);
    for (const status of statuses) {
      expect(status).toHaveAttribute("aria-live", "polite");
      expect(status).toHaveAttribute("aria-busy", "true");
      expect(status).toHaveAttribute("aria-atomic", "true");
    }
  });
});
