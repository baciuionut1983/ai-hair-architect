import { describe, expect, it } from "vitest";

import { generateTreatmentPlan, shouldGenerateTreatmentPlan, type TreatmentEngineInput } from "./treatment-plan-engine";
import { calculateRecommendationConfidence } from "./recommendation-engine-shared";

const BASE_INPUT: TreatmentEngineInput = {
  goal: "refresh",
  hairType: "medium",
  density: "medium",
  porosity: "medium"
};

describe("treatment-plan-engine: shouldGenerateTreatmentPlan", () => {
  it("does not fire for unrelated goals with no treatment signal", () => {
    expect(shouldGenerateTreatmentPlan({ ...BASE_INPUT, goal: "refresh" })).toBe(false);
    expect(shouldGenerateTreatmentPlan({ ...BASE_INPUT, goal: "reshape" })).toBe(false);
    expect(shouldGenerateTreatmentPlan({ ...BASE_INPUT, goal: "cover" })).toBe(false);
    expect(shouldGenerateTreatmentPlan({ ...BASE_INPUT, goal: "lighten" })).toBe(false);
  });

  it("does not fire merely from a compromised hairCondition -- treatment must be explicitly requested", () => {
    expect(
      shouldGenerateTreatmentPlan({ ...BASE_INPUT, goal: "refresh", hairCondition: "fragile_breakage" })
    ).toBe(false);
  });

  it("fires for the unambiguous treat goal", () => {
    expect(shouldGenerateTreatmentPlan({ ...BASE_INPUT, goal: "treat" })).toBe(true);
  });

  it("fires on an explicit treatment signal even when the goal is ambiguous", () => {
    expect(
      shouldGenerateTreatmentPlan({ ...BASE_INPUT, goal: "refresh", treatmentGoalDetail: "hydration" })
    ).toBe(true);
    expect(shouldGenerateTreatmentPlan({ ...BASE_INPUT, goal: "correct", scalpCondition: "dry" })).toBe(true);
  });
});

describe("treatment-plan-engine: determinism", () => {
  it("returns identical output for identical input", () => {
    const input: TreatmentEngineInput = {
      ...BASE_INPUT,
      goal: "treat",
      hairCondition: "fragile_breakage",
      treatmentGoalDetail: "repair"
    };
    expect(generateTreatmentPlan(input)).toEqual(generateTreatmentPlan({ ...input }));
  });

  it("reuses the shared confidence formula verbatim", () => {
    const input: TreatmentEngineInput = {
      ...BASE_INPUT,
      goal: "treat",
      treatmentGoalDetail: "hydration"
    };
    const plan = generateTreatmentPlan(input);
    const expected = calculateRecommendationConfidence(plan.missingData, plan.warnings, plan.contraindications);
    expect(plan.confidence).toBe(expected);
  });
});

describe("treatment-plan-engine: domain rules", () => {
  it("selects protein reconstruction and forbids heat styling for fragile/breakage hair", () => {
    const plan = generateTreatmentPlan({ ...BASE_INPUT, goal: "treat", hairCondition: "fragile_breakage" });

    expect(plan.treatmentCategory).toBe("protein_reconstruction");
    expect(plan.contraindications.some((c) => c.toLowerCase().includes("heat"))).toBe(true);
  });

  it("prioritizes hydration-first sequencing for high porosity + damaged hair", () => {
    const plan = generateTreatmentPlan({
      ...BASE_INPUT,
      goal: "treat",
      hairCondition: "high_porosity_damaged",
      porosity: "high"
    });

    expect(plan.treatmentCategory).toBe("deep_hydration");
    expect(plan.notes?.some((n) => n.toLowerCase().includes("bond"))).toBe(true);
  });

  it("flags contraindications and a patch-test warning for a sensitive or flaking scalp", () => {
    const sensitive = generateTreatmentPlan({ ...BASE_INPUT, goal: "treat", scalpCondition: "sensitive" });
    expect(sensitive.contraindications.length).toBeGreaterThan(0);
    expect(sensitive.warnings.some((w) => w.toLowerCase().includes("patch test"))).toBe(true);

    const flaking = generateTreatmentPlan({ ...BASE_INPUT, goal: "treat", scalpCondition: "flaking" });
    expect(flaking.contraindications.length).toBeGreaterThan(0);
  });

  it("sequences post-color recovery to start 3-7 days after the chemical service", () => {
    const plan = generateTreatmentPlan({
      ...BASE_INPUT,
      goal: "treat",
      treatmentGoalDetail: "post_color_recovery"
    });

    expect(plan.treatmentCategory).toBe("post_color_recovery");
    expect(plan.notes?.some((n) => n.includes("3-7 days"))).toBe(true);
  });
});

describe("treatment-plan-engine: fail-closed degradation on missing data", () => {
  it("still returns a valid, conservative plan when only the triggering goal is given", () => {
    const plan = generateTreatmentPlan({ ...BASE_INPUT, goal: "treat" });

    expect(plan.treatmentCategory).toBe("deep_hydration");
    expect(plan.missingData).toContain("hairCondition");
    expect(plan.missingData).toContain("scalpCondition");
    expect(plan.missingData).toContain("treatmentGoalDetail");
    expect(plan.assumptions.length).toBeGreaterThan(0);
    expect(plan.confidence).toBeLessThan(0.95);
  });

  it("never exceeds the shared confidence ceiling", () => {
    const plan = generateTreatmentPlan({
      ...BASE_INPUT,
      goal: "treat",
      hairCondition: "virgin_healthy",
      scalpCondition: "normal",
      treatmentGoalDetail: "hydration"
    });
    expect(plan.confidence).toBeLessThanOrEqual(0.96);
  });
});

describe("treatment-plan-engine: output completeness", () => {
  it("produces a complete, non-empty protocol and aftercare plan", () => {
    const plan = generateTreatmentPlan({ ...BASE_INPUT, goal: "treat", treatmentGoalDetail: "bonding_repair" });
    expect(plan.protocolSteps.length).toBeGreaterThan(0);
    expect(plan.aftercareSteps.length).toBeGreaterThan(0);
    expect(plan.followUpReviewWeeks).toBeGreaterThan(0);
    expect(plan.version).toBe("1.0.0-m27");
  });
});
