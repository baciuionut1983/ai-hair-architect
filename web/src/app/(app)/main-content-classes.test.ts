import { describe, expect, it } from "vitest";

import { getMainContentClasses } from "./main-content-classes";

describe("getMainContentClasses", () => {
  it("reserves iPhone's bottom safe area on top of the base padding", () => {
    const classes = getMainContentClasses();
    expect(classes).toContain("safe-area-inset-bottom");
    expect(classes).toContain("p-4");
    expect(classes).toContain("md:p-8");
  });
});
