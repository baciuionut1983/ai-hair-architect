import { describe, expect, it } from "vitest";

import { getInputClasses } from "./input";

describe("getInputClasses", () => {
  it("uses the neutral border when there is no error", () => {
    const classes = getInputClasses(false);
    expect(classes).toContain("border-border");
    expect(classes).not.toContain("border-danger");
  });

  it("switches to the danger border when there is an error", () => {
    expect(getInputClasses(true)).toContain("border-danger");
  });

  it("appends a caller-provided className", () => {
    expect(getInputClasses(false, "max-w-xs")).toContain("max-w-xs");
  });
});
