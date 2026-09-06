import { describe, expect, it } from "vitest";

import type { CuttingStep, TechnicalCutPlan } from "@/lib/contracts";
import type { TechnicalDemonstrationStepRecord } from "@/lib/technical-demonstration-contracts";
import { deriveCuttingDemonstrationSteps, TECHNICAL_DEMONSTRATION_CUTTING_GENERATOR_VERSION } from "@/lib/technical-demonstration-derivation";
import { CUTTING_DEMONSTRATION_STEP_SCHEMA_VERSION, type CuttingDemonstrationStepPayload } from "@/lib/technical-demonstration-cutting-contracts";
import { resolveEffectiveCuttingStepPayload, toCuttingStepOverrideEntry, type CuttingStepOverrideInput } from "@/lib/technical-demonstration-cutting-overrides";
import { evaluatePlanCoherence, TECHNICAL_DEMONSTRATION_COHERENCE_RULES_VERSION } from "@/lib/technical-demonstration-cutting-coherence";

// Technical Demonstration, Stage 2.5.g.1 -- pure tests for the Professional
// Coherence rule engine. No I/O, no database, no provider. Mirrors
// technical-demonstration-cutting-video-readiness.test.ts's own real-
// engine-fixture style exactly (deriveCuttingDemonstrationSteps against a
// realistic 5-phase TechnicalCutPlan, professional overrides applied via
// the real resolveEffectiveCuttingStepPayload) -- these tests exercise the
// SAME baseline shape production code actually produces, not hand-invented
// literals.

function realisticCuttingSteps(): CuttingStep[] {
  return [
    { stepNumber: 1, zone: "Mapping and sectioning", action: "Partition.", elevationAngle: "0_deg_blunt", toolRequired: "tail-comb" },
    { stepNumber: 2, zone: "Baseline guideline", action: "Set guideline.", elevationAngle: "0_deg_blunt", toolRequired: "straight-shear" },
    { stepNumber: 3, zone: "Bulk and shape control", action: "Cut.", elevationAngle: "0_deg_blunt", toolRequired: "straight-shear" },
    { stepNumber: 4, zone: "Texture refinement", action: "Texturize.", elevationAngle: "0_deg_blunt", toolRequired: "texturizer-shear" },
    { stepNumber: 5, zone: "Cross-check and finish", action: "Finish.", elevationAngle: "0_deg_blunt", toolRequired: "finishing-comb" },
  ];
}

function cuttingPlan(overrides: Partial<TechnicalCutPlan> = {}): TechnicalCutPlan {
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
    ...overrides,
  };
}

