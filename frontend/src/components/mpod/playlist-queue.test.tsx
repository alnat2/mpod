import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PlaylistQueue } from "./playlist-queue";

describe("PlaylistQueue", () => {
  it("keeps Top Info transparent and without a shadow", () => {
    const { container } = render(
      <PlaylistQueue summary="3 episodes · 2h 13m" />
    );

    const topInfo = container.querySelector(
      '[data-playlist-queue-top-info="true"]'
    );

    expect(topInfo).not.toHaveClass("bg-card", "shadow-xs");
    expect(topInfo).toHaveClass("h-[50px]", "px-3", "text-muted-foreground");
  });

  it("keeps queue rows inside the horizontal viewport", () => {
    const { container } = render(
      <PlaylistQueue summary="1 item · 20m">
        <div>Queued item</div>
      </PlaylistQueue>
    );

    const body = container.querySelector('[data-playlist-queue-top-info="true"]')
      ?.nextElementSibling;
    expect(body).toHaveClass("w-full", "overflow-x-hidden");
    expect(body).not.toHaveClass("-mx-1");
  });
});
