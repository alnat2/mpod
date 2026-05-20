import { useCallback, useEffect, useRef, useState } from "react";

export const undoDelayMs = 15_000;

export type PendingDelayedAction = {
  id: string;
  message: string;
  episodeIds: number[];
  kind: "mark-listened" | "mark-unlistened" | "remove-playlist";
};

type ScheduleDelayedActionInput = Omit<PendingDelayedAction, "id"> & {
  commit: () => Promise<unknown>;
};

type UseDelayedActionsOptions = {
  delayMs?: number;
  onCommitted?: () => void;
  onError?: (error: unknown) => void;
};

export function useDelayedActions({
  delayMs = undoDelayMs,
  onCommitted,
  onError,
}: UseDelayedActionsOptions = {}) {
  const [pendingActions, setPendingActions] = useState<PendingDelayedAction[]>(
    []
  );
  const timers = useRef(new Map<string, number>());

  const undoAction = useCallback((id: string) => {
    const timer = timers.current.get(id);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      timers.current.delete(id);
    }

    setPendingActions((current) =>
      current.filter((action) => action.id !== id)
    );
  }, []);

  const scheduleAction = useCallback(
    ({ commit, ...action }: ScheduleDelayedActionInput) => {
      const id = `${action.kind}-${Date.now()}-${Math.random()
        .toString(16)
        .slice(2)}`;
      const pendingAction = { ...action, id };

      setPendingActions((current) => [...current, pendingAction]);

      const timer = window.setTimeout(() => {
        timers.current.delete(id);
        setPendingActions((current) =>
          current.filter((item) => item.id !== id)
        );

        void commit()
          .then(() => {
            onCommitted?.();
          })
          .catch((error: unknown) => {
            onError?.(error);
          });
      }, delayMs);

      timers.current.set(id, timer);
    },
    [delayMs, onCommitted, onError]
  );

  useEffect(() => {
    const activeTimers = timers.current;

    return () => {
      for (const timer of activeTimers.values()) {
        window.clearTimeout(timer);
      }
      activeTimers.clear();
    };
  }, []);

  return {
    pendingActions,
    scheduleAction,
    undoAction,
  };
}
