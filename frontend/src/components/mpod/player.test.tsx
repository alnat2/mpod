import { render, screen, within } from "@testing-library/react";
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

  it("exposes an accessible seek slider with keyboard controls", async () => {
    const user = userEvent.setup();
    const onProgressSeek = vi.fn();

    render(
      <TooltipProvider>
        <Player
          title="Episode title"
          podcastTitle="Podcast title"
          elapsedLabel="25:00"
          durationLabel="75:00"
          progressValue={25}
          onProgressSeek={onProgressSeek}
        />
      </TooltipProvider>
    );

    const seekSlider = screen.getByRole("slider", {
      name: "Seek playback position",
    });
    expect(seekSlider).toHaveAttribute("aria-valuemin", "0");
    expect(seekSlider).toHaveAttribute("aria-valuemax", "100");
    expect(seekSlider).toHaveAttribute("aria-valuenow", "25");
    expect(seekSlider).toHaveAttribute(
      "aria-valuetext",
      "25:00 elapsed, 1:15:00 remaining"
    );

    seekSlider.focus();
    await user.keyboard("{ArrowRight}");
    expect(onProgressSeek).toHaveBeenLastCalledWith(0.26);
    expect(seekSlider).toHaveAttribute(
      "aria-valuetext",
      "26:00 elapsed, 1:14:00 remaining"
    );

    await user.keyboard("{End}");
    expect(onProgressSeek).toHaveBeenLastCalledWith(1);

    await user.keyboard("{Home}");
    expect(onProgressSeek).toHaveBeenLastCalledWith(0);
  });
});
