import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { checkForAppUpdate } from "@/lib/pwa-update";

import {
  PULL_TO_REFRESH_THRESHOLD_PX,
  PullToRefresh,
} from "./pull-to-refresh";

vi.mock("@/lib/pwa-update", () => ({
  checkForAppUpdate: vi.fn().mockResolvedValue(false),
}));

function touchEventInit(clientX: number, clientY: number) {
  return {
    touches: [{ clientX, clientY }],
    cancelable: true,
  };
}

describe("PullToRefresh", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("triggers onRefresh and checkForAppUpdate when pulled past threshold from scroll top", async () => {
    let resolveRefresh!: () => void;
    const onRefresh = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveRefresh = resolve;
        })
    );

    const { container } = render(
      <PullToRefresh enabled onRefresh={onRefresh}>
        <div data-testid="content">Subscriptions content</div>
      </PullToRefresh>
    );

    const root = container.querySelector('[data-slot="pull-to-refresh"]')!;
    const content = screen.getByTestId("content");

    fireEvent.touchStart(content, touchEventInit(100, 100));
    fireEvent.touchMove(root, touchEventInit(100, 170));
    expect(screen.getByText("Pull to refresh")).toBeInTheDocument();

    fireEvent.touchMove(root, touchEventInit(100, 100 + Math.ceil(PULL_TO_REFRESH_THRESHOLD_PX / 0.45) + 10));
    expect(screen.getByText("Release to refresh")).toBeInTheDocument();

    fireEvent.touchEnd(root);

    await waitFor(() => {
      expect(onRefresh).toHaveBeenCalledTimes(1);
      expect(checkForAppUpdate).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByText("Refreshing...")).toBeInTheDocument();

    await act(async () => {
      resolveRefresh();
    });

    await waitFor(() => {
      expect(screen.queryByText("Refreshing...")).not.toBeInTheDocument();
    });
  });

  it("does not trigger when a nested scroll container is scrolled down", () => {
    const onRefresh = vi.fn();

    const { container } = render(
      <PullToRefresh enabled onRefresh={onRefresh}>
        <div data-testid="scroller" style={{ overflowY: "auto" }}>
          <div data-testid="inner">Episode row</div>
        </div>
      </PullToRefresh>
    );

    const root = container.querySelector('[data-slot="pull-to-refresh"]')!;
    const scroller = screen.getByTestId("scroller");
    Object.defineProperty(scroller, "scrollTop", {
      configurable: true,
      value: 120,
    });

    fireEvent.touchStart(screen.getByTestId("inner"), touchEventInit(100, 100));
    fireEvent.touchMove(root, touchEventInit(100, 300));
    fireEvent.touchEnd(root);

    expect(onRefresh).not.toHaveBeenCalled();
    expect(screen.queryByText("Pull to refresh")).not.toBeInTheDocument();
  });

  it("ignores horizontal carousel swipes", () => {
    const onRefresh = vi.fn();

    const { container } = render(
      <PullToRefresh enabled onRefresh={onRefresh}>
        <div data-testid="carousel-area">Carousel</div>
      </PullToRefresh>
    );

    const root = container.querySelector('[data-slot="pull-to-refresh"]')!;

    fireEvent.touchStart(screen.getByTestId("carousel-area"), touchEventInit(100, 100));
    fireEvent.touchMove(root, touchEventInit(220, 115));
    fireEvent.touchMove(root, touchEventInit(220, 260));
    fireEvent.touchEnd(root);

    expect(onRefresh).not.toHaveBeenCalled();
  });

  it("ignores touches starting on slider controls", () => {
    const onRefresh = vi.fn();

    const { container } = render(
      <PullToRefresh enabled onRefresh={onRefresh}>
        <div role="slider" aria-valuenow={10} data-testid="slider" />
      </PullToRefresh>
    );

    const root = container.querySelector('[data-slot="pull-to-refresh"]')!;

    fireEvent.touchStart(screen.getByTestId("slider"), touchEventInit(100, 100));
    fireEvent.touchMove(root, touchEventInit(100, 300));
    fireEvent.touchEnd(root);

    expect(onRefresh).not.toHaveBeenCalled();
  });
});
