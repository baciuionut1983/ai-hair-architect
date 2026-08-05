import { describe, expect, it } from "vitest";

import { getSidebarItemClasses } from "./sidebar";

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
