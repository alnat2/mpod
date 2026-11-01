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
});
