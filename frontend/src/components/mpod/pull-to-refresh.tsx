import { useEffect, useRef, useState, type ReactNode } from "react";

import { Loading02Icon, RefreshDotIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { checkForAppUpdate } from "@/lib/pwa-update";
import { cn } from "@/lib/utils";

export const PULL_TO_REFRESH_THRESHOLD_PX = 64;
export const PULL_TO_REFRESH_MAX_PX = 96;
const PULL_DAMPING = 0.45;
const GESTURE_START_THRESHOLD_PX = 8;
const GESTURE_HORIZONTAL_RATIO = 1.2;
const INDICATOR_MIN_VISIBLE_HEIGHT_PX = 8;

type PullToRefreshProps = {
  children: ReactNode;
  className?: string;
  enabled?: boolean;
  onRefresh: () => void | Promise<unknown>;
};

function isIgnoredTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) {
    return false;
  }
  return Boolean(
    target.closest('[role="slider"], input, textarea, select, [data-ptr-ignore]')
  );
}

function hasScrolledAncestor(
  target: EventTarget | null,
  boundary: HTMLElement | null
): boolean {
  let current = target instanceof HTMLElement ? target : null;
  while (current && current !== boundary) {
    if (current.scrollTop > 0) {
      return true;
    }
    current = current.parentElement;
  }
  return Boolean(boundary && boundary.scrollTop > 0);
}

/**
 * Touch pull-to-refresh container for standalone PWA mobile screens.
 */
export function PullToRefresh({
  children,
  className,
  enabled = true,
  onRefresh,
}: PullToRefreshProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const onRefreshRef = useRef(onRefresh);
  const [pullDistance, setPullDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const pullDistanceRef = useRef(0);
  const refreshingRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    onRefreshRef.current = onRefresh;
  }, [onRefresh]);

  useEffect(() => {
    // Re-arm on mount so React StrictMode's simulated unmount/remount leaves mountedRef true.
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    refreshingRef.current = refreshing;
  }, [refreshing]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || !enabled) {
      pullDistanceRef.current = 0;
      setPullDistance(0);
      return;
    }

    let armed = false;
    let startX = 0;
    let startY = 0;
    let lockedDirection: "pull" | "other" | null = null;

    const updatePull = (next: number) => {
      pullDistanceRef.current = next;
      setPullDistance(next);
    };

    const handleTouchStart = (event: TouchEvent) => {
      if (refreshingRef.current || event.touches.length !== 1) {
        armed = false;
        return;
      }
      if (
        isIgnoredTarget(event.target) ||
        hasScrolledAncestor(event.target, root)
      ) {
        armed = false;
        return;
      }
      const touch = event.touches[0];
      if (!touch) {
        armed = false;
        return;
      }
      armed = true;
      lockedDirection = null;
      startX = touch.clientX;
      startY = touch.clientY;
    };

    const handleTouchMove = (event: TouchEvent) => {
      if (!armed || refreshingRef.current || event.touches.length !== 1) {
        return;
      }
      const touch = event.touches[0];
      if (!touch) {
        return;
      }
      const dx = touch.clientX - startX;
      const dy = touch.clientY - startY;

      if (lockedDirection === null) {
        if (
          Math.abs(dx) < GESTURE_START_THRESHOLD_PX &&
          Math.abs(dy) < GESTURE_START_THRESHOLD_PX
        ) {
          return;
        }
        if (dy <= 0 || Math.abs(dx) * GESTURE_HORIZONTAL_RATIO >= dy) {
          armed = false;
          lockedDirection = "other";
          return;
        }
        lockedDirection = "pull";
      }

      if (lockedDirection !== "pull") {
        return;
      }

      if (dy <= 0 || hasScrolledAncestor(event.target, root)) {
        updatePull(0);
        return;
      }

      const nextPull = Math.min(
        PULL_TO_REFRESH_MAX_PX,
        Math.round(dy * PULL_DAMPING)
      );
      if (nextPull > 0 && event.cancelable) {
        event.preventDefault();
      }
      updatePull(nextPull);
    };

    const finishGesture = () => {
      if (!armed) {
        return;
      }
      armed = false;
      const reachedThreshold =
        lockedDirection === "pull" &&
        pullDistanceRef.current >= PULL_TO_REFRESH_THRESHOLD_PX;
      lockedDirection = null;

      if (!reachedThreshold || refreshingRef.current) {
        updatePull(0);
        return;
      }

      refreshingRef.current = true;
      setRefreshing(true);
      updatePull(PULL_TO_REFRESH_THRESHOLD_PX);

      // checkForAppUpdate() is a global SW lifecycle check that should finish even if unmounted.
      void Promise.allSettled([
        checkForAppUpdate(),
        Promise.resolve(onRefreshRef.current()),
      ]).finally(() => {
        if (!mountedRef.current) {
          return;
        }
        refreshingRef.current = false;
        setRefreshing(false);
        updatePull(0);
      });
    };

    root.addEventListener("touchstart", handleTouchStart, { passive: true });
    root.addEventListener("touchmove", handleTouchMove, { passive: false });
    root.addEventListener("touchend", finishGesture, { passive: true });
    root.addEventListener("touchcancel", finishGesture, { passive: true });

    return () => {
      root.removeEventListener("touchstart", handleTouchStart);
      root.removeEventListener("touchmove", handleTouchMove);
      root.removeEventListener("touchend", finishGesture);
      root.removeEventListener("touchcancel", finishGesture);
    };
  }, [enabled]);

  const indicatorHeight = refreshing ? 44 : pullDistance;
  const isReady = pullDistance >= PULL_TO_REFRESH_THRESHOLD_PX;

  return (
    <div
      ref={rootRef}
      data-slot="pull-to-refresh"
      className={cn("relative flex min-h-0 min-w-0 flex-1 flex-col", className)}
    >
      <div
        aria-hidden={!refreshing}
        className={cn(
          "flex shrink-0 items-center justify-center overflow-hidden text-xs font-medium text-muted-foreground transition-[height,opacity] duration-150 ease-out motion-reduce:transition-none",
          indicatorHeight === 0 && "pointer-events-none"
        )}
        style={{
          height: indicatorHeight,
          opacity: refreshing
            ? 1
            : Math.min(1, pullDistance / PULL_TO_REFRESH_THRESHOLD_PX),
        }}
      >
        {indicatorHeight > INDICATOR_MIN_VISIBLE_HEIGHT_PX ? (
          <div
            className="flex items-center gap-2 py-2"
            role={refreshing ? "status" : undefined}
            aria-live={refreshing ? "polite" : undefined}
          >
            <HugeiconsIcon
              icon={refreshing ? Loading02Icon : RefreshDotIcon}
              className={cn("size-4 text-primary", refreshing && "animate-spin")}
              aria-hidden="true"
            />
            <span>
              {refreshing
                ? "Refreshing..."
                : isReady
                  ? "Release to refresh"
                  : "Pull to refresh"}
            </span>
          </div>
        ) : null}
      </div>
      {children}
    </div>
  );
}
