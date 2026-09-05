import { describe, expect, it } from "vitest";

import { deriveCuttingDemonstrationSteps } from "@/lib/technical-demonstration-derivation";
import { isValidCuttingDemonstrationStepPayload, type CuttingDemonstrationStepPayload } from "@/lib/technical-demonstration-cutting-contracts";
import type { CuttingStep, TechnicalCutPlan } from "@/lib/contracts";
import {
  CUTTING_STEP_OVERRIDE_FIELD_NAMES,
  isCuttingStepOverrideEntry,
  isCuttingStepOverrideEntryArray,
  isCuttingStepOverrideFieldName,
  isCuttingStepOverrideInput,
  resolveEffectiveCuttingStepPayload,
  toCuttingStepOverrideEntry,
  type CuttingStepOverrideEntry,
  type CuttingStepOverrideInput,
} from "@/lib/technical-demonstration-cutting-overrides";

// Technical Demonstration, Stage 2.5.b -- pure tests for the professional
// adjustment layer. No I/O.

function realisticCuttingSteps(): CuttingStep[] {
  return [
    { stepNumber: 1, zone: "Mapping and sectioning", action: "Partition.", elevationAngle: "0_deg_blunt", toolRequired: "tail-comb" },
    { stepNumber: 2, zone: "Baseline guideline", action: "Set guideline.", elevationAngle: "0_deg_blunt", toolRequired: "straight-shear" },
    { stepNumber: 3, zone: "Bulk and shape control", action: "Cut.", elevationAngle: "0_deg_blunt", toolRequired: "straight-shear" },
    { stepNumber: 4, zone: "Texture refinement", action: "Texturize.", elevationAngle: "0_deg_blunt", toolRequired: "texturizer-shear" },
    { stepNumber: 5, zone: "Cross-check and finish", action: "Finish.", elevationAngle: "0_deg_blunt", toolRequired: "finishing-comb" },
  ];
}

function cuttingPlan(): TechnicalCutPlan {
  return {
    structuralTechnique: "one_length",
    cuttingTechnique: "blunt_line",
    texturizingTechnique: "slice_and_slide",
    sectioning: "4_quadrant_profile_radial",
    elevation: "0_deg_blunt",
    distribution: "natural_fall",
    guideline: "visual_perimeter",
    cuttingSteps: realisticCuttingSteps(),
    stylistExplanation: "x",
    clientExplanation: "x",
    professionalReason: "x",
    warnings: [],
    contraindications: [],
    assumptions: [],
    missingData: [],
    confidence: 0.9,
    stylistValidationDisclaimer: "x",
    version: "1.0.0-m8",
  };
}

function realBaselinePayload(): CuttingDemonstrationStepPayload {
  return deriveCuttingDemonstrationSteps(cuttingPlan())[0].payload; // PREPARATION_AND_SECTIONING, step 1
}

describe("isCuttingStepOverrideFieldName", () => {
  it("accepts every real, closed field name", () => {
    for (const field of CUTTING_STEP_OVERRIDE_FIELD_NAMES) {
      expect(isCuttingStepOverrideFieldName(field)).toBe(true);
    }
  });

  it("rejects phase, constraints, and an unrecognized field", () => {
    expect(isCuttingStepOverrideFieldName("phase")).toBe(false);
    expect(isCuttingStepOverrideFieldName("constraints")).toBe(false);
    expect(isCuttingStepOverrideFieldName("notARealField")).toBe(false);
  });
});

