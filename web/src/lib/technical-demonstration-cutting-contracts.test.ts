import { describe, expect, it } from "vitest";

import { deriveCuttingDemonstrationSteps } from "@/lib/technical-demonstration-derivation";
import {
  isCuttingExecutionPhase,
  isValidCuttingDemonstrationStepPayload,
  isValidCuttingExecutionPhaseSequence,
  type CuttingDemonstrationStepPayload,
  type CuttingExecutionPhase,
} from "@/lib/technical-demonstration-cutting-contracts";
import type { TechnicalCutPlan } from "@/lib/contracts";

// Technical Demonstration, Stage 1 -- validator tests for the cutting-
// specific step payload envelope. No I/O.

function cuttingPlan(): TechnicalCutPlan {
  return {
    structuralTechnique: "graduation",
    cuttingTechnique: "slice_cutting",
    texturizingTechnique: "point_cutting",
    sectioning: "diagonal_back",
    elevation: "45_deg_graduation",
    distribution: "overdirected_back",
    guideline: "stationary",
    cuttingSteps: [{ stepNumber: 1, zone: "nape", action: "x", elevationAngle: "0_deg_blunt", toolRequired: "shears" }],
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

function validPayload(): CuttingDemonstrationStepPayload {
  return deriveCuttingDemonstrationSteps(cuttingPlan())[0].payload;
}

describe("isValidCuttingDemonstrationStepPayload", () => {
  it("accepts a real, derivation-produced payload", () => {
    expect(isValidCuttingDemonstrationStepPayload(validPayload())).toBe(true);
  });

  it("rejects a non-object value", () => {
    expect(isValidCuttingDemonstrationStepPayload(null)).toBe(false);
    expect(isValidCuttingDemonstrationStepPayload("not an object")).toBe(false);
    expect(isValidCuttingDemonstrationStepPayload(42)).toBe(false);
    expect(isValidCuttingDemonstrationStepPayload([])).toBe(false);
  });

  it("rejects a payload missing a required field entirely", () => {
    const payload = validPayload() as unknown as Record<string, unknown>;
    delete payload.zones;
    expect(isValidCuttingDemonstrationStepPayload(payload)).toBe(false);
  });

  it("rejects an OBSERVED/INFERRED value paired with a null `value` -- the provenance/value invariant must hold", () => {
    const payload = validPayload();
    const malformed = { ...payload, tool: { value: null, provenance: "OBSERVED" } };
    expect(isValidCuttingDemonstrationStepPayload(malformed)).toBe(false);
  });

  it("rejects an UNKNOWN value paired with a non-null `value` -- the same invariant, the other direction", () => {
    const payload = validPayload();
    const malformed = { ...payload, styling: { value: "some invented styling instruction", provenance: "UNKNOWN" } };
    expect(isValidCuttingDemonstrationStepPayload(malformed)).toBe(false);
  });

  it("rejects an out-of-vocabulary enum value even when correctly provenance-wrapped", () => {
    const payload = validPayload();
    const malformed = { ...payload, elevation: { value: "not_a_real_elevation", provenance: "OBSERVED" } };
    expect(isValidCuttingDemonstrationStepPayload(malformed)).toBe(false);
  });

  it("rejects an unrecognized provenance tag", () => {
    const payload = validPayload();
    const malformed = { ...payload, tool: { value: "shears", provenance: "GUESSED" } };
    expect(isValidCuttingDemonstrationStepPayload(malformed)).toBe(false);
  });

  it("rejects a non-array/empty-array zones value", () => {
    const payload = validPayload();
    expect(isValidCuttingDemonstrationStepPayload({ ...payload, zones: { value: "nape", provenance: "OBSERVED" } })).toBe(false);
    expect(isValidCuttingDemonstrationStepPayload({ ...payload, zones: { value: [], provenance: "OBSERVED" } })).toBe(false);
  });

  it("rejects a non-string-array constraints field", () => {
    const payload = validPayload();
    expect(isValidCuttingDemonstrationStepPayload({ ...payload, constraints: "not an array" })).toBe(false);
    expect(isValidCuttingDemonstrationStepPayload({ ...payload, constraints: [1, 2, 3] })).toBe(false);
  });

  it("accepts an explicitly empty constraints array", () => {
    const payload = validPayload();
    expect(isValidCuttingDemonstrationStepPayload({ ...payload, constraints: [] })).toBe(true);
  });

  // Stage 2.5.a -- new fields.
  it("rejects a payload missing the new Stage 2.5.a `phase` field entirely", () => {
    const payload = validPayload() as unknown as Record<string, unknown>;
    delete payload.phase;
    expect(isValidCuttingDemonstrationStepPayload(payload)).toBe(false);
  });

  it("rejects an out-of-vocabulary phase value even when correctly provenance-wrapped", () => {
    const payload = validPayload();
    const malformed = { ...payload, phase: { value: "NOT_A_REAL_PHASE", provenance: "INFERRED" } };
    expect(isValidCuttingDemonstrationStepPayload(malformed)).toBe(false);
  });

  it("accepts an UNKNOWN phase (an unrecognized source label -- honest, not an error)", () => {
    const payload = validPayload();
    const withUnknownPhase = { ...payload, phase: { value: null, provenance: "UNKNOWN" } };
    expect(isValidCuttingDemonstrationStepPayload(withUnknownPhase)).toBe(true);
  });

  // Stage 2.5.d -- new `actionType` field, same discipline as `phase`.
  it("rejects a payload missing the new Stage 2.5.d `actionType` field entirely", () => {
    const payload = validPayload() as unknown as Record<string, unknown>;
    delete payload.actionType;
    expect(isValidCuttingDemonstrationStepPayload(payload)).toBe(false);
  });

  it("rejects an out-of-vocabulary actionType value even when correctly provenance-wrapped", () => {
    const payload = validPayload();
    const malformed = { ...payload, actionType: { value: "NOT_A_REAL_ACTION", provenance: "INFERRED" } };
    expect(isValidCuttingDemonstrationStepPayload(malformed)).toBe(false);
  });

  it("rejects the literal string 'UNKNOWN' as an actionType VALUE -- unknown-ness is represented via provenance, never as an 8th enum member", () => {
    const payload = validPayload();
    const malformed = { ...payload, actionType: { value: "UNKNOWN", provenance: "INFERRED" } };
    expect(isValidCuttingDemonstrationStepPayload(malformed)).toBe(false);
  });

  it("accepts an UNKNOWN actionType (GUIDE_AND_STRUCTURE/CROSS_CHECK_AND_FINISH's own honest default)", () => {
    const payload = validPayload();
    const withUnknownActionType = { ...payload, actionType: { value: null, provenance: "UNKNOWN" } };
    expect(isValidCuttingDemonstrationStepPayload(withUnknownActionType)).toBe(true);
  });

  it("accepts a professionally-overridden actionType for each of the 7 real values", () => {
    const payload = validPayload();
    for (const actionType of [
      "SECTIONING_ACTION",
      "STRUCTURAL_CUTTING",
      "TEXTURIZING_ACTION",
      "GUIDE_OBSERVATION",
      "GUIDE_CUTTING",
      "FINAL_OBSERVATION",
      "CORRECTIVE_CUTTING",
    ] as const) {
      const withOverride = { ...payload, actionType: { value: actionType, provenance: "PROFESSIONAL_OVERRIDE" } };
      expect(isValidCuttingDemonstrationStepPayload(withOverride)).toBe(true);
    }
  });

  it("rejects a payload missing any one of the new Stage 2.5.a execution fields", () => {
    for (const field of ["fingerAngle", "subsectionThickness", "toolOrientation", "progression", "stateBefore", "stateAfter"] as const) {
      const payload = validPayload() as unknown as Record<string, unknown>;
      delete payload[field];
      expect(isValidCuttingDemonstrationStepPayload(payload)).toBe(false);
    }
  });

  it("rejects a real value paired with UNKNOWN provenance for a new Stage 2.5.a field -- the same invariant applies uniformly", () => {
    const payload = validPayload();
    const malformed = { ...payload, stateBefore: { value: "fabricated state", provenance: "UNKNOWN" } };
    expect(isValidCuttingDemonstrationStepPayload(malformed)).toBe(false);
  });
});

describe("isCuttingExecutionPhase", () => {
  it("accepts every real, closed phase value", () => {
    const phases: CuttingExecutionPhase[] = [
      "PREPARATION_AND_SECTIONING",
      "GUIDE_AND_STRUCTURE",
      "STRUCTURAL_CUTTING",
      "REFINEMENT_TEXTURIZING",
      "CROSS_CHECK_AND_FINISH",
    ];
    for (const phase of phases) {
      expect(isCuttingExecutionPhase(phase)).toBe(true);
    }
  });

  it("rejects an unrecognized string, a phase-label-shaped string, and a non-string", () => {
    expect(isCuttingExecutionPhase("Mapping and sectioning")).toBe(false);
    expect(isCuttingExecutionPhase("structural_cutting")).toBe(false); // wrong case
    expect(isCuttingExecutionPhase(null)).toBe(false);
    expect(isCuttingExecutionPhase(42)).toBe(false);
  });
});

describe("isValidCuttingExecutionPhaseSequence", () => {
  it("accepts the real engine's own canonical order", () => {
    expect(
      isValidCuttingExecutionPhaseSequence([
        "PREPARATION_AND_SECTIONING",
        "GUIDE_AND_STRUCTURE",
        "STRUCTURAL_CUTTING",
        "REFINEMENT_TEXTURIZING",
        "CROSS_CHECK_AND_FINISH",
      ]),
    ).toBe(true);
  });

  it("accepts repeats and gaps -- only backward movement is invalid", () => {
    expect(isValidCuttingExecutionPhaseSequence(["STRUCTURAL_CUTTING", "STRUCTURAL_CUTTING", "CROSS_CHECK_AND_FINISH"])).toBe(true);
    expect(isValidCuttingExecutionPhaseSequence(["PREPARATION_AND_SECTIONING", "CROSS_CHECK_AND_FINISH"])).toBe(true); // skips 3 phases
  });

  it("rejects a genuine regression -- a later step reporting an earlier phase than a prior step", () => {
    expect(isValidCuttingExecutionPhaseSequence(["STRUCTURAL_CUTTING", "PREPARATION_AND_SECTIONING"])).toBe(false);
    expect(isValidCuttingExecutionPhaseSequence(["CROSS_CHECK_AND_FINISH", "REFINEMENT_TEXTURIZING"])).toBe(false);
  });

  it("an UNKNOWN (null) phase is simply skipped -- it neither causes nor masks a rejection on its own", () => {
    expect(isValidCuttingExecutionPhaseSequence([null, null, null])).toBe(true);
    // A null in between two KNOWN, forward-moving phases never blocks
    // acceptance -- there is nothing contradictory here.
    expect(isValidCuttingExecutionPhaseSequence(["STRUCTURAL_CUTTING", null, "CROSS_CHECK_AND_FINISH"])).toBe(true);
    expect(isValidCuttingExecutionPhaseSequence([null, "STRUCTURAL_CUTTING", "CROSS_CHECK_AND_FINISH"])).toBe(true);
    // A null in between does NOT hide a genuine regression between the two
    // KNOWN phases surrounding it -- the null itself is never rejected,
    // but the real, still-detectable backward movement is.
    expect(isValidCuttingExecutionPhaseSequence(["STRUCTURAL_CUTTING", null, "PREPARATION_AND_SECTIONING"])).toBe(false);
  });

  it("accepts an empty sequence", () => {
    expect(isValidCuttingExecutionPhaseSequence([])).toBe(true);
  });
});
