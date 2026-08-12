import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  NoteIcon,
  PlayListAddIcon,
  ViewIcon,
} from "@hugeicons/core-free-icons";
import { describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import { expectNoA11yViolations } from "@/test/axe";

import { EpisodeRow } from "./episode-row";

describe("EpisodeRow", () => {
  it("renders the new 116px mobile card with a two-line title and inline metadata", () => {
    const { container } = render(
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

    expect(container.firstElementChild).toHaveClass("h-[116px]", "grid");
    expect(screen.getByText("Why your topic isn't a point")).toHaveClass(
      "line-clamp-2"
    );
    expect(screen.getByText("Grammar Girl: For Writers and Language Lovers.")).toHaveClass(
      "truncate"
    );
    expect(screen.getByText("22m")).toBeInTheDocument();
    expect(screen.getByText("21.05.26")).toBeInTheDocument();
  });

  it("shows local-ready as the downloaded icon and does not add a playlist status icon", () => {
    const { container } = render(
      <TooltipProvider>
        <EpisodeRow
          downloaded
          inPlaylist
          layout="mobile"
          title="Why store loyalty cards became a UX minefield"
          podcastTitle="Decoder Ring"
          dateLabel="31.03.26"
          durationLabel="54m"
          showArtwork={false}
          showDragHandle
        />
      </TooltipProvider>
    );

    expect(screen.getByText("Decoder Ring")).toBeInTheDocument();
    expect(
      container.querySelector('[data-episode-status-icon="downloaded"]')
    ).toBeInTheDocument();
    expect(
      container.querySelector('[data-episode-status-icon="in-playlist"]')
    ).not.toBeInTheDocument();
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

  it("shows mobile episode actions directly in the designed order", async () => {
    const user = userEvent.setup();
    const onShowNotes = vi.fn();

    render(
      <TooltipProvider>
        <main>
          <EpisodeRow
            layout="mobile"
            title="Spec-Driven Development"
            podcastTitle="Podlodka Podcast"
            actions={[
              {
                label: "Add to playlist",
                icon: PlayListAddIcon,
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
        </main>
      </TooltipProvider>
    );

    const buttons = screen.getAllByRole("button");
    expect(buttons.map((button) => button.getAttribute("aria-label"))).toEqual([
      "Add to playlist",
      "Show notes",
      "Mark as listened",
    ]);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await expectNoA11yViolations(document.body);

    await user.click(
      screen.getByRole("button", { name: "Show notes" })
    );
    expect(onShowNotes).toHaveBeenCalledOnce();
  });

  it("renders the drag handle only when the Player queue requests it", () => {
    const { container, rerender } = render(
      <TooltipProvider>
        <EpisodeRow layout="mobile" title="Queued episode" />
      </TooltipProvider>
    );

    expect(
      container.querySelector('[data-episode-drag-handle="true"]')
    ).not.toBeInTheDocument();

    rerender(
      <TooltipProvider>
        <EpisodeRow layout="mobile" showDragHandle title="Queued episode" />
      </TooltipProvider>
    );

    expect(
      container.querySelector('[data-episode-drag-handle="true"]')
    ).toBeInTheDocument();
  });
});
