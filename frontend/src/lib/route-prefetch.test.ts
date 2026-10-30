import { describe, expect, it, vi } from "vitest";

import { prefetchAllRoutes, prefetchRoute } from "./route-prefetch";

describe("prefetchRoute", () => {
  it("prefetches all known routes without throwing", () => {
    expect(() => prefetchAllRoutes()).not.toThrow();
  });
  it("does not throw for known routes", () => {
    expect(() => prefetchRoute("/home")).not.toThrow();
    expect(() => prefetchRoute("/subscriptions")).not.toThrow();
    expect(() => prefetchRoute("/audiobooks")).not.toThrow();
    expect(() => prefetchRoute("/abooks")).not.toThrow();
    expect(() => prefetchRoute("/settings")).not.toThrow();
  });

  it("safely ignores unknown routes", () => {
    expect(() => prefetchRoute("/unknown")).not.toThrow();
  });
});
