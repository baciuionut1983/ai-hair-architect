import { describe, expect, it } from "vitest";

import type { CuttingStep, TechnicalCutPlan } from "@/lib/contracts";
import type { TechnicalDemonstrationPlanRecord, TechnicalDemonstrationStepRecord } from "@/lib/technical-demonstration-contracts";
import { deriveCuttingDemonstrationSteps } from "@/lib/technical-demonstration-derivation";
import type { CuttingDemonstrationStepPayload, CuttingExecutionPhase } from "@/lib/technical-demonstration-cutting-contracts";
import {
  resolveEffectiveCuttingStepPayload,
  toCuttingStepOverrideEntry,
  type CuttingStepOverrideEntry,
  type CuttingStepOverrideInput,
} from "@/lib/technical-demonstration-cutting-overrides";
import {
  CUTTING_EXECUTION_VIDEO_READINESS_RULES,
  evaluatePlanReadiness,
  evaluateStepReadiness,
  resolveFieldReadinessRule,
} from "@/lib/technical-demonstration-cutting-video-readiness";

// Technical Demonstration, Stage 2.5.c -- pure tests for the Technical
// Execution Video readiness gate. No I/O, no database, no provider --
// mirrors technical-demonstration-cutting-overrides.test.ts's own real-
// engine-fixture style exactly (deriveCuttingDemonstrationSteps against a
// realistic 5-phase TechnicalCutPlan), rather than hand-authored payload
// literals, so these tests exercise the SAME baseline shape production
// code actually produces.

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

