import { describe, expect, it } from "vitest";

import { ApiError } from "@/lib/api";

import {
  formatClock,
  formatEpisodeDate,
  formatDuration,
  getErrorMessage,
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
  });

  it("formats episode dates as dd.MM.yy", () => {
    expect(formatEpisodeDate("2026-03-31T10:00:00Z")).toBe("31.03.26");
    expect(formatEpisodeDate(null)).toBe("");
  });
});
