import { fireEvent, render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./tooltip";

describe("Tooltip with Long-Press support", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function renderTestTooltip({ onClick = vi.fn() } = {}) {
    return {
      onClick,
      ...render(
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild onClick={onClick}>
              <button type="button">Action</button>
            </TooltipTrigger>
            <TooltipContent>Action tooltip</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ),
    };
  }

  it("does not show tooltip on quick touch tap, and executes onClick", () => {
    const { onClick } = renderTestTooltip();
    const button = screen.getByRole("button", { name: "Action" });

    // Touch down
    fireEvent.pointerDown(button, { pointerType: "touch", clientX: 100, clientY: 100 });
    // Release quickly (e.g. 100ms)
    act(() => {
      vi.advanceTimersByTime(100);
    });
    fireEvent.pointerUp(button, { pointerType: "touch", clientX: 100, clientY: 100 });
    fireEvent.click(button);

    expect(onClick).toHaveBeenCalledOnce();
    expect(screen.queryByText("Action tooltip")).not.toBeInTheDocument();
  });

  it("shows tooltip on long-press (>= 400ms) and prevents onClick", () => {
    const { onClick } = renderTestTooltip();
    const button = screen.getByRole("button", { name: "Action" });

    // Touch down
    fireEvent.pointerDown(button, { pointerType: "touch", clientX: 100, clientY: 100 });

    // Hold for 400ms
    act(() => {
      vi.advanceTimersByTime(400);
    });

    // Tooltip should now be displayed
    expect(screen.getByRole("tooltip")).toHaveTextContent("Action tooltip");

    // Release after long press
    fireEvent.pointerUp(button, { pointerType: "touch", clientX: 100, clientY: 100 });
    fireEvent.click(button);

    // Click action must have been prevented!
    expect(onClick).not.toHaveBeenCalled();
  });

  it("cancels long-press when pointer moves more than 10px", () => {
    const { onClick } = renderTestTooltip();
    const button = screen.getByRole("button", { name: "Action" });

    fireEvent.pointerDown(button, { pointerType: "touch", clientX: 100, clientY: 100 });

    // Move finger 20px (e.g. scrolling)
    fireEvent.pointerMove(button, { pointerType: "touch", clientX: 100, clientY: 125 });

    act(() => {
      vi.advanceTimersByTime(450);
    });

    expect(screen.queryByText("Action tooltip")).not.toBeInTheDocument();
  });

  it("does not show tooltip on programmatic focus (e.g. modal open auto-focus)", () => {
    renderTestTooltip();
    const button = screen.getByRole("button", { name: "Action" });

    // Simulating programmatic focus without :focus-visible
    fireEvent.focus(button);

    expect(screen.queryByText("Action tooltip")).not.toBeInTheDocument();
  });
});
