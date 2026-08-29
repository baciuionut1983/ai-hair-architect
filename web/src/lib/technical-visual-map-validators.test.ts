import { describe, expect, it } from "vitest";

import {
  HEAD_ZONES,
  isHeadZone,
  isMapAdjustmentEntry,
  isPreserveConstraintArray,
  isPreserveConstraintEntry,
  isTechnicalVisualMapPayload,
  isZoneIntentArray,
  isZoneIntentEntry,
  isZoneRelationshipArray,
  isZoneRelationshipEntry,
  resolveEffectiveTechnicalVisualMap,
  type HeadZone,
  type MapAdjustmentEntry,
  type PreserveConstraintEntry,
  type TechnicalVisualMapPayload,
  type ZoneIntentEntry,
  type ZoneRelationshipEntry,
} from "./technical-visual-map-validators";

function zoneEntry(zone: HeadZone, overrides: Partial<ZoneIntentEntry> = {}): ZoneIntentEntry {
  return {
    zone,
    lengthIntent: "unspecified",
    lengthIntentSource: "global_default",
    weightIntent: "unspecified",
    weightIntentSource: "global_default",
    densitySensitive: false,
    densitySensitiveSource: "global_default",
    preserve: false,
    preserveSource: "global_default",
    ...overrides,
  };
}

function skeletonZones(): ZoneIntentEntry[] {
  return HEAD_ZONES.map((zone) => zoneEntry(zone));
}

function globalIntent() {
  return {
    structuralTechnique: "graduation" as const,
    cuttingTechnique: "slice_cutting" as const,
    texturizingTechnique: "point_cutting" as const,
    sectioning: "diagonal_back" as const,
    elevation: "45_deg_graduation" as const,
    distribution: "overdirected_back" as const,
    guideline: "traveling" as const,
  };
}

function payload(overrides: Partial<TechnicalVisualMapPayload> = {}): TechnicalVisualMapPayload {
  return {
    globalIntent: globalIntent(),
    zones: skeletonZones(),
    relationships: [],
    preserveConstraints: [],
    ...overrides,
  };
}

describe("isHeadZone", () => {
  it("1. accepts exactly the six locked HeadZone IDs", () => {
    for (const zone of HEAD_ZONES) {
      expect(isHeadZone(zone)).toBe(true);
    }
    expect(HEAD_ZONES).toEqual(["crown", "occipital", "nape", "top", "sides", "fringe"]);
  });

  it("2. rejects an unknown zone", () => {
    expect(isHeadZone("forehead")).toBe(false);
    expect(isHeadZone("")).toBe(false);
    expect(isHeadZone(123)).toBe(false);
  });

  it("3. rejects 'perimeter' as a HeadZone -- it is a constraint target, never an anatomical zone", () => {
    expect(isHeadZone("perimeter")).toBe(false);
  });

  it("rejects 'interior' and left/right temple -- excluded per the Decision Lock", () => {
    expect(isHeadZone("interior")).toBe(false);
    expect(isHeadZone("left_temple")).toBe(false);
    expect(isHeadZone("right_temple")).toBe(false);
    expect(isHeadZone("left_side")).toBe(false);
    expect(isHeadZone("right_side")).toBe(false);
  });
});

