import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Tick02Icon } from "@hugeicons/core-free-icons";

import { BottomSheet } from "./bottom-sheet";

describe("BottomSheet", () => {
  it("renders title, subtitle, and applies rounded-t-2xl card styling", () => {
    const handleAction = vi.fn();

    render(
      <BottomSheet
        defaultOpen={true}
        title="Playback speed"
        subtitle="Speed options"
        trigger={<button type="button">Open Speed</button>}
        actions={[
          {
            label: "1.5x",
            icon: Tick02Icon,
            selected: true,
            onClick: handleAction,
          },
        ]}
      />
    );

    expect(screen.getByText("Playback speed")).toBeInTheDocument();
    expect(screen.getByText("Speed options")).toBeInTheDocument();

    const drawerContent = document.querySelector('[data-slot="drawer-content"]');
    expect(drawerContent).toHaveClass("rounded-t-2xl", "bg-card", "border-border");

    const actionButton = screen.getByRole("button", { name: "1.5x" });
    expect(actionButton).toBeInTheDocument();
    fireEvent.click(actionButton);
    expect(handleAction).toHaveBeenCalledTimes(1);
  });
});
