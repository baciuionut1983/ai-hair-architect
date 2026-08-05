import { describe, expect, it } from "vitest";

import { getSelectClasses } from "./select";

describe("getSelectClasses", () => {
  it("uses the neutral border when there is no error", () => {
    const classes = getSelectClasses(false);
    expect(classes).toContain("border-border");
    expect(classes).not.toContain("border-danger");
  });

  it("switches to the danger border when there is an error", () => {
    expect(getSelectClasses(true)).toContain("border-danger");
  });

  it("reserves space for the chevron icon", () => {
    expect(getSelectClasses(false)).toContain("pr-9");
  });

  it("appends a caller-provided className", () => {
    expect(getSelectClasses(false, "max-w-xs")).toContain("max-w-xs");
  });
});