describe("isZoneIntentEntry / isZoneIntentArray", () => {
  it("accepts a valid, fully-unspecified zone entry", () => {
    expect(isZoneIntentEntry(zoneEntry("crown"))).toBe(true);
  });

  it("accepts a zone entry with a valid optional override + its source", () => {
    expect(
      isZoneIntentEntry(
        zoneEntry("nape", { elevationOverride: "90_deg_uniform_layer", elevationOverrideSource: "professional_adjustment" }),
      ),
    ).toBe(true);
  });

  it("5. rejects a malformed zone intent (invalid lengthIntent value)", () => {
    expect(isZoneIntentEntry({ ...zoneEntry("crown"), lengthIntent: "very_short" })).toBe(false);
  });

  it("6. rejects an invalid enum override (bad elevationOverride value)", () => {
    expect(
      isZoneIntentEntry({ ...zoneEntry("crown"), elevationOverride: "not_real", elevationOverrideSource: "professional_adjustment" }),
    ).toBe(false);
  });

  it("rejects an override source present without its value", () => {
    expect(isZoneIntentEntry({ ...zoneEntry("crown"), elevationOverrideSource: "professional_adjustment" })).toBe(false);
  });

  it("rejects a missing densitySensitive/preserve field", () => {
    const bad = zoneEntry("crown") as unknown as Record<string, unknown>;
    delete bad.densitySensitive;
    expect(isZoneIntentEntry(bad)).toBe(false);
  });

  it("1 (array form). accepts exactly the six zones, each once", () => {
    expect(isZoneIntentArray(skeletonZones())).toBe(true);
  });

  it("4. rejects a duplicate zone in the array", () => {
    const zones = skeletonZones();
    zones[5] = zoneEntry("crown"); // duplicate crown, missing fringe
    expect(isZoneIntentArray(zones)).toBe(false);
  });

  it("rejects an array with fewer than six zones", () => {
    expect(isZoneIntentArray(skeletonZones().slice(0, 5))).toBe(false);
  });

  it("rejects an array containing an unknown zone", () => {
    const zones = skeletonZones();
    zones[0] = { ...zones[0], zone: "forehead" as HeadZone };
    expect(isZoneIntentArray(zones)).toBe(false);
  });
});

describe("isZoneRelationshipEntry / isZoneRelationshipArray", () => {
  function rel(overrides: Partial<ZoneRelationshipEntry> = {}): ZoneRelationshipEntry {
    return { sourceZone: "sides", relationship: "shorter_than", targetZone: "crown", source: "professional_adjustment", ...overrides };
  }

  it("accepts a valid relationship", () => {
    expect(isZoneRelationshipEntry(rel())).toBe(true);
  });

  it("7. rejects a same-zone relationship", () => {
    expect(isZoneRelationshipEntry(rel({ sourceZone: "crown", targetZone: "crown" }))).toBe(false);
  });

  it("8. rejects an unknown zone in a relationship", () => {
    expect(isZoneRelationshipEntry(rel({ sourceZone: "forehead" as HeadZone }))).toBe(false);
  });

  it("8b. rejects a malformed/unknown relationship type", () => {
    expect(isZoneRelationshipEntry(rel({ relationship: "much_shorter_than" as never }))).toBe(false);
  });

  it("9. rejects an exact duplicate relationship in the array", () => {
    expect(isZoneRelationshipArray([rel(), rel()])).toBe(false);
  });

  it("9b. rejects a semantically-identical inverse duplicate (A shorter_than B, then B longer_than A)", () => {
    const inverse = rel({ sourceZone: "crown", relationship: "longer_than", targetZone: "sides" });
    expect(isZoneRelationshipArray([rel(), inverse])).toBe(false);
  });

  it("does not reject two independent, non-conflicting relationships", () => {
    const other = rel({ sourceZone: "nape", relationship: "same_length_as", targetZone: "occipital" });
    expect(isZoneRelationshipArray([rel(), other])).toBe(true);
  });

  it("does not treat two 'blends_into' entries in different directions as duplicates (no invented inverse)", () => {
    const a = rel({ sourceZone: "crown", relationship: "blends_into", targetZone: "top" });
    const b = rel({ sourceZone: "top", relationship: "blends_into", targetZone: "crown" });
    expect(isZoneRelationshipArray([a, b])).toBe(true);
  });
});