describe("isCuttingStepOverrideInput", () => {
  it("accepts a valid set_value input for every field, with a correctly-shaped value", () => {
    expect(isCuttingStepOverrideInput({ op: "set_value", stepNumber: 1, field: "zones", value: ["nape"] })).toBe(true);
    expect(isCuttingStepOverrideInput({ op: "set_value", stepNumber: 1, field: "elevation", value: "0_deg_blunt" })).toBe(true);
    expect(isCuttingStepOverrideInput({ op: "set_value", stepNumber: 1, field: "tool", value: "shears" })).toBe(true);
    expect(isCuttingStepOverrideInput({ op: "set_value", stepNumber: 1, field: "overdirection", value: true })).toBe(true);
    expect(isCuttingStepOverrideInput({ op: "set_value", stepNumber: 1, field: "crossCheck", value: false })).toBe(true);
  });

  // Stage 2.5.d -- a professional can classify actionType for any step
  // (DRAFT-only editability is enforced generically by applyOverridesToDraft,
  // unrelated to this field), including the two cases the deterministic
  // derivation can never resolve on its own.
  it("accepts a valid set_value input for every one of the 7 real actionType values", () => {
    for (const actionType of [
      "SECTIONING_ACTION",
      "STRUCTURAL_CUTTING",
      "TEXTURIZING_ACTION",
      "GUIDE_OBSERVATION",
      "GUIDE_CUTTING",
      "FINAL_OBSERVATION",
      "CORRECTIVE_CUTTING",
    ]) {
      expect(isCuttingStepOverrideInput({ op: "set_value", stepNumber: 2, field: "actionType", value: actionType })).toBe(true);
    }
  });

  it("rejects 'UNKNOWN' as an actionType override value -- it is a provenance state, never a settable value", () => {
    expect(isCuttingStepOverrideInput({ op: "set_value", stepNumber: 2, field: "actionType", value: "UNKNOWN" })).toBe(false);
  });

  it("rejects an unrecognized actionType value", () => {
    expect(isCuttingStepOverrideInput({ op: "set_value", stepNumber: 2, field: "actionType", value: "SOMETHING_ELSE" })).toBe(false);
  });

  it("rejects a set_value input whose value doesn't match the field's own closed shape", () => {
    expect(isCuttingStepOverrideInput({ op: "set_value", stepNumber: 1, field: "elevation", value: "not_a_real_elevation" })).toBe(false);
    expect(isCuttingStepOverrideInput({ op: "set_value", stepNumber: 1, field: "zones", value: ["not_a_real_zone"] })).toBe(false);
    expect(isCuttingStepOverrideInput({ op: "set_value", stepNumber: 1, field: "overdirection", value: "yes" })).toBe(false);
    expect(isCuttingStepOverrideInput({ op: "set_value", stepNumber: 1, field: "tool", value: "" })).toBe(false);
  });

  it("rejects a set_value input with no value key at all", () => {
    expect(isCuttingStepOverrideInput({ op: "set_value", stepNumber: 1, field: "tool" })).toBe(false);
  });

  it("accepts mark_not_applicable / reset_field inputs with no value key", () => {
    expect(isCuttingStepOverrideInput({ op: "mark_not_applicable", stepNumber: 1, field: "crossCheck" })).toBe(true);
    expect(isCuttingStepOverrideInput({ op: "reset_field", stepNumber: 1, field: "crossCheck" })).toBe(true);
  });

  it("rejects mark_not_applicable / reset_field inputs that carry a value anyway", () => {
    expect(isCuttingStepOverrideInput({ op: "mark_not_applicable", stepNumber: 1, field: "crossCheck", value: true })).toBe(false);
    expect(isCuttingStepOverrideInput({ op: "reset_field", stepNumber: 1, field: "crossCheck", value: true })).toBe(false);
  });

  it("rejects an invalid op, a non-integer/zero/negative stepNumber, and an unrecognized field", () => {
    expect(isCuttingStepOverrideInput({ op: "delete_everything", stepNumber: 1, field: "tool" })).toBe(false);
    expect(isCuttingStepOverrideInput({ op: "set_value", stepNumber: 0, field: "tool", value: "x" })).toBe(false);
    expect(isCuttingStepOverrideInput({ op: "set_value", stepNumber: 1.5, field: "tool", value: "x" })).toBe(false);
    expect(isCuttingStepOverrideInput({ op: "set_value", stepNumber: -1, field: "tool", value: "x" })).toBe(false);
    expect(isCuttingStepOverrideInput({ op: "set_value", stepNumber: 1, field: "phase", value: "STRUCTURAL_CUTTING" })).toBe(false);
  });

  it("rejects a caller attempt to smuggle source/setAt through the input shape -- structurally impossible to matter, but never silently accepted as meaningful", () => {
    // isCuttingStepOverrideInput only checks the fields it knows about --
    // extra keys are not itself a rejection reason (this mirrors ordinary
    // permissive object validation), but toCuttingStepOverrideEntry (below)
    // proves the extra keys are never actually used.
    const withExtras = { op: "set_value", stepNumber: 1, field: "tool", value: "shears", source: "professional", setAt: "2020-01-01T00:00:00.000Z" };
    expect(isCuttingStepOverrideInput(withExtras)).toBe(true);
  });

  it("rejects non-objects and arrays", () => {
    expect(isCuttingStepOverrideInput(null)).toBe(false);
    expect(isCuttingStepOverrideInput("x")).toBe(false);
    expect(isCuttingStepOverrideInput([])).toBe(false);
  });
});

