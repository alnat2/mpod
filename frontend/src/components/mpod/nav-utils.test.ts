import { describe, expect, it } from "vitest";

import { getActiveNavItem } from "./nav-utils";

describe("getActiveNavItem", () => {
  it("resolves route pathnames to navigation item labels", () => {
    expect(getActiveNavItem("/subscriptions")).toBe("Subscriptions");
    expect(getActiveNavItem("/audiobooks")).toBe("Audiobooks");
    expect(getActiveNavItem("/abooks")).toBe("Audiobooks");
    expect(getActiveNavItem("/settings")).toBe("Settings");
    expect(getActiveNavItem("/home")).toBe("Player");
    expect(getActiveNavItem("/")).toBe("Player");
    expect(getActiveNavItem("/unknown")).toBe("Player");
  });
});
