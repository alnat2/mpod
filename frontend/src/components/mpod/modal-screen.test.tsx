import { useState } from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

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
});
