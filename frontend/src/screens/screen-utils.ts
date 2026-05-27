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

export function formatClock(seconds: number | null | undefined) {
  if (!seconds || seconds <= 0) {
    return "0:00";
  }

  const rounded = Math.round(seconds);
  const minutes = Math.floor(rounded / 60);
  const remainingSeconds = rounded % 60;
  return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
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

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
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
