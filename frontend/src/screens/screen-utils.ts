import { ApiError, type Episode } from "@/lib/api";

export function getErrorMessage(error: unknown) {
  if (error instanceof ApiError) {
    return error.message;
  }
  return "Request failed";
}

export function formatDuration(seconds: number | null | undefined, fallback = "") {
  if (!seconds || seconds <= 0) {
    return fallback;
  }

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}

export function formatDurationHHMM(seconds: number | null | undefined, fallback = "") {
  if (!seconds || seconds <= 0) {
    return fallback;
  }

  const totalMinutes = Math.floor(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}`;
}

export function formatClock(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) {
    return "00:00";
  }

  const rounded = Math.max(0, Math.round(seconds));
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const remainingSeconds = rounded % 60;

  const mm = minutes.toString().padStart(2, "0");
  const ss = remainingSeconds.toString().padStart(2, "0");

  if (hours > 0) {
    return `${hours}:${mm}:${ss}`;
  }

  return `${mm}:${ss}`;
}

export function formatEpisodeDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) {
    return "";
  }
  return formatClock(seconds);
}

export function formatRemainingTime(
  durationSeconds: number | null | undefined,
  positionSeconds: number | null | undefined
): string {
  if (durationSeconds == null || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return "00:00";
  }
  const pos = positionSeconds != null && Number.isFinite(positionSeconds) ? positionSeconds : 0;
  const remaining = Math.max(0, durationSeconds - pos);
  return formatClock(remaining);
}

export function formatPlaybackProgressDuration(
  positionSeconds: number | null | undefined,
  totalSeconds: number | null | undefined
) {
  if (!totalSeconds || totalSeconds <= 0) {
    return "";
  }
  const total = formatClock(totalSeconds);
  if (positionSeconds && positionSeconds > 0) {
    return `${formatClock(positionSeconds)} / ${total}`;
  }
  return total;
}

export function formatEpisodeDate(value: string | null | undefined) {
  if (!value) {
    return "";
  }

  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
  })
    .format(new Date(value))
    .replaceAll("/", ".");
}

export function formatDateTime(value?: string | null) {
  if (!value) {
    return "Never";
  }

  return new Intl.DateTimeFormat("en-GB", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    hourCycle: "h23",
  }).format(new Date(value));
}

export function getEpisodeShowNotes(
  episode?: Pick<Episode, "showNotes" | "description"> | null
) {
  const showNotes = episode?.showNotes?.trim();
  if (showNotes) {
    return showNotes;
  }

  const description = episode?.description?.trim();
  if (description) {
    return description;
  }

  return "No show notes available.";
}

export const DEFAULT_DAILY_REFRESH_TIME = "03:00";

export function isValid24HourTime(value: string | null | undefined): boolean {
  if (!value) {
    return false;
  }
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value.trim());
}

export function normalizeDailyRefreshTime(value: string | null | undefined): string {
  if (value && isValid24HourTime(value)) {
    return value.trim();
  }
  return DEFAULT_DAILY_REFRESH_TIME;
}

export function applyTimeMask(value: string, previousValue = ""): string {
  if (value.length < previousValue.length) {
    if (previousValue.endsWith(":") && value.length === previousValue.length - 1) {
      return value.slice(0, -1);
    }
    return value;
  }

  const digits = value.replace(/\D/g, "").slice(0, 4);
  if (!digits) {
    return "";
  }

  let hours = digits.slice(0, 2);
  if (hours.length === 1 && Number(hours) > 2) {
    hours = `0${hours}`;
  } else if (hours.length === 2 && Number(hours) > 23) {
    hours = "23";
  }

  const minutes = digits.slice(2, 4);
  let formattedMinutes: string;
  if (minutes.length === 1 && Number(minutes) > 5) {
    formattedMinutes = "5";
  } else if (minutes.length === 2 && Number(minutes) > 59) {
    formattedMinutes = "59";
  } else {
    formattedMinutes = minutes;
  }

  if (hours.length === 2) {
    return `${hours}:${formattedMinutes}`;
  }

  return hours;
}

