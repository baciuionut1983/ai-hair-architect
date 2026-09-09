import { describe, expect, it } from "vitest";

import { HEAD_ZONES } from "@/lib/technical-visual-map-validators";
import type { TechnicalVisualMapPayload, ZoneIntentEntry } from "@/lib/technical-visual-map-validators";
import { assembleCurrentHairStateFromAnalysis, assembleTargetHairStateFromTechnicalVisualMap } from "@/lib/hair-state-snapshot-assembler";
import { isHairStateSnapshotPayload } from "@/lib/hair-state-snapshot-validators";

// Professional Skill Engine, Stage 2 -- deterministic assembler tests. Pure,
// no I/O, no AI.

function realZoneIntent(overrides: Partial<ZoneIntentEntry> = {}): ZoneIntentEntry {
  return {
    zone: "nape",
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

function realTvmPayload(zoneOverrides: Partial<Record<string, Partial<ZoneIntentEntry>>> = {}): TechnicalVisualMapPayload {
  return {
    globalIntent: {
      structuralTechnique: "one_length",
      cuttingTechnique: "blunt_line",
      sectioning: "diagonal_back",
      elevation: "0_deg_blunt",
      distribution: "natural_fall",
      guideline: "stationary",
    },
    zones: HEAD_ZONES.map((zone) => realZoneIntent({ zone, ...(zoneOverrides[zone] ?? {}) })),
    relationships: [],
    preserveConstraints: [],
  };
}

describe("assembleCurrentHairStateFromAnalysis", () => {
  it("copies Analysis's real global fields into globalState, tagged 'observed'", () => {
    const payload = assembleCurrentHairStateFromAnalysis({
      hairType: "coarse",
      density: "high",
      hairLength: "long",
      hairTexture: "curly",
      hairCondition: "chemically_treated",
    });

    expect(isHairStateSnapshotPayload(payload)).toBe(true);
    expect(payload.globalState.fiberThickness).toEqual({ value: "coarse", source: "observed" });
    expect(payload.globalState.density).toEqual({ value: "high", source: "observed" });
    expect(payload.globalState.relativeLength).toEqual({ value: "long", source: "observed" });
    expect(payload.globalState.texture).toEqual({ value: "curly", source: "observed" });
    expect(payload.globalState.condition).toEqual({ value: "chemically_treated", source: "observed" });
  });

  it("never invents per-zone data -- every zone stays honestly unassessed", () => {
    const payload = assembleCurrentHairStateFromAnalysis({ hairType: "fine", density: "low", hairLength: "short", hairTexture: "straight", hairCondition: "virgin_healthy" });
    for (const zone of payload.zones) {
      expect(zone.relativeLength).toEqual({ value: "unspecified", source: "not_yet_assessed" });
      expect(zone.fiberThickness).toEqual({ value: "unspecified", source: "not_yet_assessed" });
    }
  });

  it("honestly leaves a null Analysis field unassessed -- never a fabricated guess", () => {
    const payload = assembleCurrentHairStateFromAnalysis({ hairType: "medium", density: "medium", hairLength: null, hairTexture: null, hairCondition: null });
    expect(payload.globalState.relativeLength).toEqual({ value: "unspecified", source: "not_yet_assessed" });
    expect(payload.globalState.texture).toEqual({ value: "unspecified", source: "not_yet_assessed" });
    expect(payload.globalState.condition).toEqual({ value: "unspecified", source: "not_yet_assessed" });
  });

  it("deterministic: the same input always produces byte-identical output", () => {
    const input = { hairType: "medium", density: "medium", hairLength: "long", hairTexture: "wavy", hairCondition: "virgin_healthy" };
    expect(assembleCurrentHairStateFromAnalysis(input)).toEqual(assembleCurrentHairStateFromAnalysis(input));
  });
});

describe("assembleTargetHairStateFromTechnicalVisualMap", () => {
  it("freezes TechnicalVisualMap's own per-zone lengthIntent/weightIntent verbatim", () => {
    const tvmPayload = realTvmPayload({ nape: { lengthIntent: "shorten", weightIntent: "reduce" } });
    const payload = assembleTargetHairStateFromTechnicalVisualMap(tvmPayload);

    expect(isHairStateSnapshotPayload(payload)).toBe(true);
    const nape = payload.zones.find((z) => z.zone === "nape");
    expect(nape?.lengthIntent.value).toBe("shorten");
    expect(nape?.weightIntent.value).toBe("reduce");
  });

  it("faithfully translates TVM's own ZoneValueSource -- never overclaims 'professional_input' for a global_default value", () => {
    // Real, honest, current behavior: every real proposal's own zones are
    // "global_default" (see the Stage 2.5 audit) -- this must translate to
    // "not_yet_assessed", never "professional_input".
    const tvmPayload = realTvmPayload({ crown: { lengthIntent: "preserve", lengthIntentSource: "global_default" } });
    const payload = assembleTargetHairStateFromTechnicalVisualMap(tvmPayload);
    const crown = payload.zones.find((z) => z.zone === "crown");
    expect(crown?.lengthIntent.source).toBe("not_yet_assessed");
  });

  it("translates a real professional_adjustment source to professional_input", () => {
    const tvmPayload = realTvmPayload({ top: { weightIntent: "build", weightIntentSource: "professional_adjustment" } });
    const payload = assembleTargetHairStateFromTechnicalVisualMap(tvmPayload);
    const top = payload.zones.find((z) => z.zone === "top");
    expect(top?.weightIntent.source).toBe("professional_input");
  });

  it("translates a real deterministic_evidence source to inferred", () => {
    const tvmPayload = realTvmPayload({ sides: { lengthIntent: "maintain", lengthIntentSource: "deterministic_evidence" } });
    const payload = assembleTargetHairStateFromTechnicalVisualMap(tvmPayload);
    const sides = payload.zones.find((z) => z.zone === "sides");
    expect(sides?.lengthIntent.source).toBe("inferred");
  });

  it("never populates descriptive facts (density/texture/etc.) -- TechnicalVisualMap carries none to copy", () => {
    const payload = assembleTargetHairStateFromTechnicalVisualMap(realTvmPayload());
    for (const zone of payload.zones) {
      expect(zone.density).toEqual({ value: "unspecified", source: "not_yet_assessed" });
      expect(zone.texture).toEqual({ value: "unspecified", source: "not_yet_assessed" });
    }
    expect(payload.globalState.density).toEqual({ value: "unspecified", source: "not_yet_assessed" });
  });
});
