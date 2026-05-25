import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

class ResizeObserverMock {
  observe() {}

  unobserve() {}

  disconnect() {}
}

class IntersectionObserverMock {
  root = null;

  rootMargin = "";

  thresholds = [];

  disconnect() {}

  observe() {}

  takeRecords() {
    return [];
  }

  unobserve() {}
}

globalThis.ResizeObserver = ResizeObserverMock;
globalThis.IntersectionObserver = IntersectionObserverMock as typeof IntersectionObserver;
globalThis.matchMedia =
  globalThis.matchMedia ??
  ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }));

afterEach(() => {
  cleanup();
});
