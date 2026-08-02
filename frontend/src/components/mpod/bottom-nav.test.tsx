import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { BottomNav } from "./bottom-nav";

describe("BottomNav", () => {
  it("uses the Figma RSS glyph for subscriptions", () => {
    render(
      <MemoryRouter>
        <BottomNav activeItem="Subscriptions" />
      </MemoryRouter>
    );

    const subscriptions = screen.getByRole("link", { name: "Subscriptions" });
    const icon = subscriptions.querySelector('[data-icon-name="hugeicons/rss"]');

    expect(icon).not.toBeNull();
    expect(icon).toHaveAttribute("data-icon-name", "hugeicons/rss");
    expect(icon?.querySelectorAll("path")).toHaveLength(3);
    expect(icon?.querySelector("path")).toHaveAttribute(
      "d",
      expect.stringContaining("24.3333 10.9167")
    );
  });
});
