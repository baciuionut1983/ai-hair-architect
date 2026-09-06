import { describe, expect, it } from "vitest";

import type { CuttingStep, TechnicalCutPlan } from "@/lib/contracts";
import type { TechnicalDemonstrationStepRecord } from "@/lib/technical-demonstration-contracts";
import { deriveCuttingDemonstrationSteps } from "@/lib/technical-demonstration-derivation";
import type { CuttingDemonstrationStepPayload } from "@/lib/technical-demonstration-cutting-contracts";
import { resolveEffectiveCuttingStepPayload, toCuttingStepOverrideEntry, type CuttingStepOverrideInput } from "@/lib/technical-demonstration-cutting-overrides";
import { evaluatePlanCoherence } from "@/lib/technical-demonstration-cutting-coherence";
import { evaluatePlanReadiness } from "@/lib/technical-demonstration-cutting-video-readiness";
import { deriveEffectiveExecutionState, TECHNICAL_DEMONSTRATION_STATE_DERIVATION_VERSION } from "@/lib/technical-demonstration-cutting-state-derivation";

// Technical Demonstration, Stage 2.5.h.1 -- pure tests for the deterministic
// execution-state derivation engine. No I/O, no database, no provider.
// Mirrors technical-demonstration-cutting-coherence.test.ts's own real-
// engine-fixture style exactly (deriveCuttingDemonstrationSteps against a
// realistic 5-phase TechnicalCutPlan, professional overrides applied via the
// real resolveEffectiveCuttingStepPayload) -- these tests exercise the SAME
// baseline shape production code actually produces, never a hand-invented
// literal payload.