describe("isPreserveConstraintEntry / isPreserveConstraintArray", () => {
  it("accepts a valid respect_contraindication constraint", () => {
    expect(isPreserveConstraintEntry({ type: "respect_contraindication", reference: "x", source: "deterministic_evidence" })).toBe(
      true,
    );
  });

  it("accepts a valid zone-scoped preserve_hairline constraint", () => {
    expect(isPreserveConstraintEntry({ type: "preserve_hairline", zone: "fringe", source: "professional_adjustment" })).toBe(true);
  });

  it("10. rejects an invalid constraint type", () => {
    expect(isPreserveConstraintEntry({ type: "preserve_everything", source: "system_default" })).toBe(false);
  });

  it("rejects a zone on a non-zone-scoped constraint type", () => {
    expect(isPreserveConstraintEntry({ type: "respect_contraindication", zone: "crown", source: "deterministic_evidence" })).toBe(
      false,
    );
  });

  it("rejects an unknown zone on a zone-scoped constraint", () => {
    expect(isPreserveConstraintEntry({ type: "preserve_hairline", zone: "forehead", source: "professional_adjustment" })).toBe(
      false,
    );
  });

  it("rejects an exact duplicate constraint (same type, zone, and reference)", () => {
    const c: PreserveConstraintEntry = { type: "preserve_hairline", zone: "fringe", source: "professional_adjustment" };
    expect(isPreserveConstraintArray([c, { ...c }])).toBe(false);
  });

  it("does not reject two respect_contraindication entries with different reference text", () => {
    const a: PreserveConstraintEntry = { type: "respect_contraindication", reference: "a", source: "deterministic_evidence" };
    const b: PreserveConstraintEntry = { type: "respect_contraindication", reference: "b", source: "deterministic_evidence" };
    expect(isPreserveConstraintArray([a, b])).toBe(true);
  });
});

describe("isTechnicalVisualMapPayload", () => {
  it("accepts a valid full payload", () => {
    expect(isTechnicalVisualMapPayload(payload())).toBe(true);
  });

  it("rejects a payload with a malformed globalIntent", () => {
    expect(isTechnicalVisualMapPayload({ ...payload(), globalIntent: { structuralTechnique: "not_real" } })).toBe(false);
  });

  it("rejects a payload with fewer than six zones", () => {
    expect(isTechnicalVisualMapPayload({ ...payload(), zones: skeletonZones().slice(0, 3) })).toBe(false);
  });
});

describe("isMapAdjustmentEntry", () => {
  it("accepts a valid zone_length_intent adjustment", () => {
    expect(
      isMapAdjustmentEntry({
        target: "zone_length_intent",
        zone: "crown",
        previousValue: "unspecified",
        newValue: "preserve",
        source: "professional",
      }),
    ).toBe(true);
  });

  it("accepts a valid zone_relationship_add adjustment", () => {
    expect(
      isMapAdjustmentEntry({
        target: "zone_relationship_add",
        relationship: { sourceZone: "sides", relationship: "shorter_than", targetZone: "crown", source: "professional_adjustment" },
        source: "professional",
      }),
    ).toBe(true);
  });

  it("rejects an unknown adjustment target", () => {
    expect(isMapAdjustmentEntry({ target: "change_the_whole_haircut", source: "professional" })).toBe(false);
  });

  it("rejects a source other than 'professional'", () => {
    expect(
      isMapAdjustmentEntry({
        target: "zone_preserve",
        zone: "crown",
        previousValue: false,
        newValue: true,
        source: "ai",
      }),
    ).toBe(false);
  });

  it("structurally cannot target a proposal-global field -- there is no such discriminant value", () => {
    const forbiddenTargets = ["structuralTechnique", "cuttingTechnique", "elevation", "distribution", "guideline", "sectioning"];
    for (const target of forbiddenTargets) {
      expect(isMapAdjustmentEntry({ target, source: "professional" })).toBe(false);
    }
  });
});

