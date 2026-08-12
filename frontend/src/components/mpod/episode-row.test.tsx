import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  NoteIcon,
  PlayListRemoveIcon,
  ViewIcon,
} from "@hugeicons/core-free-icons";
import { describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import { expectNoA11yViolations } from "@/test/axe";

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

  it("replaces mobile status text with the exact downloaded and playlist icons", () => {
    const { container } = render(
      <TooltipProvider>
        <EpisodeRow
          downloaded
          inPlaylist
          layout="mobile"
          title="Why store loyalty cards became a UX minefield"
          podcastTitle="Decoder Ring"
          subtitle="Downloaded · In playlist"
          dateLabel="31.03.26"
          durationLabel="54m"
          showArtwork={false}
          showDragHandle
        />
      </TooltipProvider>
    );

    expect(
      screen.queryByText("Downloaded · In playlist")
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: "Downloaded, In playlist" })
    ).toBeInTheDocument();
    expect(
      container.querySelector('[data-episode-status-icon="downloaded"]')
    ).toBeInTheDocument();
    expect(
      container.querySelector('[data-episode-status-icon="in-playlist"]')
    ).toBeInTheDocument();
  });

  it("keeps status text on desktop rows", () => {
    render(
      <TooltipProvider>
        <EpisodeRow
          downloaded
          inPlaylist
          layout="desktop"
          title="Why store loyalty cards became a UX minefield"
          subtitle="Downloaded · In playlist"
        />
      </TooltipProvider>
    );

    expect(screen.getByText("Downloaded · In playlist")).toBeInTheDocument();
    expect(
      screen.queryByRole("img", { name: "Downloaded, In playlist" })
    ).not.toBeInTheDocument();
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
              label: "Mark as listened",
              icon: ViewIcon,
            },
          ]}
        />
      </TooltipProvider>
    );

    await user.click(screen.getByRole("button", { name: "More actions" }));

    const dialog = screen.getByRole("dialog");
    await expectNoA11yViolations(dialog);
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
      "Mark as listened",
    ]);

    await user.click(
      screen.getByRole("button", { name: "Show notes" })
    );
    expect(onShowNotes).toHaveBeenCalledOnce();
  });
});
