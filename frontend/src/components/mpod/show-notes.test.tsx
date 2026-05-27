import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";

import { ShowNotes } from "./show-notes";

describe("ShowNotes", () => {
  it("renders episode metadata and content", () => {
    render(
      <TooltipProvider>
        <ShowNotes
          podcastTitle="Decoder Ring"
          episodeTitle="Why store loyalty cards became a UX minefield"
        >
          {"<p>Long form <strong>show notes</strong> with a <a href=\"https://example.com\">link</a>.</p>"}
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
    const link = screen.getByRole("link", { name: "link" });
    expect(link).toHaveAttribute("href", "https://example.com");
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
