import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";

import { ShowNotes } from "./show-notes";

describe("ShowNotes", () => {
  it("renders episode metadata and linkifies plain-text URLs", () => {
    render(
      <TooltipProvider>
        <ShowNotes
          podcastTitle="Decoder Ring"
          episodeTitle="Why store loyalty cards became a UX minefield"
        >
          {"Long form show notes.\n\nRead https://example.com/notes."}
        </ShowNotes>
      </TooltipProvider>
    );

    expect(screen.getByText("Show notes")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Decoder Ring - Why store loyalty cards became a UX minefield"
      )
    ).toBeInTheDocument();
    expect(screen.getByText("Long form", { exact: false })).toBeInTheDocument();
    const link = screen.getByRole("link", {
      name: "https://example.com/notes",
    });
    expect(link).toHaveAttribute("href", "https://example.com/notes");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("excludes sentence punctuation and unmatched delimiters from links", () => {
    render(
      <TooltipProvider>
        <ShowNotes podcastTitle="Podcast" episodeTitle="Episode">
          {
            "Website: https://example.com/docs. Telegram: (https://t.me/example)."
          }
        </ShowNotes>
      </TooltipProvider>
    );

    expect(
      screen.getByRole("link", { name: "https://example.com/docs" })
    ).toHaveAttribute("href", "https://example.com/docs");
    expect(
      screen.getByRole("link", { name: "https://t.me/example" })
    ).toHaveAttribute("href", "https://t.me/example");
  });

  it("renders markup-like text without interpreting it as HTML", () => {
    render(
      <TooltipProvider>
        <ShowNotes podcastTitle="Podcast" episodeTitle="Episode">
          {'Notes <img src="/unexpected.png" alt="unexpected">'}
        </ShowNotes>
      </TooltipProvider>
    );

    expect(
      screen.queryByRole("img", { name: "unexpected" })
    ).not.toBeInTheDocument();
    expect(
      screen.getByText('Notes <img src="/unexpected.png" alt="unexpected">')
    ).toBeInTheDocument();
  });

  it("calls onClose from the close button", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    render(
      <TooltipProvider>
        <ShowNotes podcastTitle="Podcast" episodeTitle="Episode" onClose={onClose}>
          Notes
        </ShowNotes>
      </TooltipProvider>
    );

    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
