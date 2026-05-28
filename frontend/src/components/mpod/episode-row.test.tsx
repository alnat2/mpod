import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

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
});
