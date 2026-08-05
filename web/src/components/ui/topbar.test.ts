import { describe, expect, it } from "vitest";

import { TOPBAR_BASE_CLASSES } from "./topbar";

// Topbar has no variant branching, so there is no getXClasses() function to
// unit-test here -- only the static base classes are verified without
// rendering.
describe("TOPBAR_BASE_CLASSES", () => {
  it("separates the topbar from the content area with a bottom border", () => {
    expect(TOPBAR_BASE_CLASSES).toContain("border-b");
  });

  it("keeps the menu button and the logout button apart", () => {
    expect(TOPBAR_BASE_CLASSES).toContain("justify-between");
  });
});
