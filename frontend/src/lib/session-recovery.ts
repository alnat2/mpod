import { api, ApiError, type AuthSession } from "@/lib/api";

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
