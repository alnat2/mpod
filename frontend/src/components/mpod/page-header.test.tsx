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
});
