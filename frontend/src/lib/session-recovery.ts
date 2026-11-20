import { api, ApiError, type AuthSession } from "@/lib/api";

export type SessionRetryConfig = {
  maxAttempts: number;
  timeoutMs: number;
  backoffDelays: number[];
};

export const SESSION_RETRY_CONFIG: {
  foreground: SessionRetryConfig;
  background: SessionRetryConfig;
} = {
  foreground: {
    maxAttempts: 3,
    timeoutMs: 2500,
    backoffDelays: [400, 800],
  },
  background: {
    maxAttempts: 1,
    timeoutMs: 4000,
    backoffDelays: [],
  },
};

export function isTransientSessionError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  if ((error as { name?: string }).name === "AbortError") {
    return true;
  }
  if (error instanceof TypeError) {
    return true;
  }
  if (error instanceof ApiError && error.status >= 500) {
    return true;
  }
  const message = (error as { message?: string }).message ?? "";
  if (
    message.includes("Failed to fetch") ||
    message.includes("Load failed") ||
    message.includes("NetworkError") ||
    message.includes("ECONNREFUSED") ||
    message.includes("ETIMEDOUT")
  ) {
    return true;
  }
  return false;
}

export function sleepWithSignal(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onAbort = () => {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
      resolve();
    };
    timer = setTimeout(() => {
      if (signal) {
        signal.removeEventListener("abort", onAbort);
      }
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export async function fetchSessionWithTimeout(
  timeoutMs: number,
  signal?: AbortSignal
): Promise<AuthSession> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const onParentAbort = () => {
    controller.abort();
  };

  if (signal) {
    if (signal.aborted) {
      controller.abort();
    } else {
      signal.addEventListener("abort", onParentAbort, { once: true });
    }
  }

  try {
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        const timeoutError = new Error("Session request timed out");
        timeoutError.name = "AbortError";
        reject(timeoutError);
      }, timeoutMs);
    });

    return await Promise.race([
      api.auth.session({ signal: controller.signal }),
      timeoutPromise,
    ]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
    if (signal) {
      signal.removeEventListener("abort", onParentAbort);
    }
  }
}
