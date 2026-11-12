import { renderHook, act } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useVirtualScroll } from "./use-virtual-scroll";

describe("useVirtualScroll", () => {
  const sampleItems = Array.from({ length: 100 }, (_, i) => `item-${i}`);

  it("handles empty items array gracefully", () => {
    const { result } = renderHook(() =>
      useVirtualScroll({
        items: [],
        itemHeight: 50,
      })
    );

    expect(result.current.virtualItems).toEqual([]);
    expect(result.current.topSpacerHeight).toBe(0);
    expect(result.current.bottomSpacerHeight).toBe(0);
  });

  it("calculates initial visible window with overscan", () => {
    const { result } = renderHook(() =>
      useVirtualScroll({
        items: sampleItems,
        itemHeight: 70,
        itemGap: 4,
        overscan: 4,
        defaultViewportHeight: 600,
      })
    );

    // rowPitch = 74. viewport = 600. visibleRowCount = ceil(600/74) + 8 = 9 + 8 = 17
    expect(result.current.topSpacerHeight).toBe(0);
    expect(result.current.virtualItems.length).toBeGreaterThanOrEqual(15);
    expect(result.current.bottomSpacerHeight).toBeGreaterThan(0);
  });

  it("updates window when scrolled", () => {
    const { result } = renderHook(() =>
      useVirtualScroll({
        items: sampleItems,
        itemHeight: 70,
        itemGap: 4,
        overscan: 2,
        defaultViewportHeight: 600,
      })
    );

    act(() => {
      result.current.onScroll({
        currentTarget: { scrollTop: 740 },
      } as any);
    });

    // Scrolled past ~10 items: startIndex should be around 8
    expect(result.current.topSpacerHeight).toBeGreaterThan(0);
    expect(result.current.virtualItems[0]).toBe("item-8");
  });

  it("resets scroll position and renders from the top immediately when resetKey changes", () => {
    let resetKey = 1;
    let items = sampleItems;

    const { result, rerender } = renderHook(() =>
      useVirtualScroll({
        items,
        itemHeight: 70,
        itemGap: 4,
        overscan: 2,
        defaultViewportHeight: 600,
        resetKey,
      })
    );

    // Scroll down deeply
    act(() => {
      result.current.onScroll({
        currentTarget: { scrollTop: 1480 },
      } as any);
    });
    expect(result.current.virtualItems[0]).toBe("item-18");

    // Change resetKey and switch to a short list of 3 items
    resetKey = 2;
    items = ["short-0", "short-1", "short-2"];
    rerender();

    // Must immediately render from the beginning without blank frame
    expect(result.current.topSpacerHeight).toBe(0);
    expect(result.current.virtualItems).toEqual(["short-0", "short-1", "short-2"]);
  });

  it("clamps startIndex to prevent empty virtualItems slice if scrolled past the end of new items list", () => {
    let items = sampleItems;

    const { result, rerender } = renderHook(() =>
      useVirtualScroll({
        items,
        itemHeight: 70,
        itemGap: 4,
        overscan: 2,
        defaultViewportHeight: 600,
      })
    );

    // Scroll down deeply (past index 20)
    act(() => {
      result.current.onScroll({
        currentTarget: { scrollTop: 1480 },
      } as any);
    });

    // Switch to short list without resetKey
    items = ["short-0", "short-1", "short-2"];
    rerender();

    // Should clamp rather than returning empty slice []
    expect(result.current.virtualItems.length).toBe(3);
    expect(result.current.virtualItems).toEqual(["short-0", "short-1", "short-2"]);
  });
});