function realisticCuttingSteps(): CuttingStep[] {
  return [
    { stepNumber: 1, zone: "Mapping and sectioning", action: "Partition using 4 quadrant profile radial.", elevationAngle: "0_deg_blunt", toolRequired: "tail-comb" },
    { stepNumber: 2, zone: "Baseline guideline", action: "Set a visual perimeter guideline.", elevationAngle: "0_deg_blunt", toolRequired: "straight-shear" },
    { stepNumber: 3, zone: "Bulk and shape control", action: "Use elevation cutting for perimeter control and natural fall distribution for silhouette correction.", elevationAngle: "0_deg_blunt", toolRequired: "straight-shear" },
    { stepNumber: 4, zone: "Texture refinement", action: "Apply slice and slide only after the structural form is established.", elevationAngle: "0_deg_blunt", toolRequired: "texturizer-shear" },
    { stepNumber: 5, zone: "Cross-check and finish", action: "Cross-check symmetry, inspect perimeter balance and silhouette, and compare frontal and profile views to confirm natural fall.", elevationAngle: "0_deg_blunt", toolRequired: "finishing-comb" },
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

// Real, unedited baseline: phases 1..5 = PREPARATION_AND_SECTIONING /
// GUIDE_AND_STRUCTURE / STRUCTURAL_CUTTING / REFINEMENT_TEXTURIZING /
// CROSS_CHECK_AND_FINISH; actionType = SECTIONING_ACTION / UNKNOWN (GUIDE_AND_
// STRUCTURE has no deterministic actionType) / STRUCTURAL_CUTTING /
// TEXTURIZING_ACTION / FINAL_OBSERVATION.
function baselineSteps(planOverrides: Partial<TechnicalCutPlan> = {}): TechnicalDemonstrationStepRecord[] {
  return deriveCuttingDemonstrationSteps(cuttingPlan(planOverrides)).map((derived) => toStepRecord(derived.stepNumber, derived.payload, derived.explanation));
}

function withOverride(steps: TechnicalDemonstrationStepRecord[], input: CuttingStepOverrideInput): TechnicalDemonstrationStepRecord[] {
  const entry = toCuttingStepOverrideEntry(input, new Date("2026-01-01T00:00:00.000Z"));
  return steps.map((step) => {
    if (step.stepNumber !== input.stepNumber) return step;
    const effective = resolveEffectiveCuttingStepPayload(step.stepNumber, step.payload as unknown as CuttingDemonstrationStepPayload, [entry]);
    return { ...step, payload: effective as unknown as Record<string, unknown> };
  });
}

function payloadOf(steps: TechnicalDemonstrationStepRecord[], stepNumber: number): CuttingDemonstrationStepPayload {
  const step = steps.find((s) => s.stepNumber === stepNumber);
  if (!step) throw new Error(`no step ${stepNumber}`);
  return step.payload as unknown as CuttingDemonstrationStepPayload;
}

describe("TECHNICAL_DEMONSTRATION_STATE_DERIVATION_VERSION", () => {
  it("is exported and versioned independently of the generator/schema/coherence versions", () => {
    expect(TECHNICAL_DEMONSTRATION_STATE_DERIVATION_VERSION).toBe("1.0.0-st25h1");
  });
});

describe("deriveEffectiveExecutionState -- stateAfter (test 2)", () => {
  it("STRUCTURAL_CUTTING step: derives from structuralTechnique + cuttingTechnique + elevation + combingDirection + overdirection + tool, all already-approved", () => {
    const derived = deriveEffectiveExecutionState(baselineSteps());
    const step3 = payloadOf(derived, 3);
    expect(step3.stateAfter.provenance).toBe("DETERMINISTIC_DERIVATION");
    const sentence = step3.stateAfter.value as string;
    expect(sentence).toContain("one length");
    expect(sentence).toContain("blunt line");
    expect(sentence).toContain("0 deg blunt");
    expect(sentence).toContain("not overdirected");
    expect(sentence).toContain("straight-shear");
  });

  it("PREPARATION_AND_SECTIONING step: derives from sectioning + tool only", () => {
    const derived = deriveEffectiveExecutionState(baselineSteps());
    const step1 = payloadOf(derived, 1);
    expect(step1.stateAfter.provenance).toBe("DETERMINISTIC_DERIVATION");
    expect(step1.stateAfter.value).toBe("Hair sectioned using 4 quadrant profile radial. Tool: tail-comb.");
  });

  it("REFINEMENT_TEXTURIZING step: derives from texturizingTechnique + tool", () => {
    const derived = deriveEffectiveExecutionState(baselineSteps());
    const step4 = payloadOf(derived, 4);
    expect(step4.stateAfter.provenance).toBe("DETERMINISTIC_DERIVATION");
    expect(step4.stateAfter.value).toBe("Texture refined using slice and slide. Tool: texturizer-shear.");
  });

  it("GUIDE_AND_STRUCTURE step with a professionally-classified GUIDE_CUTTING actionType: derives from guideType + tool + actionType wording", () => {
    const derived = deriveEffectiveExecutionState(withOverride(baselineSteps(), { op: "set_value", stepNumber: 2, field: "actionType", value: "GUIDE_CUTTING" }));
    const step2 = payloadOf(derived, 2);
    expect(step2.stateAfter.provenance).toBe("DETERMINISTIC_DERIVATION");
    expect(step2.stateAfter.value).toBe("Guideline cut and established using visual perimeter. Tool: straight-shear.");
  });

  it("GUIDE_AND_STRUCTURE step with no actionType classification yet: still derives a neutral, actionType-agnostic sentence from guideType alone", () => {
    const derived = deriveEffectiveExecutionState(baselineSteps());
    const step2 = payloadOf(derived, 2);
    expect(step2.actionType.provenance).toBe("UNKNOWN"); // no deterministic fallback exists for this phase
    expect(step2.stateAfter.provenance).toBe("DETERMINISTIC_DERIVATION");
    expect(step2.stateAfter.value).toBe("Guideline set using visual perimeter. Tool: straight-shear.");
  });
});

describe("deriveEffectiveExecutionState -- stateBefore chaining (tests 1, 3)", () => {
  it("first step: derives a fixed initial-state sentence that names no client hair fact (length/texture/condition/zone)", () => {
    const derived = deriveEffectiveExecutionState(baselineSteps());
    const step1 = payloadOf(derived, 1);
    expect(step1.stateBefore.provenance).toBe("DETERMINISTIC_DERIVATION");
    expect(step1.stateBefore.value).toBe("Initial state: no prior technical demonstration action has occurred in this plan.");
  });

  it("every later step's stateBefore equals the immediately preceding step's own derived stateAfter, chained through all 5 steps", () => {
    const derived = deriveEffectiveExecutionState(baselineSteps());
    for (let stepNumber = 2; stepNumber <= 5; stepNumber += 1) {
      const previous = payloadOf(derived, stepNumber - 1);
      const current = payloadOf(derived, stepNumber);
      expect(current.stateBefore.provenance).toBe("DETERMINISTIC_DERIVATION");
      expect(current.stateBefore.value).toBe(previous.stateAfter.value);
    }
  });

  it("is deterministic regardless of the input array's own order (re-sorts by stepNumber internally)", () => {
    const ordered = deriveEffectiveExecutionState(baselineSteps());
    const shuffled = deriveEffectiveExecutionState([...baselineSteps()].reverse());
    expect(shuffled.find((s) => s.stepNumber === 3)!.payload).toEqual(ordered.find((s) => s.stepNumber === 3)!.payload);
    expect(shuffled.find((s) => s.stepNumber === 5)!.payload).toEqual(ordered.find((s) => s.stepNumber === 5)!.payload);
  });

  it("running the derivation twice on its own output is idempotent (already-populated fields are never re-derived)", () => {
    const once = deriveEffectiveExecutionState(baselineSteps());
    const twice = deriveEffectiveExecutionState(once);
    expect(twice).toEqual(once);
  });
});

describe("deriveEffectiveExecutionState -- crossCheck (tests 5, 6)", () => {
  it("FINAL_OBSERVATION step: derives crossCheck=true from the existing, fixed final-observation contract", () => {
    const derived = deriveEffectiveExecutionState(baselineSteps());
    const step5 = payloadOf(derived, 5);
    expect(step5.actionType.value).toBe("FINAL_OBSERVATION");
    expect(step5.crossCheck).toEqual({ value: true, provenance: "DETERMINISTIC_DERIVATION" });
  });

  it("a step professionally reclassified to CORRECTIVE_CUTTING on the same final phase does NOT get a fabricated crossCheck", () => {
    const derived = deriveEffectiveExecutionState(withOverride(baselineSteps(), { op: "set_value", stepNumber: 5, field: "actionType", value: "CORRECTIVE_CUTTING" }));
    const step5 = payloadOf(derived, 5);
    expect(step5.crossCheck.provenance).toBe("UNKNOWN");
  });

  it("non-final steps (SECTIONING_ACTION, STRUCTURAL_CUTTING, TEXTURIZING_ACTION) never receive a fabricated crossCheck", () => {
    const derived = deriveEffectiveExecutionState(baselineSteps());
    expect(payloadOf(derived, 1).crossCheck.provenance).toBe("UNKNOWN");
    expect(payloadOf(derived, 3).crossCheck.provenance).toBe("UNKNOWN");
    expect(payloadOf(derived, 4).crossCheck.provenance).toBe("UNKNOWN");
  });
});

describe("deriveEffectiveExecutionState -- no invention when authority is insufficient (tests 4, 13)", () => {
  it("a step whose own phase cannot be resolved (unrecognized zone label) leaves stateAfter and crossCheck honestly UNKNOWN", () => {
    const plan = cuttingPlan({ cuttingSteps: [{ stepNumber: 1, zone: "some unrecognized label", action: "x", elevationAngle: "0_deg_blunt", toolRequired: "comb" }] });
    const derived = deriveEffectiveExecutionState(baselineSteps(plan));
    const step1 = payloadOf(derived, 1);
    expect(step1.phase.provenance).toBe("UNKNOWN");
    expect(step1.stateAfter.provenance).toBe("UNKNOWN");
    expect(step1.crossCheck.provenance).toBe("UNKNOWN");
    // stateBefore is still safely derivable -- it is the first step, and the
    // fixed initial sentence never depends on phase being known.
    expect(step1.stateBefore.provenance).toBe("DETERMINISTIC_DERIVATION");
  });

  it("a second step following an unresolved-phase first step gets no chained stateBefore (no proven predecessor state to copy)", () => {
    const plan = cuttingPlan({
      cuttingSteps: [
        { stepNumber: 1, zone: "some unrecognized label", action: "x", elevationAngle: "0_deg_blunt", toolRequired: "comb" },
        { stepNumber: 2, zone: "Baseline guideline", action: "x", elevationAngle: "0_deg_blunt", toolRequired: "straight-shear" },
      ],
    });
    const derived = deriveEffectiveExecutionState(baselineSteps(plan));
    expect(payloadOf(derived, 2).stateBefore.provenance).toBe("UNKNOWN");
  });

  it("never writes DETERMINISTIC_DERIVATION to any field other than stateBefore/stateAfter/crossCheck", () => {
    const derived = deriveEffectiveExecutionState(baselineSteps());
    const untouchedFields: (keyof CuttingDemonstrationStepPayload)[] = [
      "zones",
      "subsectioning",
      "subsectionThickness",
      "progression",
      "zoneConnection",
      "styling",
      "observationView",
      "clientHeadPosition",
      "fingerPosition",
      "fingerAngle",
      "cuttingAngle",
      "cuttingLine",
      "toolOrientation",
    ];
    for (const step of derived) {
      const payload = step.payload as unknown as CuttingDemonstrationStepPayload;
      for (const field of untouchedFields) {
        expect((payload[field] as { provenance: string }).provenance).not.toBe("DETERMINISTIC_DERIVATION");
      }
    }
  });

  it("never introduces an automatic NOT_APPLICABLE anywhere", () => {
    const derived = deriveEffectiveExecutionState(baselineSteps());
    for (const step of derived) {
      const payload = step.payload as unknown as CuttingDemonstrationStepPayload;
      for (const key of Object.keys(payload) as (keyof CuttingDemonstrationStepPayload)[]) {
        const entry = payload[key] as { provenance?: string } | unknown;
        if (entry && typeof entry === "object" && "provenance" in entry) {
          expect((entry as { provenance: string }).provenance).not.toBe("NOT_APPLICABLE");
        }
      }
    }
  });
});

describe("deriveEffectiveExecutionState -- professional authority precedence (tests 7, 8)", () => {
  it("a genuine LOCAL professional override on stateAfter is never touched or recomputed", () => {
    const overridden = withOverride(baselineSteps(), { op: "set_value", stepNumber: 3, field: "stateAfter", value: "Professional's own exact wording." });
    const derived = deriveEffectiveExecutionState(overridden);
    const step3 = payloadOf(derived, 3);
    expect(step3.stateAfter).toEqual({ value: "Professional's own exact wording.", provenance: "PROFESSIONAL_OVERRIDE" });
  });

  it("a professional NOT_APPLICABLE decision on crossCheck is never overwritten by the FINAL_OBSERVATION derivation rule", () => {
    const overridden = withOverride(baselineSteps(), { op: "mark_not_applicable", stepNumber: 5, field: "crossCheck" });
    const derived = deriveEffectiveExecutionState(overridden);
    expect(payloadOf(derived, 5).crossCheck).toEqual({ value: null, provenance: "NOT_APPLICABLE" });
  });

  it("a professional NOT_APPLICABLE decision on a predecessor's stateAfter breaks the chain honestly (no fabricated stateBefore on the next step)", () => {
    const overridden = withOverride(baselineSteps(), { op: "mark_not_applicable", stepNumber: 2, field: "stateAfter" });
    const derived = deriveEffectiveExecutionState(overridden);
    expect(payloadOf(derived, 3).stateBefore.provenance).toBe("UNKNOWN");
  });

  it("upstream professional input (an AnalysisProposal edit baked into the baseline as PROFESSIONAL_OVERRIDE) is read as authoritative INPUT and correctly reflected in the derived sentence", () => {
    // Reproduces the real V4 shape: cuttingTechnique on step 3 is
    // PROFESSIONAL_OVERRIDE because the source plan's own field was edited
    // upstream (technical-demonstration-derivation.ts's own inferredOrOverride),
    // not because of any Technical Demonstration-level override.
    const steps = deriveCuttingDemonstrationSteps(cuttingPlan({ cuttingTechnique: "elevation_cutting" }), new Set(["cuttingTechnique"])).map((derived) =>
      toStepRecord(derived.stepNumber, derived.payload, derived.explanation),
    );
    const step3Before = steps.find((s) => s.stepNumber === 3)!.payload as unknown as CuttingDemonstrationStepPayload;
    expect(step3Before.cuttingTechnique).toEqual({ value: "elevation_cutting", provenance: "PROFESSIONAL_OVERRIDE" });

    const derived = deriveEffectiveExecutionState(steps);
    const step3 = payloadOf(derived, 3);
    expect(step3.stateAfter.value).toContain("elevation cutting");
  });
});

describe("deriveEffectiveExecutionState -- stale free-text isolation (tests 9, 10)", () => {
  it("V4-style contradiction: structured cuttingTechnique=blunt_line wins over a stale explanation still describing elevation cutting", () => {
    const steps = baselineSteps(); // structuralTechnique=one_length, cuttingTechnique=blunt_line
    const stale = steps.map((step) =>
      step.stepNumber === 3
        ? { ...step, explanation: "Use elevation cutting for perimeter control and natural fall distribution for silhouette correction." }
        : step,
    );
    const derived = deriveEffectiveExecutionState(stale);
    const step3 = payloadOf(derived, 3);
    expect(step3.cuttingTechnique.value).toBe("blunt_line");
    expect(step3.stateAfter.value).toContain("blunt line");
    expect(step3.stateAfter.value).not.toContain("elevation cutting");
    // explanation itself passes through completely untouched -- this stage
    // deliberately does not fix the stale-description UX/data problem.
    expect(derived.find((s) => s.stepNumber === 3)!.explanation).toBe(stale.find((s) => s.stepNumber === 3)!.explanation);
  });

  it("changing only `explanation` (never the structured payload) never changes the derived stateAfter", () => {
    const a = deriveEffectiveExecutionState(baselineSteps());
    const steps = baselineSteps().map((step) => ({ ...step, explanation: "completely different, irrelevant free text" }));
    const b = deriveEffectiveExecutionState(steps);
    expect(payloadOf(b, 3).stateAfter).toEqual(payloadOf(a, 3).stateAfter);
  });
});

describe("readiness integration (tests 11, 12, 15)", () => {
  it("readiness no longer blocks on stateBefore/stateAfter/crossCheck once derived, but still blocks on every other unresolved field", () => {
    const plan = { id: "plan-1", planVersion: 1, status: "CONFIRMED" as const };
    const before = evaluatePlanReadiness(plan, baselineSteps());
    const after = evaluatePlanReadiness(plan, deriveEffectiveExecutionState(baselineSteps()));

    const beforeFields = new Set(before.steps.flatMap((s) => s.reasons.map((r) => r.field)));
    const afterFields = new Set(after.steps.flatMap((s) => s.reasons.map((r) => r.field)));

    expect(beforeFields.has("stateBefore")).toBe(true);
    expect(beforeFields.has("stateAfter")).toBe(true);
    expect(afterFields.has("stateBefore")).toBe(false);
    expect(afterFields.has("stateAfter")).toBe(false);

    // Every other still-genuinely-unresolved field remains a real blocker --
    // derivation removes exactly the 3 audited fields, nothing more.
    expect(afterFields.has("zones")).toBe(true);
    expect(afterFields.has("subsectioning")).toBe(true);
    expect(afterFields.has("clientHeadPosition")).toBe(true);
    expect(afterFields.has("fingerPosition")).toBe(true);
  });

  it("crossCheck stops blocking Step 5 specifically once derived", () => {
    const plan = { id: "plan-1", planVersion: 1, status: "CONFIRMED" as const };
    const before = evaluatePlanReadiness(plan, baselineSteps());
    const after = evaluatePlanReadiness(plan, deriveEffectiveExecutionState(baselineSteps()));
    expect(before.steps[4].reasons.some((r) => r.field === "crossCheck")).toBe(true);
    expect(after.steps[4].reasons.some((r) => r.field === "crossCheck")).toBe(false);
  });

  it("coherence findings are completely unaffected by state derivation (coherence never reads these 3 fields)", () => {
    const before = evaluatePlanCoherence(baselineSteps());
    const after = evaluatePlanCoherence(deriveEffectiveExecutionState(baselineSteps()));
    expect(after).toEqual(before);
  });
});
