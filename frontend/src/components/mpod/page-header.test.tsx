import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PageHeader } from "./page-header";

describe("PageHeader", () => {
  it("renders a structured multiline subtitle", () => {
    render(
      <PageHeader
        title="Settings"
        subtitle={
          <>
            <span>Last refresh today at 03:04</span>
            <span>Current IP: 43.32.112.45 • Geo: UK</span>
          </>
        }
        actions={[]}
      />
    );

    expect(
      screen.getByText("Last refresh today at 03:04")
    ).toBeInTheDocument();
    expect(
      screen.getByText("Current IP: 43.32.112.45 • Geo: UK")
    ).toBeInTheDocument();
  });

  it("applies compact heading size on mobile layout to prevent clipping long titles", () => {
    const { rerender } = render(
      <PageHeader title="Subscriptions" layout="mobile" />
    );

    const mobileHeading = screen.getByRole("heading", { name: "Subscriptions" });
    expect(mobileHeading.className).toContain("text-2xl");
    expect(mobileHeading.className).toContain("leading-8");

    rerender(<PageHeader title="Subscriptions" layout="desktop" />);
    const desktopHeading = screen.getByRole("heading", { name: "Subscriptions" });
    expect(desktopHeading.className).toContain("text-3xl");
    expect(desktopHeading.className).toContain("leading-9");
  });
});
