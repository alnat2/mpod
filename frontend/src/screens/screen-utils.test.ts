import { describe, expect, it } from "vitest";

import { ApiError } from "@/lib/api";

import {
  applyTimeMask,
  formatClock,
  formatDateTime,
  formatEpisodeDate,
  formatDuration,
  getErrorMessage,
  isValid24HourTime,
} from "./screen-utils";

describe("screen-utils", () => {
  it("returns ApiError messages directly", () => {
    expect(getErrorMessage(new ApiError("Bad feed", "BAD_FEED", 400))).toBe(
      "Bad feed"
    );
  });

  it("falls back to a generic error message", () => {
    expect(getErrorMessage(new Error("boom"))).toBe("Request failed");
  });

  it("formats durations for minutes and hours", () => {
    expect(formatDuration(undefined)).toBe("");
    expect(formatDuration(0, "n/a")).toBe("n/a");
    expect(formatDuration(90)).toBe("2m");
    expect(formatDuration(60 * 60 + 60 * 5)).toBe("1h 5m");
    expect(formatDuration(60 * 60 * 2)).toBe("2h");
  });

  it("formats playback clock labels", () => {
    expect(formatClock(undefined)).toBe("0:00");
    expect(formatClock(5)).toBe("0:05");
    expect(formatClock(125)).toBe("2:05");
    expect(formatClock(23 * 60 + 14)).toBe("23:14");
    expect(formatClock(3600)).toBe("1:00:00");
    expect(formatClock(16 * 3600 + 22 * 60 + 14)).toBe("16:22:14");
  });

  it("formats episode dates as dd.MM.yy", () => {
    expect(formatEpisodeDate("2026-03-31T10:00:00Z")).toBe("31.03.26");
    expect(formatEpisodeDate(null)).toBe("");
  });

  it("formats date and time in 24-hour format", () => {
    expect(formatDateTime(undefined)).toBe("Never");
    expect(formatDateTime(null)).toBe("Never");
    const formatted = formatDateTime("2026-09-10T13:52:00Z");
    expect(formatted).not.toMatch(/AM|PM/i);
    expect(formatted).toMatch(/\d{2}:\d{2}/);
  });

  it("validates 24-hour time format", () => {
    expect(isValid24HourTime("00:00")).toBe(true);
    expect(isValid24HourTime("04:00")).toBe(true);
    expect(isValid24HourTime("13:52")).toBe(true);
    expect(isValid24HourTime("23:59")).toBe(true);

    expect(isValid24HourTime("24:00")).toBe(false);
    expect(isValid24HourTime("04:60")).toBe(false);
    expect(isValid24HourTime("4:00")).toBe(false);
    expect(isValid24HourTime("12:5")).toBe(false);
    expect(isValid24HourTime("")).toBe(false);
    expect(isValid24HourTime(null)).toBe(false);
    expect(isValid24HourTime(undefined)).toBe(false);
  });

  it("applies 24-hour time mask while typing and deleting", () => {
    expect(applyTimeMask("")).toBe("");
    expect(applyTimeMask("1")).toBe("1");
    expect(applyTimeMask("14")).toBe("14:");
    expect(applyTimeMask("14:3")).toBe("14:3");
    expect(applyTimeMask("14:30")).toBe("14:30");

    // Auto-prefix single digits > 2
    expect(applyTimeMask("4")).toBe("04:");
    expect(applyTimeMask("9")).toBe("09:");

    // Clamp out-of-range hours (> 23)
    expect(applyTimeMask("28")).toBe("23:");

    // Clamp out-of-range minutes (> 59)
    expect(applyTimeMask("14:7")).toBe("14:5");
    expect(applyTimeMask("14:85")).toBe("14:59");

    // Deletion support
    expect(applyTimeMask("14:", "14:3")).toBe("14:");
    expect(applyTimeMask("14", "14:")).toBe("1");
  });
});