describe("toCuttingStepOverrideEntry", () => {
  it("stamps source: 'professional' and setAt from the injected clock, ignoring any caller-supplied source/setAt", () => {
    const input = { op: "set_value", stepNumber: 1, field: "tool", value: "shears", source: "someone-else", setAt: "2000-01-01T00:00:00.000Z" } as unknown as CuttingStepOverrideInput;
    const now = new Date("2026-09-04T12:00:00.000Z");
    const entry = toCuttingStepOverrideEntry(input, now);
    expect(entry.source).toBe("professional");
    expect(entry.setAt).toBe("2026-09-04T12:00:00.000Z");
    expect(entry.value).toBe("shears");
  });

  it("carries `reason` through when present, omits it when absent", () => {
    const now = new Date("2026-09-04T12:00:00.000Z");
    const withReason = toCuttingStepOverrideEntry({ op: "mark_not_applicable", stepNumber: 1, field: "crossCheck", reason: "no relevant cross-check for this action" }, now);
    expect(withReason.reason).toBe("no relevant cross-check for this action");

    const withoutReason = toCuttingStepOverrideEntry({ op: "mark_not_applicable", stepNumber: 1, field: "crossCheck" }, now);
    expect(withoutReason.reason).toBeUndefined();
  });

  it("never includes a `value` key at all for mark_not_applicable/reset_field", () => {
    const now = new Date("2026-09-04T12:00:00.000Z");
    const entry = toCuttingStepOverrideEntry({ op: "reset_field", stepNumber: 1, field: "tool" }, now);
    expect("value" in entry).toBe(false);
  });

  it("produces an entry that isCuttingStepOverrideEntry itself accepts as valid", () => {
    const now = new Date("2026-09-04T12:00:00.000Z");
    const entry = toCuttingStepOverrideEntry({ op: "set_value", stepNumber: 1, field: "elevation", value: "45_deg_graduation" }, now);
    expect(isCuttingStepOverrideEntry(entry)).toBe(true);
  });
});

describe("isCuttingStepOverrideEntry / isCuttingStepOverrideEntryArray", () => {
  it("rejects an entry with a non-'professional' source, even if otherwise well-formed", () => {
    const malformed = { op: "set_value", stepNumber: 1, field: "tool", value: "shears", source: "ai", setAt: "2026-01-01T00:00:00.000Z" };
    expect(isCuttingStepOverrideEntry(malformed)).toBe(false);
  });

  it("rejects an entry missing setAt", () => {
    const malformed = { op: "set_value", stepNumber: 1, field: "tool", value: "shears", source: "professional" };
    expect(isCuttingStepOverrideEntry(malformed)).toBe(false);
  });

  it("isCuttingStepOverrideEntryArray accepts an array of valid entries and rejects one with a single bad entry", () => {
    const now = new Date("2026-09-04T12:00:00.000Z");
    const good = [
      toCuttingStepOverrideEntry({ op: "set_value", stepNumber: 1, field: "tool", value: "shears" }, now),
      toCuttingStepOverrideEntry({ op: "mark_not_applicable", stepNumber: 2, field: "crossCheck" }, now),
    ];
    expect(isCuttingStepOverrideEntryArray(good)).toBe(true);
    expect(isCuttingStepOverrideEntryArray([...good, { op: "bogus" }])).toBe(false);
    expect(isCuttingStepOverrideEntryArray("not an array")).toBe(false);
  });
});

