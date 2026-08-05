import { describe, expect, it } from "vitest";

import { getCardClasses } from "./card";

describe("getCardClasses", () => {
  it("defaults to the static default variant", () => {
    const classes = getCardClasses();
    expect(classes).toContain("rounded-2xl");
    expect(classes).not.toContain("cursor-pointer");
  });

  it("adds interactive affordances for the interactive variant", () => {
    const classes = getCardClasses("interactive");
    expect(classes).toContain("cursor-pointer");
    expect(classes).toContain("focus-visible:ring-2");
  });

  it("appends a caller-provided className", () => {
    expect(getCardClasses("default", "col-span-2")).toContain("col-span-2");
  });
});
