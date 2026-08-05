import { describe, expect, it } from "vitest";

import { EMPTY_STATE_BASE_CLASSES } from "./empty-state";

// EmptyState has no variant branching (unlike Button/Card/Input/Select/
// Badge/Alert), so there is no getXClasses() function to unit-test here --
// only the static base class string is verified without rendering.
describe("EMPTY_STATE_BASE_CLASSES", () => {
  it("centers content and uses a dashed border to read as a placeholder, not an error", () => {
    expect(EMPTY_STATE_BASE_CLASSES).toContain("items-center");
    expect(EMPTY_STATE_BASE_CLASSES).toContain("border-dashed");
  });
});
