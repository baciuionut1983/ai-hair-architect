import { describe, expect, it } from "vitest";

import { getSpatialBindingStatusBadgeVariant, getSpatialBindingStatusLabel } from "./spatial-binding-status-badge";

describe("getSpatialBindingStatusBadgeVariant", () => {
  it("25/26. maps every lifecycle status, incl. SUPERSEDED, to its badge variant", () => {
    expect(getSpatialBindingStatusBadgeVariant("DRAFT")).toBe("neutral");
    expect(getSpatialBindingStatusBadgeVariant("CONFIRMED")).toBe("success");
    expect(getSpatialBindingStatusBadgeVariant("SUPERSEDED")).toBe("warning");
  });
});

describe("getSpatialBindingStatusLabel", () => {
  it("maps every lifecycle status to a human label", () => {
    expect(getSpatialBindingStatusLabel("DRAFT")).toBe("Draft");
    expect(getSpatialBindingStatusLabel("CONFIRMED")).toBe("Confirmed");
    expect(getSpatialBindingStatusLabel("SUPERSEDED")).toBe("Superseded");
  });
});
