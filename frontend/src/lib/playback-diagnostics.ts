// Temporary, test-branch-only diagnostics for rare completion failures.
// Remove this module and its server endpoint after the failure is understood.
export type PlaybackDiagnosticEventName =
  | "ended"
  | "predicted_next"
  | "completion_request"
  | "completion_response"
  | "completion_error"
  | "queue_refreshed"
  | "transition_continued"
  | "transition_stopped"
  | "stale_completion"
  | "audio_playing"
  | "audio_error"
  | "manual_play"
  | "manual_pause"
  | "selection_changed";

export type PlaybackDiagnosticDetails = {
  episodeId?: number;
  audiobookId?: number;
  trackId?: number;
  nextEpisodeId?: number;
  nextAudiobookId?: number;
  nextTrackId?: number;
  sourceGeneration?: number;
  selectionGeneration?: number;
  status?: number;
  code?: string;
};

type PlaybackDiagnosticEvent = PlaybackDiagnosticDetails & {
  id: string;
  traceId: string;
  at: string;
  event: PlaybackDiagnosticEventName;
};

const STORAGE_KEY = "mpod:temporary-playback-diagnostics";
const MAX_EVENTS = 120;
const MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;
const BATCH_SIZE = 20;
let events: PlaybackDiagnosticEvent[] | null = null;
let flushing = false;
let initialized = false;
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleFlush(): void {
  if (flushTimer !== null) return;
  // Keep diagnostics off the synchronous audio-ended/autoplay path.
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushPlaybackDiagnostics();
  }, 1000);
}

function newId(): string {
  const bytes = new Uint8Array(8);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
    return `${Date.now().toString(36)}-${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
}

export function createPlaybackTraceId(): string {
  return newId();
}

function readEvents(): PlaybackDiagnosticEvent[] {
  if (events) return events;
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]") as unknown;
    events = Array.isArray(stored)
      ? stored.filter((item): item is PlaybackDiagnosticEvent =>
          typeof item === "object" && item !== null &&
          typeof item.id === "string" && typeof item.traceId === "string" &&
          typeof item.at === "string" && typeof item.event === "string")
      : [];
  } catch {
    events = [];
  }
  const cutoff = Date.now() - MAX_AGE_MS;
  events = events.filter((item) => Date.parse(item.at) >= cutoff).slice(-MAX_EVENTS);
  return events;
}

function persist(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(readEvents()));
  } catch {
    // The in-memory queue can still be sent during this session.
  }
}

export async function flushPlaybackDiagnostics(): Promise<void> {
  if (flushing || typeof fetch !== "function" || typeof window === "undefined") return;
  flushing = true;
  try {
    while (readEvents().length > 0) {
      const batch = readEvents().slice(0, BATCH_SIZE);
      let response: Response;
      try {
        response = await fetch("/api/playback/diagnostics", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ events: batch }),
        });
      } catch {
        break;
      }
      if (!response.ok) break;
      const sent = new Set(batch.map((item) => item.id));
      events = readEvents().filter((item) => !sent.has(item.id));
      persist();
    }
  } finally {
    flushing = false;
  }
}

export function initializePlaybackDiagnostics(): void {
  if (initialized || typeof window === "undefined") return;
  initialized = true;
  readEvents();
  window.addEventListener("online", () => { void flushPlaybackDiagnostics(); });
  void flushPlaybackDiagnostics();
}

export function recordPlaybackDiagnostic(
  traceId: string,
  event: PlaybackDiagnosticEventName,
  details: PlaybackDiagnosticDetails = {}
): void {
  if (typeof window === "undefined") return;
  initializePlaybackDiagnostics();
  readEvents().push({ id: newId(), traceId, at: new Date().toISOString(), event, ...details });
  events = readEvents().slice(-MAX_EVENTS);
  persist();
  scheduleFlush();
}
