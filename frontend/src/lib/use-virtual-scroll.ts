import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type UIEvent } from "react";

export type UseVirtualScrollOptions<T> = {
  items: T[];
  itemHeight: number;
  itemGap?: number;
  overscan?: number;
  defaultViewportHeight?: number;
  resetKey?: unknown;
};

export function useVirtualScroll<T>({
  items,
  itemHeight,
  itemGap = 4,
  overscan = 4,
  defaultViewportHeight = 600,
  resetKey,
}: UseVirtualScrollOptions<T>) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(defaultViewportHeight);

  // Synchronously reset scrollTop during rendering if resetKey changed
  const [prevResetKey, setPrevResetKey] = useState(resetKey);
  let effectiveScrollTop = scrollTop;
  if (resetKey !== prevResetKey) {
    setPrevResetKey(resetKey);
    setScrollTop(0);
    effectiveScrollTop = 0;
  }

  const onScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    setScrollTop(event.currentTarget.scrollTop);
  }, []);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (container && resetKey !== undefined) {
      container.scrollTop = 0;
    }
  }, [resetKey]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const syncHeight = () => {
      setViewportHeight(container.clientHeight || defaultViewportHeight);
    };

    syncHeight();
    setScrollTop(container.scrollTop);

    if (typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(syncHeight);
    observer.observe(container);
    return () => observer.disconnect();
  }, [defaultViewportHeight, items.length]);

  const rowPitch = itemHeight + itemGap;

  const windowResult = useMemo(() => {
    const totalCount = items.length;
    if (totalCount === 0) {
      return {
        startIndex: 0,
        endIndex: 0,
        virtualItems: [] as T[],
        topSpacerHeight: 0,
        bottomSpacerHeight: 0,
      };
    }

    const rawStartIndex = Math.max(
      0,
      Math.floor(effectiveScrollTop / rowPitch) - overscan
    );
    const visibleRowCount = Math.ceil(viewportHeight / rowPitch) + overscan * 2;
    // Clamping to avoid slicing out-of-bounds if scrollTop was out of sync
    const startIndex = Math.min(
      rawStartIndex,
      Math.max(0, totalCount - visibleRowCount)
    );
    const endIndex = Math.min(totalCount, startIndex + visibleRowCount);

    return {
      startIndex,
      endIndex,
      virtualItems: items.slice(startIndex, endIndex),
      topSpacerHeight: startIndex * rowPitch,
      bottomSpacerHeight: (totalCount - endIndex) * rowPitch,
    };
  }, [items, itemGap, overscan, rowPitch, effectiveScrollTop, viewportHeight]);

  return {
    containerRef,
    onScroll,
    virtualItems: windowResult.virtualItems,
    topSpacerHeight: windowResult.topSpacerHeight,
    bottomSpacerHeight: windowResult.bottomSpacerHeight,
  };
}
