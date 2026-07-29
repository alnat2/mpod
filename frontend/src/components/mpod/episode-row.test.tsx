import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  DownloadSquare01Icon,
  NoteIcon,
  PlayListRemoveIcon,
  ViewIcon,
} from "@hugeicons/core-free-icons";
import { describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";

import { EpisodeRow } from "./episode-row";

describe("EpisodeRow", () => {
  it("truncates mobile subtitles instead of letting them overflow the row", () => {
    render(
      <TooltipProvider>
        <EpisodeRow
          layout="mobile"
          title="Why your topic isn't a point"
          subtitle="Grammar Girl: For Writers and Language Lovers."
          dateLabel="21.05.26"
          durationLabel="22m"
        />
      </TooltipProvider>
    );

    expect(
      screen.getByText("Grammar Girl: For Writers and Language Lovers.")
    ).toHaveClass("min-w-0", "truncate");
    expect(screen.getByText("22m").parentElement).toHaveClass("w-12");
  });

  it("opens mobile episode actions in the designed bottom sheet order", async () => {
    const user = userEvent.setup();
    const onShowNotes = vi.fn();

    render(
      <TooltipProvider>
        <EpisodeRow
          layout="mobile"
          title="Spec-Driven Development"
          podcastTitle="Podlodka Podcast"
          mobileActions={[
            {
              label: "Remove from playlist",
              icon: PlayListRemoveIcon,
            },
            {
              label: "Show notes",
              icon: NoteIcon,
              onClick: onShowNotes,
            },
            {
              label: "Download",
              icon: DownloadSquare01Icon,
            },
            {
              label: "Mark as listened",
              icon: ViewIcon,
            },
          ]}
        />
      </TooltipProvider>
    );

    await user.click(screen.getByRole("button", { name: "More actions" }));

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("Spec-Driven Development");
    expect(dialog).toHaveTextContent("Podlodka Podcast");
    expect(
      screen
        .getAllByRole("button")
        .filter((button) => button.closest('[role="dialog"]'))
        .map((button) => button.textContent)
    ).toEqual([
      "Remove from playlist",
      "Show notes",
      "Download",
      "Mark as listened",
    ]);

    await user.click(
      screen.getByRole("button", { name: "Show notes" })
    );
    expect(onShowNotes).toHaveBeenCalledOnce();
  });
});
