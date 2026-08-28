import { useCallback, useEffect, useRef, useState } from "react";

export const undoDelayMs = 15_000;

export type PendingDelayedAction = {
  id: string;
  message: string;
  expiresAt: number;
  episodeIds: number[];
  kind: "unsubscribe-podcast";
  podcastId?: number;
};

type ScheduleDelayedActionInput = Omit<PendingDelayedAction, "id" | "expiresAt"> & {
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
  const commits = useRef(new Map<string, () => Promise<unknown>>());
  const onCommittedRef = useRef(onCommitted);
  const onErrorRef = useRef(onError);

  onCommittedRef.current = onCommitted;
  onErrorRef.current = onError;

  const undoAction = useCallback((id: string) => {
    const timer = timers.current.get(id);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      timers.current.delete(id);
    }
    commits.current.delete(id);

    setPendingActions((current) =>
      current.filter((action) => action.id !== id)
    );
  }, []);

  const scheduleAction = useCallback(
    ({ commit, ...action }: ScheduleDelayedActionInput) => {
      const id = `${action.kind}-${Date.now()}-${Math.random()
        .toString(16)
        .slice(2)}`;
      const pendingAction = { ...action, id, expiresAt: Date.now() + delayMs };

      commits.current.set(id, commit);
      setPendingActions((current) => [...current, pendingAction]);

      const timer = window.setTimeout(() => {
        timers.current.delete(id);
        const executeCommit = commits.current.get(id);
        commits.current.delete(id);

        if (!executeCommit) {
          return;
        }

        void executeCommit()
          .then(() => {
            setPendingActions((current) =>
              current.filter((item) => item.id !== id)
            );
            onCommittedRef.current?.();
          })
          .catch((error: unknown) => {
            setPendingActions((current) =>
              current.filter((item) => item.id !== id)
            );
            onErrorRef.current?.(error);
          });
      }, delayMs);

      timers.current.set(id, timer);
    },
    [delayMs]
  );

  const flush = useCallback(() => {
    const pendingCommits = Array.from(commits.current.entries());
    for (const [id, timer] of timers.current.entries()) {
      window.clearTimeout(timer);
    }
    timers.current.clear();
    commits.current.clear();

    for (const [, commit] of pendingCommits) {
      void commit().catch((error: unknown) => {
        onErrorRef.current?.(error);
      });
    }
  }, []);

  useEffect(() => {
    const handlePageHide = () => {
      flush();
    };

    window.addEventListener("pagehide", handlePageHide);
    window.addEventListener("beforeunload", handlePageHide);

    return () => {
      window.removeEventListener("pagehide", handlePageHide);
      window.removeEventListener("beforeunload", handlePageHide);
      flush();
    };
  }, [flush]);

  return {
    flush,
    pendingActions,
    scheduleAction,
    undoAction,
  };
}
