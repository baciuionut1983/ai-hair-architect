import { describe, expect, it } from "vitest";

import { getTabsListClasses, getTabTriggerClasses } from "./tabs";

// Mobile audit regression: the tab list previously had no wrap AND no
// scroll containment -- 5 tabs on a narrow phone made the row wider than
// the viewport, and since nothing clips overflow-x anywhere above it,
// that forced the WHOLE PAGE to scroll horizontally. overflow-x-auto on
// the list, shrink-0/whitespace-nowrap on each trigger, is the fix.
describe("getTabsListClasses", () => {
  it("contains its own horizontal scroll rather than letting tabs overflow the page", () => {
    expect(getTabsListClasses()).toContain("overflow-x-auto");
  });

  it("appends a caller-provided className", () => {
    expect(getTabsListClasses("mb-4")).toContain("mb-4");
  });
});

describe("getTabTriggerClasses", () => {
  it("never shrinks below its own label width or wraps it mid-word, so a scrollable strip stays legible", () => {
    const classes = getTabTriggerClasses(false);
    expect(classes).toContain("shrink-0");
    expect(classes).toContain("whitespace-nowrap");
  });

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