function baselineSteps(): TechnicalDemonstrationStepRecord[] {
  return deriveCuttingDemonstrationSteps(cuttingPlan()).map((derived) => toStepRecord(derived.stepNumber, derived.payload, derived.explanation));
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

function planPick(status: string, planVersion = 1, id = "plan-1"): Pick<TechnicalDemonstrationPlanRecord, "id" | "planVersion" | "status"> {
  return { id, planVersion, status: status as TechnicalDemonstrationPlanRecord["status"] };
}

const FIXED_NOW = new Date("2026-01-02T00:00:00.000Z");

function applyOverrideInputs(steps: TechnicalDemonstrationStepRecord[], inputs: CuttingStepOverrideInput[]): TechnicalDemonstrationStepRecord[] {
  const entries: CuttingStepOverrideEntry[] = inputs.map((input) => toCuttingStepOverrideEntry(input, FIXED_NOW));
  return steps.map((step) => ({
    ...step,
    payload: resolveEffectiveCuttingStepPayload(step.stepNumber, step.payload as unknown as CuttingDemonstrationStepPayload, entries) as unknown as Record<
      string,
      unknown
    >,
  }));
}

// Builds the minimal set of overrides that make ONE step fully readiness-
// satisfied: `mark_not_applicable` for every CONDITIONALLY_REQUIRED field
// this step's own phase actually evaluates (the professional's own
// explicit "genuinely doesn't apply here" decision), plus `set_value` for
// the two REQUIRED fields Stage 2.5.a's own derivation always leaves
// UNKNOWN (stateBefore/stateAfter) and, on CROSS_CHECK_AND_FINISH only,
// crossCheck (also always UNKNOWN by derivation). Every other REQUIRED
// field is already populated by the real derivation for the phase it
// actually applies to (see baselineSteps' own real engine output).
function readinessSatisfyingOverrides(stepNumber: number, phase: CuttingExecutionPhase): CuttingStepOverrideInput[] {
  const overrides: CuttingStepOverrideInput[] = [
    { op: "set_value", stepNumber, field: "stateBefore", value: "Hair is clean, dry, and detangled." },
    { op: "set_value", stepNumber, field: "stateAfter", value: "Section shaped as intended for this phase." },
  ];
  for (const rule of CUTTING_EXECUTION_VIDEO_READINESS_RULES) {
    if (rule.requirementClass !== "CONDITIONALLY_REQUIRED") continue;
    if (!rule.applicablePhases.includes(phase)) continue;
    overrides.push({ op: "mark_not_applicable", stepNumber, field: rule.field });
  }
  if (phase === "CROSS_CHECK_AND_FINISH") {
    overrides.push({ op: "set_value", stepNumber, field: "crossCheck", value: true });
  }
  return overrides;
}

function fullyReadySteps(): TechnicalDemonstrationStepRecord[] {
  const steps = baselineSteps();
  const inputs = steps.flatMap((step) => readinessSatisfyingOverrides(step.stepNumber, (step.payload as unknown as CuttingDemonstrationStepPayload).phase.value!));
  return applyOverrideInputs(steps, inputs);
}

describe("evaluateStepReadiness", () => {
  it("blocks on an unrecognized/UNKNOWN phase, evaluating no field rules at all", () => {
    const [step1] = baselineSteps();
    const payload = { ...(step1.payload as unknown as CuttingDemonstrationStepPayload), phase: { value: null, provenance: "UNKNOWN" as const } };
    const result = evaluateStepReadiness(toStepRecord(1, payload));

    expect(result.ready).toBe(false);
    expect(result.phase).toBeNull();
    expect(result.reasons).toHaveLength(1);
    expect(result.reasons[0].code).toBe("READINESS_UNKNOWN_PHASE");
  });

  it("reports the step's own resolved phase", () => {
    const steps = baselineSteps();
    const result = evaluateStepReadiness(steps[1]); // step 2 -- GUIDE_AND_STRUCTURE
    expect(result.phase).toBe("GUIDE_AND_STRUCTURE");
    expect(result.stepNumber).toBe(2);
  });

  it("a critical REQUIRED field left UNKNOWN by the real derivation (stateBefore/stateAfter) blocks the step", () => {
    const [step1] = baselineSteps();
    const result = evaluateStepReadiness(step1);
    expect(result.ready).toBe(false);
    const fields = result.reasons.map((r) => r.field);
    expect(fields).toContain("stateBefore");
    expect(fields).toContain("stateAfter");
    expect(result.reasons.find((r) => r.field === "stateBefore")?.code).toBe("READINESS_MISSING_REQUIRED_FIELD");
  });

  it("UNKNOWN is never silently treated as NOT_APPLICABLE -- an untouched CONDITIONALLY_REQUIRED field still blocks", () => {
    const [step1] = baselineSteps();
    const result = evaluateStepReadiness(step1);
    const zonesReason = result.reasons.find((r) => r.field === "zones");
    expect(zonesReason).toBeDefined();
    expect(zonesReason?.code).toBe("READINESS_MISSING_CONDITIONALLY_REQUIRED_FIELD");
  });

  it("an explicit NOT_APPLICABLE override satisfies a CONDITIONALLY_REQUIRED field without satisfying any other field", () => {
    const [step1] = baselineSteps();
    const [effectiveStep1] = applyOverrideInputs([step1], [{ op: "mark_not_applicable", stepNumber: 1, field: "zones" }]);
    const result = evaluateStepReadiness(effectiveStep1);

    expect(result.reasons.find((r) => r.field === "zones")).toBeUndefined();
    // Everything else this step's phase still evaluates remains blocked --
    // marking one field N/A must never satisfy any other field.
    expect(result.reasons.find((r) => r.field === "subsectioning")).toBeDefined();
    expect(result.reasons.find((r) => r.field === "stateBefore")).toBeDefined();
  });

  it("a professional override changes the EFFECTIVE readiness outcome without mutating the baseline step", () => {
    const [step1] = baselineSteps();
    const before = JSON.stringify(step1);

    const inputs = readinessSatisfyingOverrides(1, "PREPARATION_AND_SECTIONING");
    const [effectiveStep1] = applyOverrideInputs([step1], inputs);

    expect(evaluateStepReadiness(step1).ready).toBe(false); // baseline, untouched
    expect(evaluateStepReadiness(effectiveStep1).ready).toBe(true); // effective, overridden

    expect(JSON.stringify(step1)).toBe(before); // baseline object itself was never mutated
  });

  describe("FINAL_CHECK (CROSS_CHECK_AND_FINISH) cutting-geometry exception", () => {
    it("a pure observation/check step is ready without ever populating the 5 cutting-geometry fields or clientHeadPosition", () => {
      const steps = baselineSteps();
      const step5 = steps[4];
      const inputs = readinessSatisfyingOverrides(5, "CROSS_CHECK_AND_FINISH");
      const [effectiveStep5] = applyOverrideInputs([step5], inputs);

      const result = evaluateStepReadiness(effectiveStep5);
      expect(result.ready).toBe(true);
      expect(result.reasons).toHaveLength(0);

      // Confirm this was achieved WITHOUT touching the geometry fields --
      // they remain UNKNOWN on the effective payload and simply were never
      // evaluated.
      const payload = effectiveStep5.payload as unknown as CuttingDemonstrationStepPayload;
      for (const field of ["fingerPosition", "fingerAngle", "cuttingAngle", "cuttingLine", "toolOrientation", "clientHeadPosition"] as const) {
        expect(payload[field].provenance).toBe("UNKNOWN");
      }
    });

    it("a professional-supplied real cutting-geometry value on FINAL_CHECK does not change the readiness outcome (still never required)", () => {
      const steps = baselineSteps();
      const step5 = steps[4];
      const inputs: CuttingStepOverrideInput[] = [
        ...readinessSatisfyingOverrides(5, "CROSS_CHECK_AND_FINISH"),
        { op: "set_value", stepNumber: 5, field: "cuttingAngle", value: "45 degrees, corrective." },
      ];
      const [effectiveStep5] = applyOverrideInputs([step5], inputs);

      const result = evaluateStepReadiness(effectiveStep5);
      expect(result.ready).toBe(true);
      expect(result.reasons).toHaveLength(0);
    });

    it("a STRUCTURAL_CUTTING (non-FINAL_CHECK) step DOES require the cutting-geometry fields", () => {
      const steps = baselineSteps();
      const step3 = steps[2]; // STRUCTURAL_CUTTING
      const inputs = readinessSatisfyingOverrides(3, "STRUCTURAL_CUTTING");
      const [effectiveStep3] = applyOverrideInputs([step3], inputs);
      const result = evaluateStepReadiness(effectiveStep3);
      expect(result.ready).toBe(true); // satisfied via mark_not_applicable in readinessSatisfyingOverrides

      // Prove they were actually evaluated (not just skipped) by removing
      // just one of them from the satisfying set and confirming it blocks.
      const withoutFingerPosition = inputs.filter((i) => i.field !== "fingerPosition");
      const [effectiveStep3Partial] = applyOverrideInputs([step3], withoutFingerPosition);
      const partialResult = evaluateStepReadiness(effectiveStep3Partial);
      expect(partialResult.ready).toBe(false);
      expect(partialResult.reasons.find((r) => r.field === "fingerPosition")).toBeDefined();
    });
  });

  it("'natural fall / no additional styling' is a valid real value (PROFESSIONAL_OVERRIDE), never requires NOT_APPLICABLE", () => {
    const [step1] = baselineSteps();
    const [effectiveStep1] = applyOverrideInputs(
      [step1],
      [{ op: "set_value", stepNumber: 1, field: "styling", value: "Natural fall, no additional styling required." }],
    );
    const payload = effectiveStep1.payload as unknown as CuttingDemonstrationStepPayload;
    expect(payload.styling.provenance).toBe("PROFESSIONAL_OVERRIDE");

    const result = evaluateStepReadiness(effectiveStep1);
    expect(result.reasons.find((r) => r.field === "styling")).toBeUndefined();
  });

  it("clientHeadPosition and observationView are evaluated independently -- setting one never satisfies the other", () => {
    const steps = baselineSteps();
    const step3 = steps[2]; // STRUCTURAL_CUTTING -- both fields applicable here
    const baseInputs = readinessSatisfyingOverrides(3, "STRUCTURAL_CUTTING").filter(
      (i) => i.field !== "clientHeadPosition" && i.field !== "observationView",
    );

    const [onlyClientHeadPosition] = applyOverrideInputs(
      [step3],
      [...baseInputs, { op: "set_value", stepNumber: 3, field: "clientHeadPosition", value: "Chin down." }],
    );
    const resultA = evaluateStepReadiness(onlyClientHeadPosition);
    expect(resultA.reasons.find((r) => r.field === "clientHeadPosition")).toBeUndefined();
    expect(resultA.reasons.find((r) => r.field === "observationView")).toBeDefined();

    const [onlyObservationView] = applyOverrideInputs(
      [step3],
      [...baseInputs, { op: "set_value", stepNumber: 3, field: "observationView", value: "Front view." }],
    );
    const resultB = evaluateStepReadiness(onlyObservationView);
    expect(resultB.reasons.find((r) => r.field === "observationView")).toBeUndefined();
    expect(resultB.reasons.find((r) => r.field === "clientHeadPosition")).toBeDefined();
  });

  it("headBodyPositioning (deprecated) is never evaluated -- a fully ready step stays ready with it permanently UNKNOWN", () => {
    const [step1] = baselineSteps();
    const [effectiveStep1] = applyOverrideInputs([step1], readinessSatisfyingOverrides(1, "PREPARATION_AND_SECTIONING"));

    const payload = effectiveStep1.payload as unknown as CuttingDemonstrationStepPayload;
    expect(payload.headBodyPositioning.provenance).toBe("UNKNOWN");

    const result = evaluateStepReadiness(effectiveStep1);
    expect(result.ready).toBe(true);
    expect(result.reasons.find((r) => r.field === "headBodyPositioning")).toBeUndefined();
  });
});

describe("resolveFieldReadinessRule", () => {
  it("returns the rule for a real evaluated field", () => {
    expect(resolveFieldReadinessRule("cuttingAngle")?.requirementClass).toBe("CONDITIONALLY_REQUIRED");
    expect(resolveFieldReadinessRule("sectioning")?.requirementClass).toBe("REQUIRED");
  });

  it("returns undefined for a field deliberately never evaluated (headBodyPositioning)", () => {
    expect(resolveFieldReadinessRule("headBodyPositioning")).toBeUndefined();
  });
});

describe("evaluatePlanReadiness", () => {
  it("a DRAFT plan is never ready, even when every one of its steps is individually satisfied", () => {
    const steps = fullyReadySteps();
    expect(steps.every((s) => evaluateStepReadiness(s).ready)).toBe(true); // sanity: steps really are all ready

    const result = evaluatePlanReadiness(planPick("DRAFT"), steps);
    expect(result.ready).toBe(false);
    expect(result.planLevelReasons.some((r) => r.code === "READINESS_PLAN_NOT_CONFIRMED")).toBe(true);
    // The steps themselves are still individually reported as ready -- the
    // DRAFT gate is a distinct, plan-level reason, never smeared onto the
    // step results.
    expect(result.steps.every((s) => s.ready)).toBe(true);
  });

  it("a SUPERSEDED plan is never ready either", () => {
    const steps = fullyReadySteps();
    const result = evaluatePlanReadiness(planPick("SUPERSEDED"), steps);
    expect(result.ready).toBe(false);
    expect(result.planLevelReasons.some((r) => r.code === "READINESS_PLAN_NOT_CONFIRMED")).toBe(true);
  });

  it("a CONFIRMED plan with every step ready is READY, with zero blocking reasons anywhere", () => {
    const steps = fullyReadySteps();
    const result = evaluatePlanReadiness(planPick("CONFIRMED"), steps);
    expect(result.ready).toBe(true);
    expect(result.planLevelReasons).toHaveLength(0);
    expect(result.steps.every((s) => s.ready && s.reasons.length === 0)).toBe(true);
  });

  it("one unready step blocks the whole CONFIRMED plan, without excluding that step from the result", () => {
    const steps = fullyReadySteps();
    // Revert step 4 back to its own untouched baseline (unready).
    const [rawStep4] = baselineSteps().filter((s) => s.stepNumber === 4);
    const mixedSteps = steps.map((s) => (s.stepNumber === 4 ? rawStep4 : s));

    const result = evaluatePlanReadiness(planPick("CONFIRMED"), mixedSteps);
    expect(result.ready).toBe(false);
    expect(result.planLevelReasons).toHaveLength(0); // plan itself IS confirmed -- the block is step-level

    expect(result.steps).toHaveLength(5);
    const step4Result = result.steps.find((s) => s.stepNumber === 4);
    expect(step4Result).toBeDefined();
    expect(step4Result?.ready).toBe(false);
    expect(step4Result!.reasons.length).toBeGreaterThan(0);

    // Every reason for step 4 is correctly attributed to step 4, never to
    // another step.
    for (const reason of step4Result!.reasons) {
      expect(reason.stepNumber).toBe(4);
    }

    // The other four steps remain individually ready.
    for (const stepNumber of [1, 2, 3, 5]) {
      expect(result.steps.find((s) => s.stepNumber === stepNumber)?.ready).toBe(true);
    }
  });

  it("carries the exact planId/planVersion/status evaluated -- version-specific, never assumed", () => {
    const steps = fullyReadySteps();
    const result = evaluatePlanReadiness(planPick("CONFIRMED", 3, "plan-v3"), steps);
    expect(result.planId).toBe("plan-v3");
    expect(result.planVersion).toBe(3);
    expect(result.status).toBe("CONFIRMED");
  });

  it("never mutates the plan or steps it is given", () => {
    const steps = fullyReadySteps();
    const plan = planPick("CONFIRMED");
    const stepsBefore = JSON.stringify(steps);
    const planBefore = JSON.stringify(plan);

    evaluatePlanReadiness(plan, steps);

    expect(JSON.stringify(steps)).toBe(stepsBefore);
    expect(JSON.stringify(plan)).toBe(planBefore);
  });

  it("a CONFIRMED plan with zero steps is vacuously ready (no step exists to be unready)", () => {
    const result = evaluatePlanReadiness(planPick("CONFIRMED"), []);
    expect(result.ready).toBe(true);
    expect(result.steps).toHaveLength(0);
  });
});
