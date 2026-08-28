import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  GoToTimeModal,
} from "./go-to-time-modal";
import { formatDigitsToTime, parseDigitsToSeconds } from "./go-to-time-utils";

describe("GoToTimeModal helpers", () => {
  it("formats digits to time string correctly", () => {
    expect(formatDigitsToTime("")).toBe("0:00");
    expect(formatDigitsToTime("", true)).toBe("0:00:00");
    expect(formatDigitsToTime("5")).toBe("0:05");
    expect(formatDigitsToTime("35")).toBe("0:35");
    expect(formatDigitsToTime("125")).toBe("1:25");
    expect(formatDigitsToTime("1234")).toBe("12:34");
    expect(formatDigitsToTime("12345", true)).toBe("1:23:45");
    expect(formatDigitsToTime("123456", true)).toBe("12:34:56");
  });

  it("parses digits to total seconds correctly", () => {
    expect(parseDigitsToSeconds("")).toBe(0);
    expect(parseDigitsToSeconds("5")).toBe(5);
    expect(parseDigitsToSeconds("35")).toBe(35);
    expect(parseDigitsToSeconds("100")).toBe(60);
    expect(parseDigitsToSeconds("130")).toBe(90);
    expect(parseDigitsToSeconds("1500")).toBe(900);
    expect(parseDigitsToSeconds("10000", true)).toBe(3600);
    expect(parseDigitsToSeconds("12345", true)).toBe(1 * 3600 + 23 * 60 + 45);
  });
});

describe("GoToTimeModal component", () => {
  it("renders keypad and allows digit entry", () => {
    const onSeek = vi.fn();
    const onClose = vi.fn();

    render(
      <GoToTimeModal
        totalDurationSeconds={1800}
        onClose={onClose}
        onSeek={onSeek}
      />
    );

    expect(screen.getAllByText("Go to time").length).toBeGreaterThan(0);
    expect(screen.getByTestId("go-to-time-display")).toHaveTextContent("0:00");

    // Click keys '1', '2', '3', '0'
    fireEvent.click(screen.getByRole("button", { name: "1" }));
    expect(screen.getByTestId("go-to-time-display")).toHaveTextContent("0:01");

    fireEvent.click(screen.getByRole("button", { name: "2" }));
    expect(screen.getByTestId("go-to-time-display")).toHaveTextContent("0:12");

    fireEvent.click(screen.getByRole("button", { name: "3" }));
    expect(screen.getByTestId("go-to-time-display")).toHaveTextContent("1:23");

    fireEvent.click(screen.getByRole("button", { name: "0" }));
    expect(screen.getByTestId("go-to-time-display")).toHaveTextContent("12:30");

    // Click Backspace
    fireEvent.click(screen.getByRole("button", { name: "Backspace" }));
    expect(screen.getByTestId("go-to-time-display")).toHaveTextContent("1:23");

    // Click Done
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onSeek).toHaveBeenCalledWith(1 * 60 + 23);
    expect(onClose).toHaveBeenCalled();
  });

  it("handles '00' key and clamps to total duration", () => {
    const onSeek = vi.fn();
    const onClose = vi.fn();

    render(
      <GoToTimeModal
        totalDurationSeconds={600}
        onClose={onClose}
        onSeek={onSeek}
      />
    );

    // Click '5', '00' -> '500' -> 5:00 (300s)
    fireEvent.click(screen.getByRole("button", { name: "5" }));
    fireEvent.click(screen.getByRole("button", { name: "00" }));
    expect(screen.getByTestId("go-to-time-display")).toHaveTextContent("5:00");

    // Try typing 5000 -> exceeds 600s total duration -> should clamp to 600s on Done
    fireEvent.click(screen.getByRole("button", { name: "0" }));
    expect(screen.getByTestId("go-to-time-display")).toHaveTextContent("50:00");

    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onSeek).toHaveBeenCalledWith(600);
  });

  it("handles keyboard events", () => {
    const onSeek = vi.fn();
    const onClose = vi.fn();

    render(
      <GoToTimeModal
        totalDurationSeconds={3600}
        onClose={onClose}
        onSeek={onSeek}
      />
    );

    fireEvent.keyDown(window, { key: "4" });
    fireEvent.keyDown(window, { key: "5" });
    expect(screen.getByTestId("go-to-time-display")).toHaveTextContent("0:00:45");

    fireEvent.keyDown(window, { key: "Enter" });
    expect(onSeek).toHaveBeenCalledWith(45);
    expect(onClose).toHaveBeenCalled();
  });

  it("calls onClose when Cancel is clicked", () => {
    const onSeek = vi.fn();
    const onClose = vi.fn();

    render(
      <GoToTimeModal
        totalDurationSeconds={1800}
        onClose={onClose}
        onSeek={onSeek}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalled();
    expect(onSeek).not.toHaveBeenCalled();
  });
});
