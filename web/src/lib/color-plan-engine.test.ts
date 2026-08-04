import { describe, expect, it } from "vitest";

import type { HairCondition } from "./contracts";
import { generateColorPlan, shouldGenerateColorPlan, type ColorEngineInput } from "./color-plan-engine";
import { calculateRecommendationConfidence } from "./recommendation-engine-shared";

const BASE_INPUT: ColorEngineInput = {
  goal: "refresh",
  hairType: "medium",
  density: "medium",
  porosity: "medium"
};

describe("color-plan-engine: shouldGenerateColorPlan", () => {
  it("does not fire for goals unrelated to color with no color signal", () => {
    expect(shouldGenerateColorPlan({ ...BASE_INPUT, goal: "refresh" })).toBe(false);
    expect(shouldGenerateColorPlan({ ...BASE_INPUT, goal: "reshape" })).toBe(false);
    expect(shouldGenerateColorPlan({ ...BASE_INPUT, goal: "treat" })).toBe(false);
    expect(shouldGenerateColorPlan({ ...BASE_INPUT, goal: "correct" })).toBe(false);
  });

  it("fires for the unambiguous color goals", () => {
    expect(shouldGenerateColorPlan({ ...BASE_INPUT, goal: "cover" })).toBe(true);
    expect(shouldGenerateColorPlan({ ...BASE_INPUT, goal: "lighten" })).toBe(true);
  });

  it("fires on an explicit color signal even when the goal is ambiguous", () => {
    expect(
      shouldGenerateColorPlan({ ...BASE_INPUT, goal: "refresh", desiredColorResult: "gloss_refresh" })
    ).toBe(true);
    expect(shouldGenerateColorPlan({ ...BASE_INPUT, goal: "correct", grayPercentage: "high" })).toBe(true);
  });
});

describe("color-plan-engine: determinism", () => {
  it("returns identical output for identical input (pure function)", () => {
    const input: ColorEngineInput = {
      ...BASE_INPUT,
      goal: "cover",
      hairCondition: "virgin_healthy",
      desiredColorResult: "gray_coverage",
      grayPercentage: "medium"
    };

    expect(generateColorPlan(input)).toEqual(generateColorPlan({ ...input }));
  });

  it("reuses the shared confidence formula verbatim, not a reimplementation", () => {
    const input: ColorEngineInput = {
      ...BASE_INPUT,
      goal: "cover",
      hairCondition: "virgin_healthy",
      desiredColorResult: "gray_coverage",
      grayPercentage: "low"
    };

    const plan = generateColorPlan(input);
    const expected = calculateRecommendationConfidence(plan.missingData, plan.warnings, plan.contraindications);
    expect(plan.confidence).toBe(expected);
  });
});

describe("color-plan-engine: 40vol safety constraint (hard requirement)", () => {
  const riskyConditions: HairCondition[] = ["fragile_breakage", "high_porosity_damaged", "chemically_treated"];

  it.each(riskyConditions)("never recommends 40vol for full lightening on %s hair", (hairCondition) => {
    const plan = generateColorPlan({
      ...BASE_INPUT,
      goal: "lighten",
      hairCondition,
      desiredColorResult: "full_lightening",
      porosity: "low"
    });

    expect(plan.developerVolume).not.toBe("40vol");
  });

  it("never recommends 40vol when hair condition is unknown", () => {
    const plan = generateColorPlan({
      ...BASE_INPUT,
      goal: "lighten",
      desiredColorResult: "full_lightening"
    });

    expect(plan.developerVolume).not.toBe("40vol");
  });

  it("never recommends 40vol when porosity is high, even on otherwise healthy hair", () => {
    const plan = generateColorPlan({
      ...BASE_INPUT,
      goal: "lighten",
      hairCondition: "virgin_healthy",
      porosity: "high",
      desiredColorResult: "full_lightening"
    });

    expect(plan.developerVolume).not.toBe("40vol");
  });

  it("permits 40vol only for the narrow safe case: virgin healthy hair, non-high porosity, full lightening", () => {
    const plan = generateColorPlan({
      ...BASE_INPUT,
      goal: "lighten",
      hairCondition: "virgin_healthy",
      porosity: "medium",
      desiredColorResult: "full_lightening"
    });

    expect(plan.developerVolume).toBe("40vol");
  });

  it("flags a contraindication and recommends Treatment-first for compromised hair requesting full lightening", () => {
    const plan = generateColorPlan({
      ...BASE_INPUT,
      goal: "lighten",
      hairCondition: "fragile_breakage",
      desiredColorResult: "full_lightening"
    });

    expect(plan.contraindications.length).toBeGreaterThan(0);
    expect(plan.warnings.some((w) => w.toLowerCase().includes("treatment"))).toBe(true);
  });
});

describe("color-plan-engine: strandTestRequired derivation", () => {
  it("requires a strand test when hair condition is unknown", () => {
    const plan = generateColorPlan({ ...BASE_INPUT, goal: "cover", desiredColorResult: "gray_coverage" });
    expect(plan.strandTestRequired).toBe(true);
  });

  it("requires a strand test for full lightening", () => {
    const plan = generateColorPlan({
      ...BASE_INPUT,
      goal: "lighten",
      hairCondition: "virgin_healthy",
      desiredColorResult: "full_lightening"
    });
    expect(plan.strandTestRequired).toBe(true);
  });

  it("does not require a strand test for the safest baseline (gloss refresh, virgin healthy, non-high porosity)", () => {
    const plan = generateColorPlan({
      ...BASE_INPUT,
      goal: "refresh",
      hairCondition: "virgin_healthy",
      porosity: "medium",
      desiredColorResult: "gloss_refresh"
    });
    expect(plan.strandTestRequired).toBe(false);
  });
});

describe("color-plan-engine: fail-closed degradation on missing data", () => {
  it("still returns a valid, conservative plan when no color-specific input is given beyond the triggering goal", () => {
    const plan = generateColorPlan({ ...BASE_INPUT, goal: "cover" });

    expect(plan.formulaDirection).toBe("gloss_demi_permanent");
    expect(plan.developerVolume).toBe("10vol");
    expect(plan.missingData).toContain("desiredColorResult");
    expect(plan.missingData).toContain("hairCondition");
    expect(plan.assumptions.length).toBeGreaterThan(0);
    expect(plan.confidence).toBeLessThan(0.95);
  });

  it("never exceeds the shared confidence ceiling", () => {
    const plan = generateColorPlan({
      ...BASE_INPUT,
      goal: "cover",
      hairCondition: "virgin_healthy",
      desiredColorResult: "gray_coverage",
      grayPercentage: "low"
    });
    expect(plan.confidence).toBeLessThanOrEqual(0.96);
  });
});

describe("color-plan-engine: output completeness and disclaimers", () => {
  it("always differentiates professional direction from a guaranteed salon formula via the disclaimer", () => {
    const plan = generateColorPlan({ ...BASE_INPUT, goal: "cover", desiredColorResult: "gray_coverage" });
    expect(plan.stylistValidationDisclaimer.toLowerCase()).toContain("not an exact salon formula");
  });

  it("produces a complete, non-empty processing plan and maintenance plan", () => {
    const plan = generateColorPlan({ ...BASE_INPUT, goal: "lighten", desiredColorResult: "balayage_highlights" });
    expect(plan.processingSteps.length).toBeGreaterThan(0);
    expect(plan.maintenancePlan.length).toBeGreaterThan(0);
    expect(plan.version).toBe("1.0.0-m27");
  });
});
