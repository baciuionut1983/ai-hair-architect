import { describe, expect, it } from "vitest";

import { getTabTriggerClasses } from "./tabs";

describe("getTabTriggerClasses", () => {
  it("highlights the active tab with the accent color and a solid underline", () => {
    const classes = getTabTriggerClasses(true);
    expect(classes).toContain("text-accent");
    expect(classes).toContain("border-accent");
  });

  it("uses a transparent underline and muted text for inactive tabs", () => {
    const classes = getTabTriggerClasses(false);
    expect(classes).toContain("border-transparent");
    expect(classes).toContain("text-muted");
  });

  it("appends a caller-provided className", () => {
    expect(getTabTriggerClasses(false, "shrink-0")).toContain("shrink-0");
  });
});
