import { lazy, type ComponentType } from "react";

export const CHUNK_RELOAD_STORAGE_KEY = "mpod_last_chunk_reload";
export const CHUNK_RELOAD_COOLDOWN_MS = 15000;
export const CHUNK_RELOAD_FALLBACK_TIMEOUT_MS = 8000;

export function isChunkLoadError(error: unknown): boolean {
  if (!error) return false;
  const isTypeError =
    error instanceof TypeError ||
    (error instanceof Error && error.name === "TypeError");
  const message = error instanceof Error ? error.message : String(error);
  const trimmed = message.trim();

  // Safari throws `TypeError: Load failed` on dynamic import network/chunk failures
  if (isTypeError && /^load failed$/i.test(trimmed)) {
    return true;
  }

  return (
    /failed to fetch dynamically imported module/i.test(message) ||
    /error loading dynamically imported module/i.test(message) ||
    /importing a module script failed/i.test(message) ||
    /chunkloaderror/i.test(message) ||
    /loading chunk/i.test(message) ||
    /failed to load resource.*module/i.test(message)
  );
}

export function triggerChunkReload(onReload?: () => void): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  try {
    const storage = window.sessionStorage;
    if (!storage) {
      return false;
    }
    const lastReload = storage.getItem(CHUNK_RELOAD_STORAGE_KEY);
    const now = Date.now();
    if (lastReload && now - Number(lastReload) < CHUNK_RELOAD_COOLDOWN_MS) {
      return false;
    }
    storage.setItem(CHUNK_RELOAD_STORAGE_KEY, now.toString());
    if (onReload) {
      onReload();
    } else if (window.location) {
      window.location.reload();
    }
    return true;
  } catch {
    // If sessionStorage is unavailable (e.g. strict private mode or quota exceeded),
    // we cannot guarantee cooldown loop protection. Do not auto-reload.
    return false;
  }
}

export type LazyRetryOptions = {
  retries?: number;
  delay?: number;
  backoff?: boolean;
  autoReload?: boolean;
  onReload?: () => void;
  reloadFallbackTimeoutMs?: number;
};

export function lazyWithRetry<T extends ComponentType<any>>(
  importer: () => Promise<{ default: T }>,
  options: LazyRetryOptions = {}
) {
  const {
    retries = 2,
    delay = 500,
    backoff = true,
    autoReload = true,
    onReload,
    reloadFallbackTimeoutMs = CHUNK_RELOAD_FALLBACK_TIMEOUT_MS,
  } = options;

  return lazy(async () => {
    let currentDelay = delay;
    for (let attempt = 0; ; attempt++) {
      try {
        return await importer();
      } catch (error) {
        if (attempt >= retries) {
          if (autoReload && isChunkLoadError(error)) {
            const reloaded = triggerChunkReload(onReload);
            if (reloaded) {
              return new Promise<{ default: T }>((_, reject) => {
                setTimeout(() => {
                  reject(error);
                }, reloadFallbackTimeoutMs);
              });
            }
          }
          throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, currentDelay));
        if (backoff) {
          currentDelay *= 2;
        }
      }
    }
  });
}
