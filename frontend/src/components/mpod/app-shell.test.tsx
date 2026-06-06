import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { AppShell } from "./app-shell";

describe("AppShell", () => {
  it("keeps the mobile bottom navigation fixed to the viewport bottom", () => {
    render(
      <MemoryRouter>
        <AppShell activeNavItem="Subscriptions" pageTitle="Subscriptions">
          <div>Content</div>
        </AppShell>
      </MemoryRouter>
    );

    const main = screen.getByRole("main");
    const nav = screen
      .getAllByRole("navigation", { name: "Primary navigation" })
      .find((element) => element.classList.contains("md:hidden"));

    expect(main).toHaveClass("pb-[calc(65px+env(safe-area-inset-bottom))]");
    expect(nav).toHaveClass("fixed", "bottom-0", "z-40");
    expect(nav).toHaveClass("max-w-[440px]");
    expect(nav).not.toHaveClass("max-w-[320px]");
  });
});
