import { describe, expect, it } from "vitest";

import {
  getTechnicalVisualMapStatusBadgeVariant,
  getTechnicalVisualMapStatusLabel,
} from "./technical-visual-map-status-badge";

describe("getTechnicalVisualMapStatusBadgeVariant", () => {
  it("maps every lifecycle status to its badge variant", () => {
    expect(getTechnicalVisualMapStatusBadgeVariant("DRAFT")).toBe("neutral");
    expect(getTechnicalVisualMapStatusBadgeVariant("CONFIRMED")).toBe("success");
    expect(getTechnicalVisualMapStatusBadgeVariant("SUPERSEDED")).toBe("warning");
    expect(getTechnicalVisualMapStatusBadgeVariant("unknown")).toBe("neutral");
  });
});

describe("getTechnicalVisualMapStatusLabel", () => {
  it("9. maps every lifecycle status to a human label, including SUPERSEDED staying read-only-flavored", () => {
    expect(getTechnicalVisualMapStatusLabel("DRAFT")).toBe("Draft");
    expect(getTechnicalVisualMapStatusLabel("CONFIRMED")).toBe("Confirmed");
    expect(getTechnicalVisualMapStatusLabel("SUPERSEDED")).toBe("Superseded");
    expect(getTechnicalVisualMapStatusLabel("unknown")).toBe("unknown");
  });
});
