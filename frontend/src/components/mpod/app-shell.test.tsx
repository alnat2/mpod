import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { AppShell } from "./app-shell";
import { AppShellContext } from "./app-shell-context";

describe("AppShell", () => {
  it("uses Player as the mobile and desktop label for the home route", () => {
    render(
      <MemoryRouter>
        <AppShell activeNavItem="Player" pageTitle="Player">
          <div>Content</div>
        </AppShell>
      </MemoryRouter>
    );

    const playerLinks = screen.getAllByRole("link", { name: "Player" });

    expect(playerLinks).toHaveLength(2);
    for (const link of playerLinks) {
      expect(link).toHaveAttribute("href", "/home");
    }

    const mobilePlayerLink = playerLinks.find((link) =>
      link.closest("nav")?.classList.contains("md:hidden")
    );
    expect(mobilePlayerLink?.querySelector("svg")).toHaveClass("size-7");
    expect(screen.queryByRole("link", { name: "Home" })).not.toBeInTheDocument();
  });

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

  it("renders mobile bottom navigation and desktop top navigation in layout without duplicate navbars from child AppShell", () => {
    const setOnAddPodcastMock = vi.fn();
    render(
      <MemoryRouter initialEntries={["/subscriptions"]}>
        <AppShell mainClassName="xl:max-w-[1280px]" pageHeaderVisible={false}>
          <AppShellContext.Provider
            value={{ insideAppShell: true, setOnAddPodcast: setOnAddPodcastMock }}
          >
            <AppShell activeNavItem="Subscriptions" pageTitle="Subscriptions" pageHeaderVisible={false}>
              <div>Screen Content</div>
            </AppShell>
          </AppShellContext.Provider>
        </AppShell>
      </MemoryRouter>
    );

    expect(screen.getByText("Screen Content")).toBeInTheDocument();

    const navs = screen.getAllByRole("navigation", { name: "Primary navigation" });
    // Exactly 2 navigation elements: 1 desktop TopNav, 1 mobile BottomNav
    expect(navs).toHaveLength(2);

    const mobileNav = navs.find((el) => el.classList.contains("md:hidden"));
    expect(mobileNav).toBeDefined();
    expect(mobileNav).toHaveClass("fixed", "bottom-0");

    const desktopNav = navs.find((el) => !el.classList.contains("md:hidden"));
    expect(desktopNav).toBeDefined();
  });

  it("regression: reproduces bug where wrapping root AppShell inside insideAppShell:true hid BottomNav, and verifies fix", () => {
    // 1. Defect reproduction: if AppShell is wrapped in insideAppShell: true, it omits navigation entirely
    const { unmount } = render(
      <MemoryRouter initialEntries={["/subscriptions"]}>
        <AppShellContext.Provider
          value={{ insideAppShell: true, setOnAddPodcast: vi.fn() }}
        >
          <AppShell pageHeaderVisible={false}>
            <div>Bugged Layout Content</div>
          </AppShell>
        </AppShellContext.Provider>
      </MemoryRouter>
    );

    expect(screen.queryByRole("navigation", { name: "Primary navigation" })).not.toBeInTheDocument();
    unmount();

    // 2. Fixed layout: AppShell surrounds AppShellContext.Provider so outer shell renders navigation
    render(
      <MemoryRouter initialEntries={["/subscriptions"]}>
        <AppShell pageHeaderVisible={false}>
          <AppShellContext.Provider
            value={{ insideAppShell: true, setOnAddPodcast: vi.fn() }}
          >
            <div>Fixed Layout Content</div>
          </AppShellContext.Provider>
        </AppShell>
      </MemoryRouter>
    );

    expect(
      screen.getAllByRole("navigation", { name: "Primary navigation" })
    ).toHaveLength(2);
  });
});

