import { StrictMode, useState } from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { expectNoA11yViolations } from "@/test/axe";

import { ModalScreen } from "./modal-screen";

function ModalHarness() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open modal
      </button>
      {open ? (
        <ModalScreen title="Example dialog" onClose={() => setOpen(false)}>
          <button type="button">First action</button>
          <button type="button">Last action</button>
        </ModalScreen>
      ) : null}
    </>
  );
}

describe("ModalScreen", () => {
  beforeEach(async () => {
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("traps focus and restores it after Escape closes the dialog", async () => {
    const user = userEvent.setup();
    vi.spyOn(window.history, "back").mockImplementation(() => undefined);

    render(<ModalHarness />);

    const opener = screen.getByRole("button", { name: "Open modal" });
    await user.click(opener);

    const dialog = screen.getByRole("dialog", { name: "Example dialog" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(opener.parentElement).toHaveAttribute("aria-hidden", "true");
    await expectNoA11yViolations(dialog);

    const firstAction = within(dialog).getByRole("button", {
      name: "First action",
    });
    const lastAction = within(dialog).getByRole("button", {
      name: "Last action",
    });
    await waitFor(() => expect(firstAction).toHaveFocus());

    await user.tab();
    expect(lastAction).toHaveFocus();
    await user.tab();
    expect(firstAction).toHaveFocus();
    await user.tab({ shift: true });
    expect(lastAction).toHaveFocus();

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => expect(opener).toHaveFocus());
    expect(opener.parentElement).not.toHaveAttribute("aria-hidden");
  });

  it("closes when the modal backdrop is clicked", async () => {
    const user = userEvent.setup();
    vi.spyOn(window.history, "back").mockImplementation(() => undefined);

    render(<ModalHarness />);
    await user.click(screen.getByRole("button", { name: "Open modal" }));

    await user.click(
      screen.getByRole("dialog", { name: "Example dialog" })
    );

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("closes in response to browser back navigation", () => {
    const onClose = vi.fn();

    render(
      <ModalScreen title="Example dialog" onClose={onClose}>
        Dialog content
      </ModalScreen>
    );

    window.dispatchEvent(new PopStateEvent("popstate"));

    expect(onClose).toHaveBeenCalledOnce();
  });

  it("keeps the dialog open when its parent supplies a new close callback", () => {
    const historyBack = vi
      .spyOn(window.history, "back")
      .mockImplementation(() => undefined);
    const { rerender } = render(
      <ModalScreen title="Example dialog" onClose={() => undefined}>
        Dialog content
      </ModalScreen>
    );

    rerender(
      <ModalScreen title="Example dialog" onClose={() => undefined}>
        Dialog content
      </ModalScreen>
    );

    expect(
      screen.getByRole("dialog", { name: "Example dialog" })
    ).toBeInTheDocument();
    expect(historyBack).not.toHaveBeenCalled();
  });

  it("does not navigate back during the StrictMode effect check", async () => {
    const historyBack = vi
      .spyOn(window.history, "back")
      .mockImplementation(() => undefined);

    render(
      <StrictMode>
        <ModalScreen title="Example dialog" onClose={() => undefined}>
          Dialog content
        </ModalScreen>
      </StrictMode>
    );
    historyBack.mockClear();
    await new Promise((resolve) => window.setTimeout(resolve, 0));

    expect(
      screen.getByRole("dialog", { name: "Example dialog" })
    ).toBeInTheDocument();
    expect(historyBack).not.toHaveBeenCalled();
  });
});
