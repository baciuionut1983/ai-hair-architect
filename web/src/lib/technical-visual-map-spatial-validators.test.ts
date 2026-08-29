import { describe, expect, it } from "vitest";

import {
  applySpatialBindingEditOperation,
  buildInitialSpatialPayload,
  isNormalizedCoordinate,
  isSpatialBindingEditOperation,
  isSpatialPerimeter,
  isSpatialZoneArray,
  isSpatialZoneEntry,
  isTechnicalVisualMapSpatialPayload,
  isViewLabel,
  type SpatialZoneEntry,
  type TechnicalVisualMapSpatialPayload,
} from "./technical-visual-map-spatial-validators";

function zone(overrides: Partial<SpatialZoneEntry> = {}): SpatialZoneEntry {
  return { zone: "crown", state: "not_placed", ...overrides } as SpatialZoneEntry;
}

function sixZones(overrides: Partial<Record<string, SpatialZoneEntry>> = {}): SpatialZoneEntry[] {
  const zones = ["crown", "occipital", "nape", "top", "sides", "fringe"] as const;
  return zones.map((z) => overrides[z] ?? zone({ zone: z }));
}

function validPayload(overrides: Partial<TechnicalVisualMapSpatialPayload> = {}): TechnicalVisualMapSpatialPayload {
  return { zones: sixZones(), perimeter: { state: "not_placed" }, ...overrides };
}

describe("isSpatialZoneArray", () => {
  it("1. exact six zones valid", () => {
    expect(isSpatialZoneArray(sixZones())).toBe(true);
  });

  it("2. unknown zone rejected", () => {
    const zones = sixZones();
    zones[0] = zone({ zone: "temple" as never });
    expect(isSpatialZoneArray(zones)).toBe(false);
  });

  it("3. duplicate zone rejected", () => {
    const zones = sixZones();
    zones[1] = zone({ zone: "crown" }); // duplicate of zones[0]
    expect(isSpatialZoneArray(zones)).toBe(false);
  });

  it("4. missing zone rejected", () => {
    expect(isSpatialZoneArray(sixZones().slice(0, 5))).toBe(false);
  });

  it("5. perimeter as HeadZone rejected", () => {
    const zones = sixZones();
    zones[0] = zone({ zone: "perimeter" as never });
    expect(isSpatialZoneArray(zones)).toBe(false);
  });
});

describe("isSpatialZoneEntry -- placed anchors", () => {
  it("6. placed anchor requires x/y", () => {
    expect(isSpatialZoneEntry({ zone: "crown", state: "placed", source: "professional" })).toBe(false);
  });

  it("7. x < 0 rejected", () => {
    expect(isSpatialZoneEntry({ zone: "crown", state: "placed", x: -0.01, y: 0.5, source: "professional" })).toBe(false);
  });

  it("8. x > 1 rejected", () => {
    expect(isSpatialZoneEntry({ zone: "crown", state: "placed", x: 1.01, y: 0.5, source: "professional" })).toBe(false);
  });

  it("9. y < 0 rejected", () => {
    expect(isSpatialZoneEntry({ zone: "crown", state: "placed", x: 0.5, y: -0.01, source: "professional" })).toBe(false);
  });

  it("10. y > 1 rejected", () => {
    expect(isSpatialZoneEntry({ zone: "crown", state: "placed", x: 0.5, y: 1.01, source: "professional" })).toBe(false);
  });

  it("11. non-finite coordinates rejected (NaN, Infinity)", () => {
    expect(isNormalizedCoordinate(NaN)).toBe(false);
    expect(isNormalizedCoordinate(Infinity)).toBe(false);
    expect(isNormalizedCoordinate(-Infinity)).toBe(false);
    expect(isSpatialZoneEntry({ zone: "crown", state: "placed", x: NaN, y: 0.5, source: "professional" })).toBe(false);
    expect(isSpatialZoneEntry({ zone: "crown", state: "placed", x: 0.5, y: Infinity, source: "professional" })).toBe(false);
  });

  it("valid placed anchor at the exact boundary values (0 and 1) is accepted", () => {
    expect(isSpatialZoneEntry({ zone: "crown", state: "placed", x: 0, y: 1, source: "professional" })).toBe(true);
  });

  it("12. not_placed with coordinates rejected", () => {
    expect(isSpatialZoneEntry({ zone: "crown", state: "not_placed", x: 0.5, y: 0.5 })).toBe(false);
  });

  it("13. not_visible with coordinates rejected", () => {
    expect(isSpatialZoneEntry({ zone: "crown", state: "not_visible", x: 0.5, y: 0.5 })).toBe(false);
  });
});

