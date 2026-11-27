import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "./api";
import { isTransientWakeError, retryTransient } from "./wake-recovery";

describe("wake-recovery", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("classifies transient network and gateway errors accurately", () => {
    expect(isTransientWakeError(new TypeError("Failed to fetch"))).toBe(true);
    expect(isTransientWakeError(new ApiError("Request Timeout", "HTTP_ERROR", 408))).toBe(true);
    expect(isTransientWakeError(new ApiError("Too Many Requests", "HTTP_ERROR", 429))).toBe(true);
    expect(isTransientWakeError(new ApiError("Bad Gateway", "HTTP_ERROR", 502))).toBe(true);
    expect(isTransientWakeError(new ApiError("Unavailable", "HTTP_ERROR", 503))).toBe(true);
    expect(isTransientWakeError(new ApiError("Timeout", "HTTP_ERROR", 504))).toBe(true);

    expect(isTransientWakeError(new ApiError("Not Found", "HTTP_ERROR", 404))).toBe(false);
    expect(isTransientWakeError(new ApiError("Unauthorized", "UNAUTHORIZED", 401))).toBe(false);
    expect(isTransientWakeError(new DOMException("Aborted", "AbortError"))).toBe(false);
  });

  it("retries transient failures and resolves once recovered", async () => {
    const operation = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce("ok");

    const result = await retryTransient(operation, {
      maxAttempts: 2,
      delaysMs: [1],
    });

    expect(result).toBe("ok");
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it("does not retry non-transient errors", async () => {
    const error = new ApiError("Not Found", "HTTP_ERROR", 404);
    const operation = vi.fn<() => Promise<string>>().mockRejectedValue(error);

    await expect(
      retryTransient(operation, { maxAttempts: 3, delaysMs: [1] })
    ).rejects.toBe(error);
    expect(operation).toHaveBeenCalledTimes(1);
  });
});