describe("resolveEffectiveTechnicalVisualMap", () => {
  it("returns the baseline unchanged when there are no adjustments", () => {
    const baseline = payload();
    expect(resolveEffectiveTechnicalVisualMap(baseline, [])).toEqual(baseline);
  });

  it("applies a zone_length_intent adjustment to the correct zone only", () => {
    const baseline = payload();
    const adjustment: MapAdjustmentEntry = {
      target: "zone_length_intent",
      zone: "nape",
      previousValue: "unspecified",
      newValue: "preserve",
      source: "professional",
    };
    const effective = resolveEffectiveTechnicalVisualMap(baseline, [adjustment]);
    const nape = effective.zones.find((z) => z.zone === "nape")!;
    expect(nape.lengthIntent).toBe("preserve");
    expect(nape.lengthIntentSource).toBe("professional_adjustment");
    for (const zone of effective.zones) {
      if (zone.zone !== "nape") expect(zone.lengthIntent).toBe("unspecified");
    }
  });

  it("does not mutate the baseline payload", () => {
    const baseline = payload();
    const before = JSON.stringify(baseline);
    resolveEffectiveTechnicalVisualMap(baseline, [
      { target: "zone_preserve", zone: "crown", previousValue: false, newValue: true, source: "professional" },
    ]);
    expect(JSON.stringify(baseline)).toBe(before);
  });

  it("applies multiple adjustments deterministically, in array order, last-write-wins per field", () => {
    const baseline = payload();
    const adjustments: MapAdjustmentEntry[] = [
      { target: "zone_weight_intent", zone: "crown", previousValue: "unspecified", newValue: "reduce", source: "professional" },
      { target: "zone_weight_intent", zone: "crown", previousValue: "reduce", newValue: "build", source: "professional" },
    ];
    const effective = resolveEffectiveTechnicalVisualMap(baseline, adjustments);
    expect(effective.zones.find((z) => z.zone === "crown")!.weightIntent).toBe("build");
  });

  it("adds a zone relationship additively without disturbing existing zones", () => {
    const baseline = payload();
    const relationship: ZoneRelationshipEntry = {
      sourceZone: "sides",
      relationship: "shorter_than",
      targetZone: "crown",
      source: "professional_adjustment",
    };
    const effective = resolveEffectiveTechnicalVisualMap(baseline, [
      { target: "zone_relationship_add", relationship, source: "professional" },
    ]);
    expect(effective.relationships).toEqual([relationship]);
    expect(effective.zones).toEqual(baseline.zones);
  });

  it("adds a map-level preserve constraint additively", () => {
    const baseline = payload();
    const constraint: PreserveConstraintEntry = { type: "preserve_perimeter_weight", source: "professional_adjustment" };
    const effective = resolveEffectiveTechnicalVisualMap(baseline, [
      { target: "map_preserve_constraint_add", constraint, source: "professional" },
    ]);
    expect(effective.preserveConstraints).toEqual([constraint]);
  });

  it("clearing an elevation override (newValue: null) removes both the value and its source", () => {
    const baseline = payload({
      zones: skeletonZones().map((z) =>
        z.zone === "nape" ? { ...z, elevationOverride: "90_deg_uniform_layer" as const, elevationOverrideSource: "professional_adjustment" as const } : z,
      ),
    });
    const effective = resolveEffectiveTechnicalVisualMap(baseline, [
      { target: "zone_elevation_override", zone: "nape", previousValue: "90_deg_uniform_layer", newValue: null, source: "professional" },
    ]);
    const nape = effective.zones.find((z) => z.zone === "nape")!;
    expect(nape.elevationOverride).toBeUndefined();
    expect(nape.elevationOverrideSource).toBeUndefined();
  });

  it("never mutates the globalIntent -- it is not a valid adjustment target", () => {
    const baseline = payload();
    const effective = resolveEffectiveTechnicalVisualMap(baseline, [
      { target: "zone_preserve", zone: "top", previousValue: false, newValue: true, source: "professional" },
    ]);
    expect(effective.globalIntent).toEqual(baseline.globalIntent);
  });
});
