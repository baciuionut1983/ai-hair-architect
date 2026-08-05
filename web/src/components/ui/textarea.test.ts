import { describe, expect, it } from "vitest";

import { getTextareaClasses } from "./textarea";

describe("getTextareaClasses", () => {
  it("uses the neutral border when there is no error", () => {
    const classes = getTextareaClasses(false);
    expect(classes).toContain("border-border");
    expect(classes).not.toContain("border-danger");
  });

  it("switches to the danger border when there is an error", () => {
    expect(getTextareaClasses(true)).toContain("border-danger");
  });

  it("appends a caller-provided className", () => {
    expect(getTextareaClasses(false, "min-h-[120px]")).toContain("min-h-[120px]");
  });
});
