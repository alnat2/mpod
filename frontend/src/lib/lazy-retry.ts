import { lazy, type ComponentType } from "react";

export const CHUNK_RELOAD_STORAGE_KEY = "mpod_last_chunk_reload";
export const CHUNK_RELOAD_COOLDOWN_MS = 15000;

export function isChunkLoadError(error: unknown): boolean {
  if (!error) return false;
  const message = error instanceof Error ? error.message : String(error);
  return (
    /failed to fetch dynamically imported module/i.test(message) ||
    /error loading dynamically imported module/i.test(message) ||
    /importing a module script failed/i.test(message) ||
    /chunkloaderror/i.test(message) ||
    /loading chunk/i.test(message) ||
    /failed to load resource.*module/i.test(message) ||
    /load failed/i.test(message)
  );
}

export function triggerChunkReload(onReload?: () => void): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  try {
    const lastReload = sessionStorage.getItem(CHUNK_RELOAD_STORAGE_KEY);
    const now = Date.now();
    if (lastReload && now - Number(lastReload) < CHUNK_RELOAD_COOLDOWN_MS) {
      return false;
    }
    sessionStorage.setItem(CHUNK_RELOAD_STORAGE_KEY, now.toString());
    if (onReload) {
      onReload();
    } else if (window.location) {
      window.location.reload();
    }
    return true;
  } catch {
    if (onReload) {
      onReload();
    } else if (window.location) {
      window.location.reload();
    }
    return true;
  }
}

export type LazyRetryOptions = {
  retries?: number;
  delay?: number;
  backoff?: boolean;
  autoReload?: boolean;
  onReload?: () => void;
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
              return new Promise<{ default: T }>(() => {});
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
