import { ApiError } from "./api";
import { sleepWithSignal } from "./session-recovery";

export const WAKE_REVALIDATE_AFTER_MS = 60_000;

const TRANSIENT_HTTP_STATUSES = new Set([408, 429, 502, 503, 504]);

export function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  return (error as { name?: string }).name === "AbortError";
}

export function isTransientWakeError(error: unknown): boolean {
  if (!error || typeof error !== "object" || isAbortError(error)) {
    return false;
  }
  if (error instanceof TypeError) {
    return true;
  }
  if (error instanceof ApiError) {
    return TRANSIENT_HTTP_STATUSES.has(error.status);
  }
  const message = (error as { message?: string }).message ?? "";
  return (
    message.includes("Failed to fetch") ||
    message.includes("Load failed") ||
    message.includes("NetworkError") ||
    message.includes("ECONNREFUSED") ||
    message.includes("ETIMEDOUT")
  );
}

export async function retryTransient<T>(
  operation: () => Promise<T>,
  options: {
    maxAttempts?: number;
    delaysMs?: number[];
    signal?: AbortSignal;
  } = {}
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 2;
  const delaysMs = options.delaysMs ?? [300];
  let attempt = 0;

  while (true) {
    if (options.signal?.aborted) {
      throw new DOMException("The operation was aborted.", "AbortError");
    }

    try {
      return await operation();
    } catch (error) {
      attempt += 1;
      if (
        attempt >= maxAttempts ||
        options.signal?.aborted ||
        !isTransientWakeError(error)
      ) {
        throw error;
      }

      const delay = delaysMs[attempt - 1] ?? delaysMs[delaysMs.length - 1] ?? 300;
      await sleepWithSignal(delay, options.signal);
    }
  }
}
