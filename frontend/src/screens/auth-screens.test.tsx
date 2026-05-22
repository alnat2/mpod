import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, api } from "@/lib/api";

import { LoginScreen, SetupScreen } from "./auth-screens";

const navigateMock = vi.fn();

vi.mock("react-router-dom", () => ({
  useNavigate: () => navigateMock,
}));

describe("auth screens", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    navigateMock.mockReset();
  });

  it("submits registration and redirects into the app", async () => {
    const user = userEvent.setup();
    const onAuthenticated = vi.fn().mockResolvedValue(undefined);
    const registerSpy = vi
      .spyOn(api.auth, "register")
      .mockResolvedValue({ user: { id: 1, username: "qa" } });

    render(<SetupScreen onAuthenticated={onAuthenticated} />);

    await user.type(screen.getByLabelText("Username"), "qa");
    await user.type(screen.getByLabelText("Password"), "password123");
    await user.click(screen.getByRole("button", { name: "Create account" }));

    await waitFor(() => {
      expect(registerSpy).toHaveBeenCalledWith({
        username: "qa",
        password: "password123",
      });
    });
    expect(onAuthenticated).toHaveBeenCalledTimes(1);
    expect(navigateMock).toHaveBeenCalledWith("/subscriptions", {
      replace: true,
    });
  });

  it("shows the backend registration error", async () => {
    const user = userEvent.setup();
    vi.spyOn(api.auth, "register").mockRejectedValue(
      new ApiError("Username already exists", "CONFLICT", 409)
    );

    render(<SetupScreen />);

    await user.type(screen.getByLabelText("Username"), "qa");
    await user.type(screen.getByLabelText("Password"), "password123");
    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(await screen.findByText("Username already exists")).toBeInTheDocument();
  });

  it("submits login and redirects into the app", async () => {
    const user = userEvent.setup();
    const onAuthenticated = vi.fn().mockResolvedValue(undefined);
    const loginSpy = vi
      .spyOn(api.auth, "login")
      .mockResolvedValue({ user: { id: 1, username: "qa" } });

    render(<LoginScreen onAuthenticated={onAuthenticated} />);

    await user.type(screen.getByLabelText("Username"), "qa");
    await user.type(screen.getByLabelText("Password"), "password123");
    await user.click(screen.getByRole("button", { name: "Log in" }));

    await waitFor(() => {
      expect(loginSpy).toHaveBeenCalledWith({
        username: "qa",
        password: "password123",
      });
    });
    expect(onAuthenticated).toHaveBeenCalledTimes(1);
    expect(navigateMock).toHaveBeenCalledWith("/subscriptions", {
      replace: true,
    });
  });

  it("shows a fallback message when login fails unexpectedly", async () => {
    const user = userEvent.setup();
    vi.spyOn(api.auth, "login").mockRejectedValue(new Error("boom"));

    render(<LoginScreen />);

    await user.type(screen.getByLabelText("Username"), "qa");
    await user.type(screen.getByLabelText("Password"), "password123");
    await user.click(screen.getByRole("button", { name: "Log in" }));

    expect(await screen.findByText("Request failed")).toBeInTheDocument();
  });
});
