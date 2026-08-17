import { describe, expect, it } from "vitest";

import { getSidebarItemClasses, getSidebarNavClasses } from "./sidebar";

describe("getSidebarItemClasses", () => {
  it("highlights the active item with the accent color", () => {
    const classes = getSidebarItemClasses(true);
    expect(classes).toContain("text-accent");
    expect(classes).toContain("bg-accent/15");
  });

  it("uses muted styling for inactive items", () => {
    const classes = getSidebarItemClasses(false);
    expect(classes).toContain("text-muted");
    expect(classes).not.toContain("text-accent");
  });

  it("appends a caller-provided className", () => {
    expect(getSidebarItemClasses(false, "mt-2")).toContain("mt-2");
  });
});

// Mobile audit regression: the mobile drawer's nav reuses this same class
// string (see sidebar.tsx) -- without bottom safe-area padding, its last
// item could land flush against, or under, iPhone's home-indicator area.
describe("getSidebarNavClasses", () => {
  it("pads the bottom for iPhone's safe area, on top of the base spacing", () => {
    const classes = getSidebarNavClasses();
    expect(classes).toContain("safe-area-inset-bottom");
    expect(classes).toContain("p-4");
  });
});
