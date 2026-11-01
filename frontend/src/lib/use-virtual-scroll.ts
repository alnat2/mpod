import { useCallback, useEffect, useMemo, useRef, useState, type UIEvent } from "react";

export type UseVirtualScrollOptions<T> = {
  items: T[];
  itemHeight: number;
  itemGap?: number;
  overscan?: number;
  defaultViewportHeight?: number;
};

export function useVirtualScroll<T>({
  items,
  itemHeight,
  itemGap = 4,
  overscan = 4,
  defaultViewportHeight = 600,
}: UseVirtualScrollOptions<T>) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(defaultViewportHeight);

  const onScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    setScrollTop(event.currentTarget.scrollTop);
  }, []);

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

    const startIndex = Math.max(
      0,
      Math.floor(scrollTop / rowPitch) - overscan
    );
    const visibleRowCount = Math.ceil(viewportHeight / rowPitch) + overscan * 2;
    const endIndex = Math.min(totalCount, startIndex + visibleRowCount);

    return {
      startIndex,
      endIndex,
      virtualItems: items.slice(startIndex, endIndex),
      topSpacerHeight: startIndex * rowPitch,
      bottomSpacerHeight: (totalCount - endIndex) * rowPitch,
    };
  }, [items, itemGap, overscan, rowPitch, scrollTop, viewportHeight]);

  return {
    containerRef,
    onScroll,
    virtualItems: windowResult.virtualItems,
    topSpacerHeight: windowResult.topSpacerHeight,
    bottomSpacerHeight: windowResult.bottomSpacerHeight,
  };
}
