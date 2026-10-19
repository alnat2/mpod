import { describe, expect, it, vi } from "vitest";

import { prefetchRoute } from "./route-prefetch";

describe("prefetchRoute", () => {
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