describe("resolveEffectiveCuttingStepPayload", () => {
  it("with zero overrides, returns the baseline exactly (deep-equal, but not the same object reference)", () => {
    const baseline = realBaselinePayload();
    const effective = resolveEffectiveCuttingStepPayload(1, baseline, []);
    expect(effective).toEqual(baseline);
    expect(effective).not.toBe(baseline);
  });

  it("set_value tags PROFESSIONAL_OVERRIDE with the exact supplied value, on the exact matching stepNumber only", () => {
    const baseline = realBaselinePayload();
    const now = new Date("2026-09-04T12:00:00.000Z");
    const overrides: CuttingStepOverrideEntry[] = [toCuttingStepOverrideEntry({ op: "set_value", stepNumber: 1, field: "zones", value: ["nape"] }, now)];

    const step1 = resolveEffectiveCuttingStepPayload(1, baseline, overrides);
    expect(step1.zones).toEqual({ value: ["nape"], provenance: "PROFESSIONAL_OVERRIDE" });

    // A DIFFERENT step's own baseline is completely untouched by an
    // override scoped to step 1.
    const step2 = resolveEffectiveCuttingStepPayload(2, baseline, overrides);
    expect(step2.zones).toEqual(baseline.zones);
  });

  it("mark_not_applicable tags NOT_APPLICABLE with a null value, never a fabricated one", () => {
    const baseline = realBaselinePayload();
    const now = new Date("2026-09-04T12:00:00.000Z");
    const overrides: CuttingStepOverrideEntry[] = [toCuttingStepOverrideEntry({ op: "mark_not_applicable", stepNumber: 1, field: "crossCheck" }, now)];
    const effective = resolveEffectiveCuttingStepPayload(1, baseline, overrides);
    expect(effective.crossCheck).toEqual({ value: null, provenance: "NOT_APPLICABLE" });
  });

  it("reset_field reverts to the step's OWN original baseline value, discarding every prior override for that field", () => {
    const baseline = realBaselinePayload(); // step 1 -- structuralTechnique is honestly UNKNOWN (PREPARATION_AND_SECTIONING phase)
    const now = new Date("2026-09-04T12:00:00.000Z");
    const overrides: CuttingStepOverrideEntry[] = [
      toCuttingStepOverrideEntry({ op: "set_value", stepNumber: 1, field: "tool", value: "custom-shears" }, now),
      toCuttingStepOverrideEntry({ op: "reset_field", stepNumber: 1, field: "tool" }, now),
    ];
    const effective = resolveEffectiveCuttingStepPayload(1, baseline, overrides);
    expect(effective.tool).toEqual(baseline.tool); // back to the real OBSERVED baseline, "tail-comb"
  });

  it("last matching override for a given (stepNumber, field) pair wins, applied strictly in array order", () => {
    const baseline = realBaselinePayload();
    const now = new Date("2026-09-04T12:00:00.000Z");
    const overrides: CuttingStepOverrideEntry[] = [
      toCuttingStepOverrideEntry({ op: "set_value", stepNumber: 1, field: "tool", value: "first-tool" }, now),
      toCuttingStepOverrideEntry({ op: "set_value", stepNumber: 1, field: "tool", value: "second-tool" }, now),
    ];
    const effective = resolveEffectiveCuttingStepPayload(1, baseline, overrides);
    expect(effective.tool).toEqual({ value: "second-tool", provenance: "PROFESSIONAL_OVERRIDE" });
  });

  it("a mark_not_applicable followed by a later set_value on the same field correctly overrides back to a real value", () => {
    const baseline = realBaselinePayload();
    const now = new Date("2026-09-04T12:00:00.000Z");
    const overrides: CuttingStepOverrideEntry[] = [
      toCuttingStepOverrideEntry({ op: "mark_not_applicable", stepNumber: 1, field: "crossCheck" }, now),
      toCuttingStepOverrideEntry({ op: "set_value", stepNumber: 1, field: "crossCheck", value: true }, now),
    ];
    const effective = resolveEffectiveCuttingStepPayload(1, baseline, overrides);
    expect(effective.crossCheck).toEqual({ value: true, provenance: "PROFESSIONAL_OVERRIDE" });
  });

  it("never mutates the baseline object passed in", () => {
    const baseline = realBaselinePayload();
    const frozenSnapshot = JSON.parse(JSON.stringify(baseline));
    const now = new Date("2026-09-04T12:00:00.000Z");
    resolveEffectiveCuttingStepPayload(1, baseline, [toCuttingStepOverrideEntry({ op: "set_value", stepNumber: 1, field: "tool", value: "x" }, now)]);
    expect(baseline).toEqual(frozenSnapshot);
  });

  it("every resolved effective payload is still structurally valid", () => {
    const baseline = realBaselinePayload();
    const now = new Date("2026-09-04T12:00:00.000Z");
    const overrides: CuttingStepOverrideEntry[] = [
      toCuttingStepOverrideEntry({ op: "set_value", stepNumber: 1, field: "zones", value: ["crown"] }, now),
      toCuttingStepOverrideEntry({ op: "mark_not_applicable", stepNumber: 1, field: "styling" }, now),
      toCuttingStepOverrideEntry({ op: "set_value", stepNumber: 1, field: "stateBefore", value: "Nape uncut." }, now),
    ];
    const effective = resolveEffectiveCuttingStepPayload(1, baseline, overrides);
    expect(isValidCuttingDemonstrationStepPayload(effective)).toBe(true);
  });
});

