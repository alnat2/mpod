import { render, within } from "@testing-library/react";
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

    const { container } = render(
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

    const mobileControls = container.querySelector(
      '[data-player-controls="mobile"]'
    );
    const mobileNotes = container.querySelector(
      '[data-player-action="mobile-notes"]'
    );

    expect(mobileControls).not.toBeNull();
    expect(mobileNotes).not.toBeNull();

    const mobile = within(mobileControls! as HTMLElement);
    await user.click(
      mobile.getByRole("button", { name: "Go back 15 seconds" })
    );
    await user.click(
      mobile.getByRole("button", { name: "Go forward 30 seconds" })
    );
    await user.click(mobileNotes! as HTMLElement);

    expect(mobile.getByRole("button", { name: "Speed 1.3x" })).toHaveTextContent(
      "1.3"
    );
    expect(mobile.getByText("-15")).toBeInTheDocument();
    expect(mobile.getByText("+30")).toBeInTheDocument();
    expect(onBack).toHaveBeenCalledOnce();
    expect(onForward).toHaveBeenCalledOnce();
    expect(onNotes).toHaveBeenCalledOnce();
  });

  it("matches the desktop player control order and actions", async () => {
    const user = userEvent.setup();
    const onBack = vi.fn();
    const onForward = vi.fn();
    const onNotes = vi.fn();
    const onPlay = vi.fn();

    const { container } = render(
      <TooltipProvider>
        <Player
          title="Why store loyalty cards became a UX minefield"
          podcastTitle="Decoder Ring"
          elapsedLabel="23:14"
          durationLabel="14:03"
          progressValue={49}
          speedLabel="Speed 1.5x"
          notesDisabled={false}
          onBack={onBack}
          onForward={onForward}
          onNotes={onNotes}
          onPlay={onPlay}
        />
      </TooltipProvider>
    );

    const desktopControls = container.querySelector(
      '[data-player-controls="desktop"]'
    );
    expect(desktopControls).not.toBeNull();

    const desktop = within(desktopControls! as HTMLElement);
    const buttons = desktop.getAllByRole("button");
    expect(buttons.map((button) => button.getAttribute("aria-label"))).toEqual([
      "Show notes",
      "Speed 1.5x",
      "Play",
      "Go back 15 seconds",
      "Go forward 30 seconds",
    ]);
    expect(desktop.getByText("Notes")).toBeInTheDocument();
    expect(desktop.getByText("1.5")).toBeInTheDocument();
    expect(desktop.getByText("-15")).toBeInTheDocument();
    expect(desktop.getByText("+30")).toBeInTheDocument();
    expect(
      desktop.getByRole("button", { name: "Play" }).querySelector(
        '[data-player-icon="play"]'
      )
    ).not.toBeNull();

    await user.click(desktop.getByRole("button", { name: "Show notes" }));
    await user.click(desktop.getByRole("button", { name: "Play" }));
    await user.click(
      desktop.getByRole("button", { name: "Go back 15 seconds" })
    );
    await user.click(
      desktop.getByRole("button", { name: "Go forward 30 seconds" })
    );

    expect(onNotes).toHaveBeenCalledOnce();
    expect(onPlay).toHaveBeenCalledOnce();
    expect(onBack).toHaveBeenCalledOnce();
    expect(onForward).toHaveBeenCalledOnce();
  });
});
