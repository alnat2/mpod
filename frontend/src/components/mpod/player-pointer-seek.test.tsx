import type { ComponentProps } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";

vi.mock("@/components/ui/slider", () => ({
  Slider: ({
    onValueChange,
    onPointerUp,
    thumbProps,
  }: ComponentProps<"button"> & {
    onValueChange?: (values: number[]) => void;
    thumbProps?: { "aria-label"?: string };
  }) => (
    <button
      type="button"
      role="slider"
      aria-label={thumbProps?.["aria-label"]}
      onPointerDown={() => onValueChange?.([40])}
      onPointerUp={onPointerUp}
    />
  ),
}));

import { Player } from "./player";

describe("Player pointer seeking", () => {
  it("commits a track click even when the slider omits onValueCommit", async () => {
    const user = userEvent.setup();
    const onProgressSeek = vi.fn();

    render(
      <TooltipProvider>
        <Player
          title="Episode"
          podcastTitle="Podcast"
          elapsedLabel="0:00"
          durationLabel="10:00"
          onProgressSeek={onProgressSeek}
        />
      </TooltipProvider>
    );

    await user.click(
      screen.getByRole("slider", { name: "Seek playback position" })
    );

    expect(onProgressSeek).toHaveBeenCalledTimes(1);
    expect(onProgressSeek).toHaveBeenCalledWith(0.4);
  });
});
