import { describe, expect, it } from "vitest";

import { DEFAULT_LOADING_LABEL, LOADING_STATE_BASE_CLASSES } from "./loading-state";

// LoadingState has no variant branching, so there is no getXClasses()
// function to unit-test here -- only the static base classes and default
// label are verified without rendering.
describe("LoadingState constants", () => {
  it("centers the spinner and label", () => {
    expect(LOADING_STATE_BASE_CLASSES).toContain("items-center");
    expect(LOADING_STATE_BASE_CLASSES).toContain("justify-center");
  });

  it("defaults the label to a generic loading message", () => {
    expect(DEFAULT_LOADING_LABEL).toBe("Loading...");
  });
});
