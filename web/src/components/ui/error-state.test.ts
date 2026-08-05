import { describe, expect, it } from "vitest";

import { ERROR_STATE_BASE_CLASSES } from "./error-state";

// ErrorState has no variant branching, so there is no getXClasses()
// function to unit-test here -- only the static base classes are verified
// without rendering.
describe("ERROR_STATE_BASE_CLASSES", () => {
  it("uses the danger palette so it reads distinctly from EmptyState", () => {
    expect(ERROR_STATE_BASE_CLASSES).toContain("border-danger/40");
    expect(ERROR_STATE_BASE_CLASSES).toContain("bg-danger/5");
  });
});
