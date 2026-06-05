import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { undoDelayMs, useDelayedActions } from "./use-delayed-actions";

describe("useDelayedActions", () => {
  it("adds a pending action immediately and commits it after the delay", async () => {
    vi.useFakeTimers();

    const commit = vi.fn().mockResolvedValue(undefined);
    const onCommitted = vi.fn();

    const { result } = renderHook(() =>
      useDelayedActions({ onCommitted })
    );

    act(() => {
      result.current.scheduleAction({
        kind: "remove-playlist",
        episodeIds: [42],
        message: "Removed episode",
        commit,
      });
    });

    expect(result.current.pendingActions).toHaveLength(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(undoDelayMs);
    });

    expect(commit).toHaveBeenCalledTimes(1);
    expect(onCommitted).toHaveBeenCalledTimes(1);
    expect(result.current.pendingActions).toHaveLength(0);

    vi.useRealTimers();
  });

  it("cancels the commit when undone", async () => {
    vi.useFakeTimers();

    const commit = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useDelayedActions());

    act(() => {
      result.current.scheduleAction({
        kind: "mark-listened",
        episodeIds: [7],
        message: "Marked listened",
        commit,
      });
    });

    const pendingId = result.current.pendingActions[0]?.id;
    expect(pendingId).toBeTruthy();

    act(() => {
      result.current.undoAction(pendingId!);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(undoDelayMs);
    });

    expect(commit).not.toHaveBeenCalled();
    expect(result.current.pendingActions).toHaveLength(0);

    vi.useRealTimers();
  });

  it("reports commit errors", async () => {
    vi.useFakeTimers();

    const failure = new Error("nope");
    const commit = vi.fn().mockRejectedValue(failure);
    const onError = vi.fn();

    const { result } = renderHook(() => useDelayedActions({ onError }));

    act(() => {
      result.current.scheduleAction({
        kind: "unsubscribe-podcast",
        podcastId: 3,
        episodeIds: [],
        message: "Unsubscribed",
        commit,
      });
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(undoDelayMs);
    });

    expect(commit).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(failure);

    vi.useRealTimers();
  });
});
