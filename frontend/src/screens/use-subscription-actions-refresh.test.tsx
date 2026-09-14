import React from "react";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api, ApiError } from "@/lib/api";
import {
  REFRESH_ALL_MAX_CONSECUTIVE_ERRORS,
  REFRESH_ALL_STATUS_POLL_MS,
  REFRESH_ALL_WALL_CLOCK_TIMEOUT_MS,
  useSubscriptionActions,
} from "./use-subscription-actions";

describe("useSubscriptionActions - refreshAll polling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  function setupHook() {
    const reloadQueue = vi.fn().mockResolvedValue(undefined);
    const setPodcasts = vi.fn();
    const setReloadKey = vi.fn();

    const hook = renderHook(() =>
      useSubscriptionActions({
        podcasts: [],
        reloadQueue,
        setPodcasts,
        setReloadKey,
        showAll: true,
      })
    );

    return { ...hook, reloadQueue, setPodcasts, setReloadKey };
  }

  it("completes successfully when the background job finishes", async () => {
    vi.spyOn(api.podcasts, "refreshAll").mockResolvedValue({
      success: true,
      state: "running",
    });
    const statusSpy = vi
      .spyOn(api.jobs, "status")
      .mockResolvedValueOnce({
        scheduler: {
          state: "running",
          lastRunAt: "2026-09-13T10:00:00Z",
          lastSuccessAt: null,
        },
      })
      .mockResolvedValueOnce({
        scheduler: {
          state: "completed",
          lastRunAt: "2026-09-13T10:00:00Z",
          lastSuccessAt: "2026-09-13T10:00:05Z",
        },
      });

    const { result, setReloadKey } = setupHook();

    await act(async () => {
      await result.current.refreshAllPodcasts();
    });

    expect(result.current.refreshingAll).toBe(true);
    expect(result.current.actionError).toBeNull();

    // Poll 1: still running
    await act(async () => {
      await vi.advanceTimersByTimeAsync(REFRESH_ALL_STATUS_POLL_MS);
    });
    expect(statusSpy).toHaveBeenCalledTimes(1);
    expect(result.current.refreshingAll).toBe(true);

    // Poll 2: completed
    await act(async () => {
      await vi.advanceTimersByTimeAsync(REFRESH_ALL_STATUS_POLL_MS);
    });
    expect(statusSpy).toHaveBeenCalledTimes(2);
    expect(result.current.refreshingAll).toBe(false);
    expect(result.current.actionError).toBeNull();
    expect(setReloadKey).toHaveBeenCalled();
  });

  it("stops polling and sets error when wall-clock timeout is exceeded", async () => {
    vi.spyOn(api.podcasts, "refreshAll").mockResolvedValue({
      success: true,
      state: "running",
    });
    const statusSpy = vi.spyOn(api.jobs, "status").mockResolvedValue({
      scheduler: {
        state: "running",
        lastRunAt: "2026-09-13T10:00:00Z",
        lastSuccessAt: null,
      },
    });

    const { result } = setupHook();

    await act(async () => {
      await result.current.refreshAllPodcasts();
    });

    expect(result.current.refreshingAll).toBe(true);

    // Advance right up to the wall-clock timeout in intervals
    const steps = Math.floor(
      REFRESH_ALL_WALL_CLOCK_TIMEOUT_MS / REFRESH_ALL_STATUS_POLL_MS
    );
    for (let i = 0; i < steps; i++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(REFRESH_ALL_STATUS_POLL_MS);
      });
    }

    // Next timer advance pushes it past REFRESH_ALL_WALL_CLOCK_TIMEOUT_MS
    await act(async () => {
      await vi.advanceTimersByTimeAsync(REFRESH_ALL_STATUS_POLL_MS);
    });

    expect(result.current.refreshingAll).toBe(false);
    expect(result.current.actionError).toBe(
      "Refresh all timed out. Please try again."
    );

    const callCountAfterTimeout = statusSpy.mock.calls.length;
    // Further timer advance does not poll again
    await act(async () => {
      await vi.advanceTimersByTimeAsync(REFRESH_ALL_STATUS_POLL_MS * 3);
    });
    expect(statusSpy).toHaveBeenCalledTimes(callCountAfterTimeout);
  });

  it("stops polling when consecutive 5xx/network errors reach the limit", async () => {
    vi.spyOn(api.podcasts, "refreshAll").mockResolvedValue({
      success: true,
      state: "running",
    });
    const statusSpy = vi
      .spyOn(api.jobs, "status")
      .mockRejectedValue(new ApiError("Server error 500", "SERVER_ERROR", 500));

    const { result } = setupHook();

    await act(async () => {
      await result.current.refreshAllPodcasts();
    });

    expect(result.current.refreshingAll).toBe(true);

    // Advance for consecutive errors up to REFRESH_ALL_MAX_CONSECUTIVE_ERRORS
    for (let i = 0; i < REFRESH_ALL_MAX_CONSECUTIVE_ERRORS; i++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(REFRESH_ALL_STATUS_POLL_MS);
      });
    }

    expect(statusSpy).toHaveBeenCalledTimes(REFRESH_ALL_MAX_CONSECUTIVE_ERRORS);
    expect(result.current.refreshingAll).toBe(false);
    expect(result.current.actionError).toBe("Server error 500");

    // Advance more; no additional calls should occur
    await act(async () => {
      await vi.advanceTimersByTimeAsync(REFRESH_ALL_STATUS_POLL_MS * 2);
    });
    expect(statusSpy).toHaveBeenCalledTimes(REFRESH_ALL_MAX_CONSECUTIVE_ERRORS);
  });

  it("recovers from a single transient error and continues polling until success", async () => {
    vi.spyOn(api.podcasts, "refreshAll").mockResolvedValue({
      success: true,
      state: "running",
    });
    const statusSpy = vi
      .spyOn(api.jobs, "status")
      .mockRejectedValueOnce(new Error("Network glitch"))
      .mockResolvedValueOnce({
        scheduler: {
          state: "completed",
          lastRunAt: "2026-09-13T10:00:00Z",
          lastSuccessAt: "2026-09-13T10:00:05Z",
        },
      });

    const { result, setReloadKey } = setupHook();

    await act(async () => {
      await result.current.refreshAllPodcasts();
    });

    expect(result.current.refreshingAll).toBe(true);

    // Poll 1: transient failure, should not stop polling
    await act(async () => {
      await vi.advanceTimersByTimeAsync(REFRESH_ALL_STATUS_POLL_MS);
    });
    expect(statusSpy).toHaveBeenCalledTimes(1);
    expect(result.current.refreshingAll).toBe(true);

    // Poll 2: succeeds
    await act(async () => {
      await vi.advanceTimersByTimeAsync(REFRESH_ALL_STATUS_POLL_MS);
    });
    expect(statusSpy).toHaveBeenCalledTimes(2);
    expect(result.current.refreshingAll).toBe(false);
    expect(result.current.actionError).toBeNull();
    expect(setReloadKey).toHaveBeenCalled();
  });

  it("cleans up polling timers on unmount so no state updates happen", async () => {
    vi.spyOn(api.podcasts, "refreshAll").mockResolvedValue({
      success: true,
      state: "running",
    });
    const statusSpy = vi.spyOn(api.jobs, "status").mockResolvedValue({
      scheduler: {
        state: "running",
        lastRunAt: "2026-09-13T10:00:00Z",
        lastSuccessAt: null,
      },
    });

    const { result, unmount } = setupHook();

    await act(async () => {
      await result.current.refreshAllPodcasts();
    });

    // Advance 1 poll
    await act(async () => {
      await vi.advanceTimersByTimeAsync(REFRESH_ALL_STATUS_POLL_MS);
    });
    expect(statusSpy).toHaveBeenCalledTimes(1);

    // Unmount
    unmount();

    // Advance further: no more status calls
    await act(async () => {
      await vi.advanceTimersByTimeAsync(REFRESH_ALL_STATUS_POLL_MS * 5);
    });
    expect(statusSpy).toHaveBeenCalledTimes(1);
  });

  it("cancels old polling cycle when a new refreshAll is triggered", async () => {
    vi.spyOn(api.podcasts, "refreshAll").mockResolvedValue({
      success: true,
      state: "running",
    });
    const statusSpy = vi
      .spyOn(api.jobs, "status")
      .mockResolvedValueOnce({
        scheduler: {
          state: "running",
          lastRunAt: "2026-09-13T10:00:00Z",
          lastSuccessAt: null,
        },
      })
      .mockResolvedValueOnce({
        scheduler: {
          state: "completed",
          lastRunAt: "2026-09-13T10:00:00Z",
          lastSuccessAt: "2026-09-13T10:00:05Z",
        },
      });

    const { result } = setupHook();

    // First call
    await act(async () => {
      await result.current.refreshAllPodcasts();
    });

    // Poll 1 for operation 1
    await act(async () => {
      await vi.advanceTimersByTimeAsync(REFRESH_ALL_STATUS_POLL_MS);
    });
    expect(statusSpy).toHaveBeenCalledTimes(1);

    // Trigger second call while still polling
    await act(async () => {
      await result.current.refreshAllPodcasts();
    });

    // Advance timer: should poll for operation 2 and complete
    await act(async () => {
      await vi.advanceTimersByTimeAsync(REFRESH_ALL_STATUS_POLL_MS);
    });
    expect(statusSpy).toHaveBeenCalledTimes(2);
    expect(result.current.refreshingAll).toBe(false);
  });

  it("works properly in React StrictMode without breaking state updates", async () => {
    vi.spyOn(api.podcasts, "refreshAll").mockResolvedValue({
      success: true,
      state: "running",
    });
    vi.spyOn(api.jobs, "status").mockResolvedValue({
      scheduler: {
        state: "completed",
        lastRunAt: "2026-09-13T10:00:00Z",
        lastSuccessAt: "2026-09-13T10:00:05Z",
      },
    });

    const reloadQueue = vi.fn().mockResolvedValue(undefined);
    const setPodcasts = vi.fn();
    const setReloadKey = vi.fn();

    const { result } = renderHook(
      () =>
        useSubscriptionActions({
          podcasts: [],
          reloadQueue,
          setPodcasts,
          setReloadKey,
          showAll: true,
        }),
      { wrapper: React.StrictMode }
    );

    await act(async () => {
      await result.current.refreshAllPodcasts();
    });

    expect(result.current.refreshingAll).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(REFRESH_ALL_STATUS_POLL_MS);
    });

    expect(result.current.refreshingAll).toBe(false);
    expect(result.current.actionError).toBeNull();
  });

  it("aborts in-flight refreshAll request and surfaces timeout error when network hangs", async () => {
    let capturedSignal: AbortSignal | undefined;
    vi.spyOn(api.podcasts, "refreshAll").mockImplementation((options) => {
      capturedSignal = options?.signal;
      return new Promise((_, reject) => {
        if (capturedSignal) {
          capturedSignal.addEventListener("abort", () => {
            reject(new DOMException("The operation was aborted.", "AbortError"));
          });
        }
      });
    });

    const { result } = setupHook();

    await act(async () => {
      void result.current.refreshAllPodcasts();
    });

    expect(result.current.refreshingAll).toBe(true);
    expect(capturedSignal?.aborted).toBe(false);

    // Advance to wall-clock timeout
    await act(async () => {
      await vi.advanceTimersByTimeAsync(REFRESH_ALL_WALL_CLOCK_TIMEOUT_MS);
    });

    expect(capturedSignal?.aborted).toBe(true);
    expect(result.current.refreshingAll).toBe(false);
    expect(result.current.actionError).toBe(
      "Refresh all timed out. Please try again."
    );
  });

  it("aborts in-flight jobs.status request when wall-clock timeout expires during polling", async () => {
    vi.spyOn(api.podcasts, "refreshAll").mockResolvedValue({
      success: true,
      state: "running",
    });

    let capturedSignal: AbortSignal | undefined;
    vi.spyOn(api.jobs, "status").mockImplementation((options) => {
      capturedSignal = options?.signal;
      return new Promise((_, reject) => {
        if (capturedSignal) {
          capturedSignal.addEventListener("abort", () => {
            reject(new DOMException("The operation was aborted.", "AbortError"));
          });
        }
      });
    });

    const { result } = setupHook();

    await act(async () => {
      await result.current.refreshAllPodcasts();
    });

    expect(result.current.refreshingAll).toBe(true);

    // Poll 1 triggers hanging jobs.status
    await act(async () => {
      await vi.advanceTimersByTimeAsync(REFRESH_ALL_STATUS_POLL_MS);
    });

    expect(capturedSignal).toBeDefined();
    expect(capturedSignal?.aborted).toBe(false);

    // Advance until wall clock timeout expires
    await act(async () => {
      await vi.advanceTimersByTimeAsync(REFRESH_ALL_WALL_CLOCK_TIMEOUT_MS);
    });

    expect(capturedSignal?.aborted).toBe(true);
    expect(result.current.refreshingAll).toBe(false);
    expect(result.current.actionError).toBe(
      "Refresh all timed out. Please try again."
    );
  });
});