describe("isSpatialPerimeter", () => {
  it("14. valid perimeter polyline accepted", () => {
    expect(
      isSpatialPerimeter({ state: "placed", points: [{ x: 0.3, y: 0.5 }, { x: 0.7, y: 0.5 }], source: "professional" }),
    ).toBe(true);
  });

  it("15. too few perimeter points rejected", () => {
    expect(isSpatialPerimeter({ state: "placed", points: [], source: "professional" })).toBe(false);
    expect(isSpatialPerimeter({ state: "placed", points: [{ x: 0.3, y: 0.5 }], source: "professional" })).toBe(false);
  });

  it("16. out-of-range perimeter point rejected", () => {
    expect(
      isSpatialPerimeter({ state: "placed", points: [{ x: 0.3, y: 0.5 }, { x: 1.5, y: 0.5 }], source: "professional" }),
    ).toBe(false);
  });

  it("not_placed/not_visible perimeter with stray points is rejected", () => {
    expect(isSpatialPerimeter({ state: "not_placed", points: [{ x: 0.1, y: 0.1 }] })).toBe(false);
    expect(isSpatialPerimeter({ state: "not_visible", points: [{ x: 0.1, y: 0.1 }] })).toBe(false);
  });

  it("not_placed and not_visible perimeter (no extra fields) are valid", () => {
    expect(isSpatialPerimeter({ state: "not_placed" })).toBe(true);
    expect(isSpatialPerimeter({ state: "not_visible" })).toBe(true);
  });
});

describe("isViewLabel", () => {
  it("17. invalid viewLabel rejected, every locked value accepted", () => {
    expect(isViewLabel("top_down")).toBe(false);
    expect(isViewLabel("")).toBe(false);
    for (const label of ["front", "left_profile", "right_profile", "back", "other"]) {
      expect(isViewLabel(label)).toBe(true);
    }
  });
});

describe("buildInitialSpatialPayload", () => {
  it("18. deterministic skeleton valid, all zones not_placed, perimeter not_placed", () => {
    const skeleton = buildInitialSpatialPayload();
    expect(isTechnicalVisualMapSpatialPayload(skeleton)).toBe(true);
    expect(skeleton.zones.every((z) => z.state === "not_placed")).toBe(true);
    expect(skeleton.perimeter).toEqual({ state: "not_placed" });
    // Deterministic: repeated calls are deep-equal.
    expect(buildInitialSpatialPayload()).toEqual(skeleton);
  });

  it("the skeleton is valid against the full payload validator", () => {
    expect(isTechnicalVisualMapSpatialPayload(validPayload())).toBe(true);
  });
});

describe("edit operations", () => {
  it("isSpatialBindingEditOperation validates each operation type", () => {
    expect(isSpatialBindingEditOperation({ op: "set_zone_anchor", zone: "nape", x: 0.5, y: 0.5 })).toBe(true);
    expect(isSpatialBindingEditOperation({ op: "set_zone_anchor", zone: "nape", x: 1.5, y: 0.5 })).toBe(false);
    expect(isSpatialBindingEditOperation({ op: "set_zone_not_visible", zone: "nape" })).toBe(true);
    expect(isSpatialBindingEditOperation({ op: "reset_zone", zone: "nape" })).toBe(true);
    expect(isSpatialBindingEditOperation({ op: "set_perimeter", points: [{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.2 }] })).toBe(true);
    expect(isSpatialBindingEditOperation({ op: "set_perimeter", points: [{ x: 0.1, y: 0.1 }] })).toBe(false);
    expect(isSpatialBindingEditOperation({ op: "set_perimeter_not_visible" })).toBe(true);
    expect(isSpatialBindingEditOperation({ op: "reset_perimeter" })).toBe(true);
    expect(isSpatialBindingEditOperation({ op: "not_a_real_op" })).toBe(false);
  });

  it("applying set_zone_anchor updates only the targeted zone", () => {
    const before = buildInitialSpatialPayload();
    const after = applySpatialBindingEditOperation(before, { op: "set_zone_anchor", zone: "nape", x: 0.4, y: 0.6 });
    const napeEntry = after.zones.find((z) => z.zone === "nape");
    expect(napeEntry).toEqual({ zone: "nape", state: "placed", x: 0.4, y: 0.6, source: "professional" });
    expect(after.zones.filter((z) => z.zone !== "nape").every((z) => z.state === "not_placed")).toBe(true);
    // Never mutates the input.
    expect(before.zones.find((z) => z.zone === "nape")).toEqual({ zone: "nape", state: "not_placed" });
  });

  it("applying set_perimeter then set_perimeter_not_visible correctly overwrites the prior state", () => {
    const start = buildInitialSpatialPayload();
    const withPerimeter = applySpatialBindingEditOperation(start, {
      op: "set_perimeter",
      points: [{ x: 0.2, y: 0.5 }, { x: 0.8, y: 0.5 }],
    });
    expect(withPerimeter.perimeter.state).toBe("placed");
    const madeNotVisible = applySpatialBindingEditOperation(withPerimeter, { op: "set_perimeter_not_visible" });
    expect(madeNotVisible.perimeter).toEqual({ state: "not_visible" });
  });
});
