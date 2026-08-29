import { describe, expect, it } from "vitest";

import type { TechnicalVisualMapRecord } from "@/lib/technical-visual-map-repository";
import type { ZoneIntentEntry, ZoneRelationshipEntry } from "@/lib/technical-visual-map-validators";

import {
  availableTargetZones,
  buildZoneAdjustmentEntries,
  findExistingDraftMap,
  formatRelationship,
  mapTechnicalVisualMapApiError,
  resolveHistoryRowEffectiveMap,
  resolveTechnicalVisualMapLoadStatus,
  seedZoneFormValues,
  unorderedPairKey,
  zoneFieldSourceBadgeLabel,
  zonePairAlreadyRelated,
  type ZoneFormValues,
} from "./technical-visual-map-logic";

function zoneEntry(overrides: Partial<ZoneIntentEntry> = {}): ZoneIntentEntry {
  return {
    zone: "crown",
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

function mapRecord(overrides: Partial<TechnicalVisualMapRecord> = {}): TechnicalVisualMapRecord {
  return {
    id: "map-1",
    ownerUserId: "owner-1",
    clientId: "client-1",
    analysisProposalId: "proposal-1",
    vertical: "cutting",
    status: "DRAFT",
    mapVersion: 1,
    schemaVersion: "1.0.0",
    payload: { globalIntent: {} as never, zones: [], relationships: [], preserveConstraints: [] },
    sourceImageAssetId: null,
    sourceImageAnalysisId: null,
    generatorVersion: "1.0.0-tvm1",
    professionalAdjustments: [],
    supersededByMapId: null,
    confirmedAt: null,
    supersededAt: null,
    createdAt: "2026-08-29T00:00:00.000Z",
    updatedAt: "2026-08-29T00:00:00.000Z",
    ...overrides,
  };
}

describe("resolveTechnicalVisualMapLoadStatus", () => {
  it("maps an ok response to ready and a non-ok response to error", () => {
    expect(resolveTechnicalVisualMapLoadStatus({ ok: true, status: 200 })).toBe("ready");
    expect(resolveTechnicalVisualMapLoadStatus({ ok: false, status: 500 })).toBe("error");
  });
});

describe("findExistingDraftMap", () => {
  it("returns the DRAFT map from history, or null when none exists", () => {
    const draft = mapRecord({ id: "map-draft", status: "DRAFT" });
    const confirmed = mapRecord({ id: "map-confirmed", status: "CONFIRMED" });
    expect(findExistingDraftMap([confirmed, draft])).toEqual(draft);
    expect(findExistingDraftMap([confirmed])).toBeNull();
    expect(findExistingDraftMap([])).toBeNull();
  });
});

describe("resolveHistoryRowEffectiveMap", () => {
  it("13. returns the professionally-adjusted value, never the frozen baseline alone -- regression guard for the exact bug category Proposed Look's CurrentApprovedLook already caught once", () => {
    const baselineZone = zoneEntry({ zone: "nape", lengthIntent: "unspecified", lengthIntentSource: "global_default" });
    const record = mapRecord({
      payload: { globalIntent: {} as never, zones: [baselineZone], relationships: [], preserveConstraints: [] },
      professionalAdjustments: [
        { target: "zone_length_intent", zone: "nape", previousValue: "unspecified", newValue: "preserve", source: "professional" },
      ],
    });

    const effective = resolveHistoryRowEffectiveMap(record);
    const napeEffective = effective.zones.find((z) => z.zone === "nape");

    expect(napeEffective?.lengthIntent).toBe("preserve");
    expect(napeEffective?.lengthIntentSource).toBe("professional_adjustment");
    // The frozen baseline itself is untouched -- proving this is a display
    // derivation, not a mutation.
    expect(record.payload.zones[0].lengthIntent).toBe("unspecified");
    // And explicitly: the effective result must differ from the raw baseline
    // whenever an adjustment exists -- this is the exact assertion that would
    // fail if this call site were ever swapped back to `record.payload` alone.
    expect(napeEffective?.lengthIntent).not.toBe(record.payload.zones[0].lengthIntent);
  });

  it("returns the baseline unchanged when there are no professional adjustments", () => {
    const baselineZone = zoneEntry({ zone: "crown", lengthIntent: "shorten" });
    const record = mapRecord({
      payload: { globalIntent: {} as never, zones: [baselineZone], relationships: [], preserveConstraints: [] },
      professionalAdjustments: [],
    });
    const effective = resolveHistoryRowEffectiveMap(record);
    expect(effective.zones).toEqual(record.payload.zones);
  });
});

describe("mapTechnicalVisualMapApiError", () => {
  it("maps every documented status/code to a safe, non-raw message", () => {
    expect(mapTechnicalVisualMapApiError(401)).toBe("Please sign in again.");
    expect(mapTechnicalVisualMapApiError(404)).toContain("no longer available");
    expect(mapTechnicalVisualMapApiError(409, "TECHNICAL_VISUAL_MAP_CONFIRMATION_CONFLICT")).toContain("Another map was confirmed");
    expect(mapTechnicalVisualMapApiError(409, "TECHNICAL_VISUAL_MAP_ILLEGAL_STATE_TRANSITION")).toContain("no longer a draft");
    expect(mapTechnicalVisualMapApiError(422)).toContain("could not be completed");
    expect(mapTechnicalVisualMapApiError(400)).toContain("could not be completed");
    expect(mapTechnicalVisualMapApiError(503)).toContain("temporarily unavailable");
    expect(mapTechnicalVisualMapApiError(0)).toBe("Something went wrong. Please try again.");
    expect(mapTechnicalVisualMapApiError(500)).toBe("Something went wrong. Please try again.");
  });

  it("never leaks a raw internal error string for any mapped status", () => {
    for (const status of [400, 401, 404, 409, 422, 500, 503, 0]) {
      const message = mapTechnicalVisualMapApiError(status, "SOME_INTERNAL_CODE");
      expect(message).not.toContain("SOME_INTERNAL_CODE");
      expect(message).not.toMatch(/prisma|stack|TypeError/i);
    }
  });
});

describe("zoneFieldSourceBadgeLabel", () => {
  it("returns null for global_default (no claim was made) and a label otherwise", () => {
    expect(zoneFieldSourceBadgeLabel("global_default")).toBeNull();
    expect(zoneFieldSourceBadgeLabel("deterministic_evidence")).toBe("From evidence");
    expect(zoneFieldSourceBadgeLabel("professional_adjustment")).toBe("Adjusted");
  });
});

describe("seedZoneFormValues / buildZoneAdjustmentEntries", () => {
  it("seeding then rebuilding with no changes produces zero adjustment entries", () => {
    const entry = zoneEntry({ zone: "nape" });
    const form = seedZoneFormValues(entry);
    expect(buildZoneAdjustmentEntries("nape", entry, form)).toEqual([]);
  });

  it("11. a changed lengthIntent produces exactly one correctly-shaped adjustment entry", () => {
    const entry = zoneEntry({ zone: "nape", lengthIntent: "unspecified" });
    const form: ZoneFormValues = { ...seedZoneFormValues(entry), lengthIntent: "preserve" };
    const entries = buildZoneAdjustmentEntries("nape", entry, form);
    expect(entries).toEqual([
      { target: "zone_length_intent", zone: "nape", previousValue: "unspecified", newValue: "preserve", source: "professional" },
    ]);
  });

  it("a changed weightIntent produces exactly one correctly-shaped adjustment entry", () => {
    const entry = zoneEntry({ weightIntent: "unspecified" });
    const form: ZoneFormValues = { ...seedZoneFormValues(entry), weightIntent: "reduce" };
    expect(buildZoneAdjustmentEntries("crown", entry, form)).toEqual([
      { target: "zone_weight_intent", zone: "crown", previousValue: "unspecified", newValue: "reduce", source: "professional" },
    ]);
  });

  it("setting an elevation override from unset uses null as previousValue", () => {
    const entry = zoneEntry();
    const form: ZoneFormValues = { ...seedZoneFormValues(entry), elevationOverride: "90_deg_uniform_layer" };
    expect(buildZoneAdjustmentEntries("crown", entry, form)).toEqual([
      { target: "zone_elevation_override", zone: "crown", previousValue: null, newValue: "90_deg_uniform_layer", source: "professional" },
    ]);
  });

  it("clearing an existing elevation override back to unset uses null as newValue", () => {
    const entry = zoneEntry({ elevationOverride: "45_deg_graduation", elevationOverrideSource: "professional_adjustment" });
    const form: ZoneFormValues = { ...seedZoneFormValues(entry), elevationOverride: "" };
    expect(buildZoneAdjustmentEntries("crown", entry, form)).toEqual([
      { target: "zone_elevation_override", zone: "crown", previousValue: "45_deg_graduation", newValue: null, source: "professional" },
    ]);
  });

  it("a changed distribution override is emitted correctly", () => {
    const entry = zoneEntry();
    const form: ZoneFormValues = { ...seedZoneFormValues(entry), distributionOverride: "overdirected_back" };
    expect(buildZoneAdjustmentEntries("top", entry, form)).toEqual([
      { target: "zone_distribution_override", zone: "top", previousValue: null, newValue: "overdirected_back", source: "professional" },
    ]);
  });

  it("texturizingApplicable set to yes/no/unspecified maps to true/false/null", () => {
    const entry = zoneEntry();
    const toYes = buildZoneAdjustmentEntries("top", entry, { ...seedZoneFormValues(entry), texturizingApplicable: "yes" });
    expect(toYes).toEqual([
      { target: "zone_texturizing_applicable", zone: "top", previousValue: null, newValue: true, source: "professional" },
    ]);

    const applicableEntry = zoneEntry({ texturizingApplicable: true, texturizingApplicableSource: "professional_adjustment" });
    const toNo = buildZoneAdjustmentEntries("top", applicableEntry, {
      ...seedZoneFormValues(applicableEntry),
      texturizingApplicable: "no",
    });
    expect(toNo).toEqual([
      { target: "zone_texturizing_applicable", zone: "top", previousValue: true, newValue: false, source: "professional" },
    ]);

    const toUnspecified = buildZoneAdjustmentEntries("top", applicableEntry, {
      ...seedZoneFormValues(applicableEntry),
      texturizingApplicable: "unspecified",
    });
    expect(toUnspecified).toEqual([
      { target: "zone_texturizing_applicable", zone: "top", previousValue: true, newValue: null, source: "professional" },
    ]);
  });

  it("20. densitySensitive is never inferred client-side -- it only changes via an explicit toggle, never a side effect of another field", () => {
    const entry = zoneEntry({ densitySensitive: false });
    const form: ZoneFormValues = { ...seedZoneFormValues(entry), lengthIntent: "shorten", weightIntent: "reduce" };
    const entries = buildZoneAdjustmentEntries("occipital", entry, form);
    expect(entries.some((e) => e.target === "zone_density_sensitive")).toBe(false);

    const explicitToggle = buildZoneAdjustmentEntries("occipital", entry, { ...seedZoneFormValues(entry), densitySensitive: true });
    expect(explicitToggle).toEqual([
      { target: "zone_density_sensitive", zone: "occipital", previousValue: false, newValue: true, source: "professional" },
    ]);
  });

  it("preserve toggled true produces exactly one correctly-shaped entry", () => {
    const entry = zoneEntry({ preserve: false });
    const form: ZoneFormValues = { ...seedZoneFormValues(entry), preserve: true };
    expect(buildZoneAdjustmentEntries("fringe", entry, form)).toEqual([
      { target: "zone_preserve", zone: "fringe", previousValue: false, newValue: true, source: "professional" },
    ]);
  });

  it("12. multiple changed fields in one zone produce one entry per changed field, and unrelated zones/fields are never touched", () => {
    const entry = zoneEntry({ zone: "sides", lengthIntent: "unspecified", preserve: false });
    const form: ZoneFormValues = { ...seedZoneFormValues(entry), lengthIntent: "shorten", preserve: true };
    const entries = buildZoneAdjustmentEntries("sides", entry, form);
    expect(entries).toHaveLength(2);
    expect(entries.map((e) => e.target).sort()).toEqual(["zone_length_intent", "zone_preserve"]);
    expect(entries.every((e) => "zone" in e && e.zone === "sides")).toBe(true);
  });
});

describe("relationship UX helpers", () => {
  const relationship = (overrides: Partial<ZoneRelationshipEntry> = {}): ZoneRelationshipEntry => ({
    sourceZone: "sides",
    relationship: "shorter_than",
    targetZone: "crown",
    source: "professional_adjustment",
    ...overrides,
  });

  it("unorderedPairKey is order-independent", () => {
    expect(unorderedPairKey("sides", "crown")).toBe(unorderedPairKey("crown", "sides"));
  });

  it("zonePairAlreadyRelated matches either direction of an existing relationship", () => {
    const relationships = [relationship()];
    expect(zonePairAlreadyRelated(relationships, "sides", "crown")).toBe(true);
    expect(zonePairAlreadyRelated(relationships, "crown", "sides")).toBe(true);
    expect(zonePairAlreadyRelated(relationships, "sides", "nape")).toBe(false);
  });

  it("15. availableTargetZones never includes the source zone itself (prevents same-zone relationships)", () => {
    const targets = availableTargetZones([], "crown");
    expect(targets).not.toContain("crown");
    expect(targets).toHaveLength(5);
  });

  it("16. availableTargetZones excludes a zone already related to the source in either direction (prevents duplicates)", () => {
    const targets = availableTargetZones([relationship()], "sides");
    expect(targets).not.toContain("crown");
    const inverseTargets = availableTargetZones([relationship()], "crown");
    expect(inverseTargets).not.toContain("sides");
  });

  it("14. formatRelationship renders the exact required presentation", () => {
    expect(formatRelationship(relationship())).toBe("Sides — shorter than — Crown");
  });
});
