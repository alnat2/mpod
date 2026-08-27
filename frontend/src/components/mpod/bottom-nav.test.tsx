import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { BottomNav } from "./bottom-nav";

describe("BottomNav", () => {
  it("renders all 5 navigation items matching Figma mobile design", () => {
    render(
      <MemoryRouter>
        <BottomNav activeItem="Podcasts" />
      </MemoryRouter>
    );

    expect(screen.getByRole("link", { name: /Player/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Podcasts/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Abooks/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Settings/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Add/i })).toBeInTheDocument();

    const podcasts = screen.getByRole("link", { name: /Podcasts/i });
    const icon = podcasts.querySelector('[data-icon-name="hugeicons/podcast"]');
    expect(icon).not.toBeNull();
    expect(icon).toHaveAttribute("data-icon-name", "hugeicons/podcast");
  });
});