function toStepRecord(stepNumber: number, payload: CuttingDemonstrationStepPayload, explanation: string | null = null): TechnicalDemonstrationStepRecord {
  return {
    id: `step-${stepNumber}`,
    ownerUserId: "owner-1",
    clientId: "client-1",
    planId: "plan-1",
    vertical: "cutting",
    stepNumber,
    stepSchemaVersion: "1.1.0-td25a",
    payload: payload as unknown as Record<string, unknown>,
    explanation,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

// Baseline: real derivation output for a realistic, texturizing-inclusive
// plan -- phase 1..5 = PREPARATION_AND_SECTIONING / GUIDE_AND_STRUCTURE /
// STRUCTURAL_CUTTING / REFINEMENT_TEXTURIZING / CROSS_CHECK_AND_FINISH;
// actionType = SECTIONING_ACTION / UNKNOWN / STRUCTURAL_CUTTING /
// TEXTURIZING_ACTION / FINAL_OBSERVATION. Zero coherence findings expected
// by construction (this IS what the current, correct engine produces).
function baselineSteps(planOverrides: Partial<TechnicalCutPlan> = {}): TechnicalDemonstrationStepRecord[] {
  return deriveCuttingDemonstrationSteps(cuttingPlan(planOverrides)).map((derived) => toStepRecord(derived.stepNumber, derived.payload, derived.explanation));
}

// Applies one professional override to ONE step of a baseline set, via the
// real resolveEffectiveCuttingStepPayload -- exactly the same mechanism
// production overrides go through, never a hand-mutated payload.
function withOverride(steps: TechnicalDemonstrationStepRecord[], input: CuttingStepOverrideInput): TechnicalDemonstrationStepRecord[] {
  const entry = toCuttingStepOverrideEntry(input, new Date("2026-01-01T00:00:00.000Z"));
  return steps.map((step) => {
    if (step.stepNumber !== input.stepNumber) return step;
    const effective = resolveEffectiveCuttingStepPayload(step.stepNumber, step.payload as unknown as CuttingDemonstrationStepPayload, [entry]);
    return { ...step, payload: effective as unknown as Record<string, unknown> };
  });
}

describe("evaluatePlanCoherence", () => {
  // Required test 2 (compatible baseline -> no blocker) folded in here as
  // the sanity check every other test's "before" state relies on.
  it("a real, unedited baseline (5 correct phase/actionType pairs) produces zero findings of any severity", () => {
    const result = evaluatePlanCoherence(baselineSteps());
    expect(result).toEqual({ pass: true, blockers: [], warnings: [], reviewItems: [] });
  });

  describe("BLOCKER A -- phase/actionType validity (the 3 proven deterministic pairs + the 2 phase-scoped pairs)", () => {
    it("1. SECTIONING_ACTION on a STRUCTURAL_CUTTING-phase step -> BLOCKER", () => {
      const steps = withOverride(baselineSteps(), { op: "set_value", stepNumber: 3, field: "actionType", value: "SECTIONING_ACTION" });
      const result = evaluatePlanCoherence(steps);
      expect(result.pass).toBe(false);
      expect(result.blockers).toHaveLength(1);
      expect(result.blockers[0]).toMatchObject({ code: "COHERENCE_PHASE_ACTION_TYPE_MISMATCH", severity: "BLOCKER", stepNumber: 3 });
    });

    it("1. STRUCTURAL_CUTTING actionType on a PREPARATION_AND_SECTIONING-phase step -> BLOCKER", () => {
      const steps = withOverride(baselineSteps(), { op: "set_value", stepNumber: 1, field: "actionType", value: "STRUCTURAL_CUTTING" });
      const result = evaluatePlanCoherence(steps);
      expect(result.blockers).toHaveLength(1);
      expect(result.blockers[0]).toMatchObject({ code: "COHERENCE_PHASE_ACTION_TYPE_MISMATCH", stepNumber: 1 });
    });

    it("1. TEXTURIZING_ACTION on a GUIDE_AND_STRUCTURE-phase step -> BLOCKER", () => {
      const steps = withOverride(baselineSteps(), { op: "set_value", stepNumber: 2, field: "actionType", value: "TEXTURIZING_ACTION" });
      const result = evaluatePlanCoherence(steps);
      expect(result.blockers).toHaveLength(1);
      expect(result.blockers[0]).toMatchObject({ code: "COHERENCE_PHASE_ACTION_TYPE_MISMATCH", stepNumber: 2 });
    });

    it("1. FINAL_OBSERVATION on a GUIDE_AND_STRUCTURE-phase step -> BLOCKER (phase-scoped pair violated)", () => {
      const steps = withOverride(baselineSteps(), { op: "set_value", stepNumber: 2, field: "actionType", value: "FINAL_OBSERVATION" });
      const result = evaluatePlanCoherence(steps);
      expect(result.blockers).toHaveLength(1);
      expect(result.blockers[0]).toMatchObject({ code: "COHERENCE_PHASE_ACTION_TYPE_MISMATCH", stepNumber: 2 });
    });

    it("1. GUIDE_CUTTING on a CROSS_CHECK_AND_FINISH-phase step -> BLOCKER (phase-scoped pair violated)", () => {
      const steps = withOverride(baselineSteps(), { op: "set_value", stepNumber: 5, field: "actionType", value: "GUIDE_CUTTING" });
      const result = evaluatePlanCoherence(steps);
      expect(result.blockers).toHaveLength(1);
      expect(result.blockers[0]).toMatchObject({ code: "COHERENCE_PHASE_ACTION_TYPE_MISMATCH", stepNumber: 5 });
    });

    it("2. a VALID phase-scoped override (GUIDE_CUTTING on the real GUIDE_AND_STRUCTURE step) produces no phase/actionType blocker", () => {
      const steps = withOverride(baselineSteps(), { op: "set_value", stepNumber: 2, field: "actionType", value: "GUIDE_CUTTING" });
      const result = evaluatePlanCoherence(steps);
      expect(result.blockers.filter((b) => b.code === "COHERENCE_PHASE_ACTION_TYPE_MISMATCH")).toHaveLength(0);
    });

    it("9. a step with an UNKNOWN phase never fabricates a phase/actionType blocker", () => {
      // A zone label the derivation's own PHASE_LABEL_LOOKUP does not
      // recognize -- phase resolves honestly to UNKNOWN.
      const derived = deriveCuttingDemonstrationSteps(cuttingPlan({ cuttingSteps: [{ stepNumber: 1, zone: "Unrecognized zone", action: "x", elevationAngle: "0_deg_blunt", toolRequired: "shears" }] }));
      const steps = [toStepRecord(1, derived[0].payload)];
      const result = evaluatePlanCoherence(steps);
      expect(result).toEqual({ pass: true, blockers: [], warnings: [], reviewItems: [] });
    });
  });

  describe("BLOCKER B -- observation-only actionType with a populated cutting-geometry field", () => {
    it("3. FINAL_OBSERVATION step with fingerAngle materially populated -> BLOCKER", () => {
      const steps = withOverride(baselineSteps(), { op: "set_value", stepNumber: 5, field: "fingerAngle", value: "45 degrees" });
      const result = evaluatePlanCoherence(steps);
      expect(result.pass).toBe(false);
      expect(result.blockers).toHaveLength(1);
      expect(result.blockers[0]).toMatchObject({ code: "COHERENCE_OBSERVATION_ONLY_WITH_CUTTING_GEOMETRY", stepNumber: 5, fields: ["fingerAngle"] });
    });

    it("4. FINAL_OBSERVATION step with geometry fields honestly UNKNOWN (the real baseline default) -> no coherence blocker", () => {
      const result = evaluatePlanCoherence(baselineSteps());
      expect(result.blockers.filter((b) => b.code === "COHERENCE_OBSERVATION_ONLY_WITH_CUTTING_GEOMETRY")).toHaveLength(0);
    });

    it("5. FINAL_OBSERVATION step with a geometry field explicitly marked NOT_APPLICABLE -> no coherence blocker", () => {
      const steps = withOverride(baselineSteps(), { op: "mark_not_applicable", stepNumber: 5, field: "cuttingLine" });
      const result = evaluatePlanCoherence(steps);
      expect(result.blockers.filter((b) => b.code === "COHERENCE_OBSERVATION_ONLY_WITH_CUTTING_GEOMETRY")).toHaveLength(0);
    });

    it("6. a real cutting action (STRUCTURAL_CUTTING) with a populated geometry field is NEVER flagged by the observation-only rule", () => {
      const steps = withOverride(baselineSteps(), { op: "set_value", stepNumber: 3, field: "fingerAngle", value: "45 degrees" });
      const result = evaluatePlanCoherence(steps);
      expect(result.blockers.filter((b) => b.code === "COHERENCE_OBSERVATION_ONLY_WITH_CUTTING_GEOMETRY")).toHaveLength(0);
    });

    it("13. multiple populated geometry fields on the SAME observation-only step yield exactly ONE finding, listing every offending field -- never one finding per field", () => {
      let steps = withOverride(baselineSteps(), { op: "set_value", stepNumber: 5, field: "fingerAngle", value: "45 degrees" });
      steps = withOverride(steps, { op: "set_value", stepNumber: 5, field: "cuttingLine", value: "diagonal" });
      const result = evaluatePlanCoherence(steps);
      const findings = result.blockers.filter((b) => b.code === "COHERENCE_OBSERVATION_ONLY_WITH_CUTTING_GEOMETRY");
      expect(findings).toHaveLength(1);
      expect(findings[0].fields).toEqual(["fingerAngle", "cuttingLine"]);
    });
  });

  describe("WARNING -- One Length + Elevation Cutting + 0 Deg Blunt (locked classification)", () => {
    it("7. the exact real production combination produces a WARNING, never a BLOCKER", () => {
      // Baseline already has structuralTechnique=one_length and
      // elevation=0_deg_blunt; only cuttingTechnique needs the real
      // professional-edit-style override to elevation_cutting.
      const steps = withOverride(baselineSteps(), { op: "set_value", stepNumber: 3, field: "cuttingTechnique", value: "elevation_cutting" });
      const result = evaluatePlanCoherence(steps);
      expect(result.pass).toBe(true); // a warning never fails the plan
      expect(result.blockers).toHaveLength(0);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toMatchObject({
        code: "COHERENCE_ONE_LENGTH_ELEVATION_CUTTING_ZERO_BLUNT",
        severity: "WARNING",
        stepNumber: 3,
      });
    });

    it("changing any one of the three fields away from the exact combination no longer warns", () => {
      const steps = withOverride(baselineSteps(), { op: "set_value", stepNumber: 3, field: "cuttingTechnique", value: "slice_cutting" });
      const result = evaluatePlanCoherence(steps);
      expect(result.warnings.filter((w) => w.code === "COHERENCE_ONE_LENGTH_ELEVATION_CUTTING_ZERO_BLUNT")).toHaveLength(0);
    });
  });

  describe("REVIEW_ONLY -- STRUCTURAL_CUTTING + texturizer-shear (locked classification)", () => {
    it("8. the exact real example produces a REVIEW_ONLY item, never a BLOCKER or WARNING", () => {
      const steps = withOverride(baselineSteps(), { op: "set_value", stepNumber: 3, field: "tool", value: "texturizer-shear" });
      const result = evaluatePlanCoherence(steps);
      expect(result.pass).toBe(true);
      expect(result.blockers).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
      expect(result.reviewItems).toHaveLength(1);
      expect(result.reviewItems[0]).toMatchObject({ code: "COHERENCE_STRUCTURAL_CUTTING_TEXTURIZER_SHEAR_TOOL", severity: "REVIEW_ONLY", stepNumber: 3 });
    });

    it("a DIFFERENT tool on the same STRUCTURAL_CUTTING step never triggers the review item", () => {
      const steps = withOverride(baselineSteps(), { op: "set_value", stepNumber: 3, field: "tool", value: "straight-shear" });
      const result = evaluatePlanCoherence(steps);
      expect(result.reviewItems).toHaveLength(0);
    });
  });

  it("10. the engine evaluates the EFFECTIVE (post-override) value, never the raw baseline", () => {
    const baseline = baselineSteps();
    expect(evaluatePlanCoherence(baseline).blockers).toHaveLength(0); // raw baseline: no contradiction

    const withBadOverride = withOverride(baseline, { op: "set_value", stepNumber: 3, field: "actionType", value: "SECTIONING_ACTION" });
    expect(evaluatePlanCoherence(withBadOverride).blockers).toHaveLength(1); // effective state: contradiction now visible
  });

  it("11. the generated free-text explanation never affects the result -- structured payload is the sole authority", () => {
    const stepsWithLegacyText = baselineSteps().map((s) => (s.stepNumber === 5 ? { ...s, explanation: "Finish with slice and slide to soften line weight, then cross-check symmetry at profile and frontal view." } : s));
    const stepsWithCurrentText = baselineSteps().map((s) => (s.stepNumber === 5 ? { ...s, explanation: "Cross-check symmetry, inspect perimeter balance and silhouette, and compare frontal and profile views to confirm natural fall." } : s));
    expect(evaluatePlanCoherence(stepsWithLegacyText)).toEqual(evaluatePlanCoherence(stepsWithCurrentText));
  });

  it("12. output is deterministic -- identical input always produces a deep-equal result, same order", () => {
    const steps = withOverride(baselineSteps(), { op: "set_value", stepNumber: 3, field: "cuttingTechnique", value: "elevation_cutting" });
    expect(evaluatePlanCoherence(steps)).toEqual(evaluatePlanCoherence(steps));
  });

  it("14. pass is false if and only if blockers is non-empty -- warnings/reviewItems never affect pass", () => {
    const clean = evaluatePlanCoherence(baselineSteps());
    expect(clean.pass).toBe(true);

    const warningOnly = evaluatePlanCoherence(withOverride(baselineSteps(), { op: "set_value", stepNumber: 3, field: "cuttingTechnique", value: "elevation_cutting" }));
    expect(warningOnly.blockers).toHaveLength(0);
    expect(warningOnly.warnings.length).toBeGreaterThan(0);
    expect(warningOnly.pass).toBe(true);

    const reviewOnly = evaluatePlanCoherence(withOverride(baselineSteps(), { op: "set_value", stepNumber: 3, field: "tool", value: "texturizer-shear" }));
    expect(reviewOnly.blockers).toHaveLength(0);
    expect(reviewOnly.reviewItems.length).toBeGreaterThan(0);
    expect(reviewOnly.pass).toBe(true);

    const withBlocker = evaluatePlanCoherence(withOverride(baselineSteps(), { op: "set_value", stepNumber: 3, field: "actionType", value: "SECTIONING_ACTION" }));
    expect(withBlocker.blockers.length).toBeGreaterThan(0);
    expect(withBlocker.pass).toBe(false);
  });

  // Required test 15 (this file's own share of it): touching this pure
  // engine must never change Technical Demonstration's own generator/
  // schema versions -- they live in a completely separate file, untouched
  // by this stage. Guards against an accidental future edit in this area.
  it("15. does not affect Technical Demonstration generator/schema version constants -- they remain their own, separate values", () => {
    expect(TECHNICAL_DEMONSTRATION_CUTTING_GENERATOR_VERSION).toBe("1.3.0-td25f2");
    expect(CUTTING_DEMONSTRATION_STEP_SCHEMA_VERSION).toBe("1.1.0-td25a");
    expect(TECHNICAL_DEMONSTRATION_COHERENCE_RULES_VERSION).toBe("1.0.0-coh1");
  });

  it("every finding carries the current coherence rules version", () => {
    const steps = withOverride(baselineSteps(), { op: "set_value", stepNumber: 3, field: "actionType", value: "SECTIONING_ACTION" });
    const result = evaluatePlanCoherence(steps);
    for (const finding of [...result.blockers, ...result.warnings, ...result.reviewItems]) {
      expect(finding.ruleVersion).toBe(TECHNICAL_DEMONSTRATION_COHERENCE_RULES_VERSION);
    }
  });
});