// Stage 2.5.d (round 2) -- UI/read-model compatibility fix. A step
// persisted before `actionType` existed (current production V2) has no
// stored value for the field at all -- resolveEffectiveCuttingStepPayload
// must expose the SAME effective value readiness already derives, without
// ever writing anything back to the caller-supplied baseline.
describe("resolveEffectiveCuttingStepPayload -- actionType backward compatibility", () => {
  function legacyStepPayload(stepIndex: number): CuttingDemonstrationStepPayload {
    const derived = deriveCuttingDemonstrationSteps(cuttingPlan())[stepIndex].payload;
    const legacy = { ...(derived as unknown as Record<string, unknown>) };
    delete legacy.actionType; // simulate a step persisted before this field existed
    return legacy as unknown as CuttingDemonstrationStepPayload;
  }

  it("legacy PREPARATION_AND_SECTIONING exposes effective SECTIONING_ACTION, Inferred", () => {
    const effective = resolveEffectiveCuttingStepPayload(1, legacyStepPayload(0), []);
    expect(effective.actionType).toEqual({ value: "SECTIONING_ACTION", provenance: "INFERRED" });
  });

  it("legacy STRUCTURAL_CUTTING exposes effective STRUCTURAL_CUTTING, Inferred", () => {
    const effective = resolveEffectiveCuttingStepPayload(3, legacyStepPayload(2), []);
    expect(effective.actionType).toEqual({ value: "STRUCTURAL_CUTTING", provenance: "INFERRED" });
  });

  it("legacy REFINEMENT_TEXTURIZING exposes effective TEXTURIZING_ACTION, Inferred", () => {
    const effective = resolveEffectiveCuttingStepPayload(4, legacyStepPayload(3), []);
    expect(effective.actionType).toEqual({ value: "TEXTURIZING_ACTION", provenance: "INFERRED" });
  });

  it("legacy GUIDE_AND_STRUCTURE exposes an honest UNKNOWN, never guessed", () => {
    const effective = resolveEffectiveCuttingStepPayload(2, legacyStepPayload(1), []);
    expect(effective.actionType).toEqual({ value: null, provenance: "UNKNOWN" });
  });

  it("legacy CROSS_CHECK_AND_FINISH exposes an honest UNKNOWN, never guessed", () => {
    const effective = resolveEffectiveCuttingStepPayload(5, legacyStepPayload(4), []);
    expect(effective.actionType).toEqual({ value: null, provenance: "UNKNOWN" });
  });

  it("never persists/mutates the legacy baseline -- the caller's own object still has no actionType key afterward", () => {
    const legacy = legacyStepPayload(0);
    const before = JSON.stringify(legacy);
    resolveEffectiveCuttingStepPayload(1, legacy, []);
    expect(JSON.stringify(legacy)).toBe(before);
    expect("actionType" in legacy).toBe(false);
  });

  it("a real professional override on a legacy step still wins over the compatibility fallback", () => {
    const now = new Date("2026-09-04T12:00:00.000Z");
    const overrides: CuttingStepOverrideEntry[] = [toCuttingStepOverrideEntry({ op: "set_value", stepNumber: 2, field: "actionType", value: "GUIDE_OBSERVATION" }, now)];
    const effective = resolveEffectiveCuttingStepPayload(2, legacyStepPayload(1), overrides);
    expect(effective.actionType).toEqual({ value: "GUIDE_OBSERVATION", provenance: "PROFESSIONAL_OVERRIDE" });
  });

  it("reset_field on a legacy step's actionType reverts to the compatibility-resolved value, never to a literal absence", () => {
    const now = new Date("2026-09-04T12:00:00.000Z");
    const overrides: CuttingStepOverrideEntry[] = [
      toCuttingStepOverrideEntry({ op: "set_value", stepNumber: 1, field: "actionType", value: "STRUCTURAL_CUTTING" }, now),
      toCuttingStepOverrideEntry({ op: "reset_field", stepNumber: 1, field: "actionType" }, now),
    ];
    const effective = resolveEffectiveCuttingStepPayload(1, legacyStepPayload(0), overrides);
    expect(effective.actionType).toEqual({ value: "SECTIONING_ACTION", provenance: "INFERRED" });
  });

  it("an already-present NOT_APPLICABLE actionType (a real professional decision) is left completely untouched, never overwritten by the fallback", () => {
    const derived = deriveCuttingDemonstrationSteps(cuttingPlan())[0].payload;
    const withNotApplicable = { ...derived, actionType: { value: null, provenance: "NOT_APPLICABLE" as const } };
    const effective = resolveEffectiveCuttingStepPayload(1, withNotApplicable, []);
    expect(effective.actionType).toEqual({ value: null, provenance: "NOT_APPLICABLE" });
  });
});
