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

  it("uses the compact 96px Figma row for mobile audiobooks", () => {
    const { container } = render(
      <TooltipProvider>
        <EpisodeRow
          compactMobile
          layout="mobile"
          title="The Running Grave"
          subtitle="Robert Galbraith"
          durationLabel="34h 12m"
        />
      </TooltipProvider>
    );

    expect(container.firstElementChild).toHaveClass(
      "h-[96px]",
      "grid-rows-[20px_44px]"
    );
    expect(screen.getByText("The Running Grave")).toHaveClass("truncate");
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

  it("shows 'Now playing · Chapter N / M' for active mobile multi-chapter audiobooks when currentStatusLabel is provided", () => {
    render(
      <TooltipProvider>
        <EpisodeRow
          compactMobile
          current
          currentStatusLabel="Now playing · Chapter 3 / 15"
          layout="mobile"
          title="The Running Grave"
          podcastTitle="Robert Galbraith"
          subtitle="Robert Galbraith · Chapter 3 / 15"
          durationLabel="34h 12m"
        />
      </TooltipProvider>
    );

    expect(screen.getByText("The Running Grave")).toBeInTheDocument();
    expect(screen.getByText("Now playing · Chapter 3 / 15")).toBeInTheDocument();
    expect(screen.getByText("34h 12m")).toBeInTheDocument();
  });

  it("shows full subtitle for inactive mobile multi-chapter audiobooks", () => {
    render(
      <TooltipProvider>
        <EpisodeRow
          compactMobile
          current={false}
          layout="mobile"
          title="The Running Grave"
          podcastTitle="Robert Galbraith"
          subtitle="Robert Galbraith · Chapter 3 / 15"
          durationLabel="34h 12m"
        />
      </TooltipProvider>
    );

    expect(screen.getByText("The Running Grave")).toBeInTheDocument();
    expect(screen.getByText("Robert Galbraith · Chapter 3 / 15")).toBeInTheDocument();
    expect(screen.queryByText("Now playing · Chapter 3 / 15")).not.toBeInTheDocument();
    expect(screen.queryByText("Now playing")).not.toBeInTheDocument();
  });

  it("shows 'Now playing' for an active podcast with podcastTitle 'Chapter 3' without altering the status label", () => {
    const { rerender } = render(
      <TooltipProvider>
        <EpisodeRow
          current
          layout="mobile"
          title="Episode 1"
          podcastTitle="Chapter 3"
          durationLabel="45m"
        />
      </TooltipProvider>
    );

    expect(screen.getByText("Episode 1")).toBeInTheDocument();
    expect(screen.getByText("Now playing")).toBeInTheDocument();
    expect(screen.queryByText("Now playing · Chapter 3")).not.toBeInTheDocument();

    rerender(
      <TooltipProvider>
        <EpisodeRow
          current
          layout="mobile"
          title="Chapter 3: The Big Reveal"
          podcastTitle="Audio Drama Podcast"
          subtitle="Chapter 3: The Big Reveal"
          durationLabel="45m"
        />
      </TooltipProvider>
    );

    expect(screen.getByText("Chapter 3: The Big Reveal")).toBeInTheDocument();
    expect(screen.getByText("Now playing")).toBeInTheDocument();
    expect(screen.queryByText("Now playing · Chapter 3")).not.toBeInTheDocument();
  });

  it("shows 'Now playing' for active mobile podcast and single-track audiobook without currentStatusLabel", () => {
    const { rerender } = render(
      <TooltipProvider>
        <EpisodeRow
          current
          layout="mobile"
          title="Why store loyalty cards became a UX minefield"
          podcastTitle="Decoder Ring"
          durationLabel="54m"
        />
      </TooltipProvider>
    );

    expect(screen.getByText("Why store loyalty cards became a UX minefield")).toBeInTheDocument();
    expect(screen.getByText("Now playing")).toBeInTheDocument();

    rerender(
      <TooltipProvider>
        <EpisodeRow
          compactMobile
          current
          layout="mobile"
          title="Single Track Audiobook"
          podcastTitle="Audiobook Author"
          subtitle="Audiobook Author"
          durationLabel="8h 20m"
        />
      </TooltipProvider>
    );

    expect(screen.getByText("Single Track Audiobook")).toBeInTheDocument();
    expect(screen.getByText("Now playing")).toBeInTheDocument();
  });

  it("preserves desktop presentation for active and inactive rows", () => {
    const { rerender } = render(
      <TooltipProvider>
        <EpisodeRow
          current={false}
          layout="desktop"
          title="The Running Grave"
          podcastTitle="Robert Galbraith"
          subtitle="Robert Galbraith · Chapter 3 / 15"
          durationLabel="34h 12m"
        />
      </TooltipProvider>
    );

    expect(screen.getByText("Robert Galbraith · Chapter 3 / 15")).toBeInTheDocument();
    expect(screen.queryByText(/now playing/i)).not.toBeInTheDocument();

    rerender(
      <TooltipProvider>
        <EpisodeRow
          current
          layout="desktop"
          title="The Running Grave"
          podcastTitle="Robert Galbraith"
          subtitle="Robert Galbraith · Chapter 3 / 15"
          durationLabel="34h 12m"
        />
      </TooltipProvider>
    );

    expect(
      screen.getByText("Robert Galbraith · Chapter 3 / 15 · now playing")
    ).toBeInTheDocument();
  });

  it("hides artwork on mobile layout and displays it on desktop layout", () => {
    const { container, rerender } = render(
      <TooltipProvider>
        <EpisodeRow
          layout="mobile"
          title="Artwork Test"
          thumbnailUrl="/cover.png"
          showArtwork
          showDragHandle
        />
      </TooltipProvider>
    );

    const mobileArtwork = container.querySelector("img")?.parentElement;
    expect(mobileArtwork).toHaveClass("hidden");
    const mobileDragHandle = container.querySelector('[data-episode-drag-handle="true"]');
    expect(mobileDragHandle).toHaveClass("absolute", "size-8", "left-0");

    rerender(
      <TooltipProvider>
        <EpisodeRow
          layout="desktop"
          title="Artwork Test"
          thumbnailUrl="/cover.png"
          showArtwork
          showDragHandle
        />
      </TooltipProvider>
    );

    const desktopArtwork = container.querySelector("img")?.parentElement;
    expect(desktopArtwork).toHaveClass("size-10", "block");
    const desktopDragHandle = container.querySelector('[data-episode-drag-handle="true"]');
    expect(desktopDragHandle).toHaveClass("size-6");
  });
});
