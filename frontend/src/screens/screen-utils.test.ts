import { describe, expect, it } from "vitest";

import { ApiError } from "@/lib/api";

import {
  DEFAULT_DAILY_REFRESH_TIME,
  applyTimeMask,
  formatClock,
  formatDateTime,
  formatDurationHHMM,
  formatEpisodeDate,
  formatDuration,
  formatEpisodeDuration,
  formatPlaybackProgressDuration,
  formatRemainingTime,
  getErrorMessage,
  isValid24HourTime,
  normalizeDailyRefreshTime,
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

  it("formats durations in HH:MM mask format", () => {
    expect(formatDurationHHMM(undefined)).toBe("");
    expect(formatDurationHHMM(0)).toBe("");
    expect(formatDurationHHMM(54 * 60)).toBe("00:54");
    expect(formatDurationHHMM(72 * 60)).toBe("01:12");
    expect(formatDurationHHMM(84 * 60)).toBe("01:24");
    expect(formatDurationHHMM(10 * 3600 + 5 * 60)).toBe("10:05");
  });

  it("formats playback progress duration", () => {
    // Unplayed track
    expect(formatPlaybackProgressDuration(0, 54 * 60)).toBe("54:00");
    expect(formatPlaybackProgressDuration(undefined, 84 * 60)).toBe("1:24:00");
    expect(formatPlaybackProgressDuration(0, 0)).toBe("");
    expect(formatPlaybackProgressDuration(undefined, undefined)).toBe("");
    // Partially played track
    expect(formatPlaybackProgressDuration(72 * 60, 84 * 60)).toBe("1:12:00 / 1:24:00");
    expect(formatPlaybackProgressDuration(15 * 60, 54 * 60)).toBe("15:00 / 54:00");
  });

  it("formats durations for minutes and hours", () => {
    expect(formatDuration(undefined)).toBe("");
    expect(formatDuration(0, "n/a")).toBe("n/a");
    expect(formatDuration(90)).toBe("2m");
    expect(formatDuration(60 * 60 + 60 * 5)).toBe("1h 5m");
    expect(formatDuration(60 * 60 * 2)).toBe("2h");
  });

  it("formats playback clock labels according to standard mm:ss and h:mm:ss", () => {
    // Fault tolerance (null, undefined, NaN, negative)
    expect(formatClock(undefined)).toBe("00:00");
    expect(formatClock(null)).toBe("00:00");
    expect(formatClock(Number.NaN)).toBe("00:00");
    expect(formatClock(-5)).toBe("00:00");
    expect(formatClock(0)).toBe("00:00");

    // Tracks < 1 hour: strictly mm:ss with leading zeroes
    expect(formatClock(5)).toBe("00:05");
    expect(formatClock(45)).toBe("00:45");
    expect(formatClock(125)).toBe("02:05");
    expect(formatClock(5 * 60 + 3)).toBe("05:03");
    expect(formatClock(23 * 60 + 14)).toBe("23:14");

    // Tracks >= 1 hour: strictly h:mm:ss without leading zeroes for hours
    expect(formatClock(3600)).toBe("1:00:00");
    expect(formatClock(3600 + 25 * 60 + 39)).toBe("1:25:39");
    expect(formatClock(2 * 3600)).toBe("2:00:00");
    expect(formatClock(10 * 3600 + 4 * 60 + 2)).toBe("10:04:02");
    expect(formatClock(16 * 3600 + 22 * 60 + 14)).toBe("16:22:14");
  });

  it("formats episode duration for list cards with empty string fallback", () => {
    expect(formatEpisodeDuration(undefined)).toBe("");
    expect(formatEpisodeDuration(null)).toBe("");
    expect(formatEpisodeDuration(0)).toBe("");
    expect(formatEpisodeDuration(-10)).toBe("");
    expect(formatEpisodeDuration(Number.NaN)).toBe("");
    expect(formatEpisodeDuration(54 * 60)).toBe("54:00");
    expect(formatEpisodeDuration(3600 + 25 * 60 + 39)).toBe("1:25:39");
  });

  it("formats remaining time without ever showing negative values", () => {
    expect(formatRemainingTime(60, 61)).toBe("00:00");
    expect(formatRemainingTime(60, 5)).toBe("00:55");
    expect(formatRemainingTime(3600, 3500)).toBe("01:40");
    expect(formatRemainingTime(0, 0)).toBe("00:00");
    expect(formatRemainingTime(undefined, 10)).toBe("00:00");
  });

  it("normalizes daily refresh time with safe fallback to 03:00", () => {
    expect(normalizeDailyRefreshTime("03:00")).toBe("03:00");
    expect(normalizeDailyRefreshTime("09:15")).toBe("09:15");
    expect(normalizeDailyRefreshTime("21:30")).toBe("21:30");
    expect(normalizeDailyRefreshTime("")).toBe(DEFAULT_DAILY_REFRESH_TIME);
    expect(normalizeDailyRefreshTime(null)).toBe(DEFAULT_DAILY_REFRESH_TIME);
    expect(normalizeDailyRefreshTime("invalid")).toBe(DEFAULT_DAILY_REFRESH_TIME);
    expect(normalizeDailyRefreshTime("25:00")).toBe(DEFAULT_DAILY_REFRESH_TIME);
    expect(normalizeDailyRefreshTime("9:15")).toBe(DEFAULT_DAILY_REFRESH_TIME);
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
