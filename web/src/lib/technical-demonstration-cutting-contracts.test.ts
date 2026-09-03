import { describe, expect, it } from "vitest";

import { deriveCuttingDemonstrationSteps } from "@/lib/technical-demonstration-derivation";
import { isValidCuttingDemonstrationStepPayload, type CuttingDemonstrationStepPayload } from "@/lib/technical-demonstration-cutting-contracts";
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
});
