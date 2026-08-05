import { describe, expect, it } from "vitest";

import { DIALOG_BACKDROP_CLASSES, DIALOG_PANEL_CLASSES } from "./dialog";

// Dialog has no variant branching (open/closed is handled by an early
// return, not a class computation), so there is no getXClasses() function
// to unit-test here -- only the static base classes are verified without
// rendering.
describe("Dialog base classes", () => {
  it("centers the panel over a full-screen backdrop", () => {
    expect(DIALOG_BACKDROP_CLASSES).toContain("fixed inset-0");
    expect(DIALOG_BACKDROP_CLASSES).toContain("items-center");
    expect(DIALOG_BACKDROP_CLASSES).toContain("justify-center");
  });

  it("caps the panel width so it reads as a dialog, not a full page", () => {
    expect(DIALOG_PANEL_CLASSES).toContain("max-w-md");
  });
});
