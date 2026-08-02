import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { AuthCard } from "./auth-card";

describe("AuthCard", () => {
  it("announces authentication errors", () => {
    render(<AuthCard error="Invalid username or password" />);

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Invalid username or password"
    );
  });

  it("keeps the password hidden by default and toggles visibility", async () => {
    const user = userEvent.setup();

    render(<AuthCard />);

    const passwordInput = screen.getByLabelText("Password");
    const visibilityIcon = screen.getByTestId("password-visibility-icon");
    expect(passwordInput).toHaveAttribute("type", "password");
    expect(visibilityIcon).toHaveAttribute("data-visible", "false");

    await user.click(screen.getByRole("button", { name: "Show password" }));
    expect(passwordInput).toHaveAttribute("type", "text");
    expect(visibilityIcon).toHaveAttribute("data-visible", "true");

    await user.click(screen.getByRole("button", { name: "Hide password" }));
    expect(passwordInput).toHaveAttribute("type", "password");
    expect(visibilityIcon).toHaveAttribute("data-visible", "false");
  });
});
