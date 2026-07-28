import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";

import { Player } from "./player";

describe("Player", () => {
  it("exposes the mobile seek intervals and show notes action", async () => {
    const user = userEvent.setup();
    const onBack = vi.fn();
    const onForward = vi.fn();
    const onNotes = vi.fn();

    render(
      <TooltipProvider>
        <Player
          title="Episode title"
          podcastTitle="Podcast title"
          elapsedLabel="12:34"
          durationLabel="56:07"
          notesDisabled={false}
          onBack={onBack}
          onForward={onForward}
          onNotes={onNotes}
        />
      </TooltipProvider>
    );

    const backButtons = screen.getAllByRole("button", {
      name: "Go back 15 seconds",
    });
    const forwardButtons = screen.getAllByRole("button", {
      name: "Go forward 30 seconds",
    });
    const speedButton = screen
      .getAllByRole("button", { name: "Speed 1.3x" })
      .find((button) => button.querySelector('[data-player-icon="speed"]'));
    const mobileBackButton = backButtons.find((button) =>
      button.querySelector('[data-player-icon="backward"]')
    );
    const mobileForwardButton = forwardButtons.find((button) =>
      button.querySelector('[data-player-icon="forward"]')
    );

    expect(speedButton).toBeDefined();
    expect(mobileBackButton).toBeDefined();
    expect(mobileForwardButton).toBeDefined();

    await user.click(mobileBackButton!);
    await user.click(mobileForwardButton!);
    await user.click(screen.getByRole("button", { name: "Show notes" }));

    expect(screen.getByText("-15")).toBeInTheDocument();
    expect(screen.getByText("+30")).toBeInTheDocument();
    expect(onBack).toHaveBeenCalledOnce();
    expect(onForward).toHaveBeenCalledOnce();
    expect(onNotes).toHaveBeenCalledOnce();
  });
});
