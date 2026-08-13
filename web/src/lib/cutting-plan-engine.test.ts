import { describe, expect, it } from "vitest";

import { generateTechnicalCutPlan, shouldGenerateTechnicalCutPlan } from "./cutting-plan-engine";

describe("cutting-plan-engine", () => {
  it("decides when to generate technical plan", () => {
    expect(
      shouldGenerateTechnicalCutPlan({
        goal: "refresh",
        hairType: "medium",
        density: "medium",
        porosity: "medium"
      })
    ).toBe(false);

    expect(
      shouldGenerateTechnicalCutPlan({
        goal: "reshape",
        hairType: "medium",
        density: "medium",
        porosity: "medium"
      })
    ).toBe(true);
  });

  it("returns deterministic technical coordinates and safety metadata", () => {
    const plan = generateTechnicalCutPlan({
      goal: "reshape",
      hairType: "fine",
      density: "low",
      porosity: "high",
      faceShape: "oval",
      headShape: "balanced",
      hairLength: "short",
      hairTexture: "curly",
      hairCondition: "fragile_breakage",
      growthPattern: "double_crown",
      targetShape: "graduated_bob"
    });

    expect(plan.structuralTechnique).toBe("graduation");
    expect(plan.cuttingTechnique).toBe("slice_cutting");
    expect(plan.texturizingTechnique).toBe("point_cutting");
    expect(plan.elevation).toBe("45_deg_graduation");
    expect(plan.guideline).toBe("multiple_reference");
    expect(plan.cuttingSteps.length).toBeGreaterThan(0);
    expect(plan.warnings.length).toBeGreaterThan(0);
    expect(plan.contraindications.length).toBeGreaterThan(0);
    expect(plan.assumptions.length).toBeGreaterThanOrEqual(0);
    expect(plan.notes?.some((note) => note.includes("point cutting"))).toBe(true);
    expect(plan.confidence).toBeLessThanOrEqual(0.96);
    expect(plan.version).toBe("1.0.0-m8");
  });

  // Regression coverage for the production complaint: real, provider-supplied
  // visual attributes must actually reach the plan and stop being reported
  // as missing/assumed -- this is the engine-side half of that fix (the
  // Gemini-side half is in image-analysis-provider-gemini.test.ts).
  it("does not flag faceShape/headShape/hairLength/growthPattern as missing, and does not fall back to their neutral assumptions, once real values are supplied", () => {
    const plan = generateTechnicalCutPlan({
      goal: "reshape",
      hairType: "medium",
      density: "medium",
      porosity: "medium",
      faceShape: "heart",
      headShape: "flat_occipital",
      hairLength: "long",
      growthPattern: "front_cowlick"
    });

    expect(plan.missingData).not.toContain("faceShape");
    expect(plan.missingData).not.toContain("headShape");
    expect(plan.missingData).not.toContain("hairLength");
    expect(plan.missingData).not.toContain("growthPattern");
    expect(plan.assumptions.some((assumption) => assumption.includes("neutral face balance"))).toBe(false);
    expect(plan.assumptions.some((assumption) => assumption.includes("balanced occipital"))).toBe(false);
    expect(plan.assumptions.some((assumption) => assumption.includes("regular growth pattern"))).toBe(false);
  });

  it("flags faceShape/headShape/hairLength/growthPattern as missing and falls back to professional assumptions -- but targetShape is always missing too, never invented, when nothing supplied it", () => {
    const plan = generateTechnicalCutPlan({
      goal: "reshape",
      hairType: "medium",
      density: "medium",
      porosity: "medium"
    });

    expect(plan.missingData).toEqual(
      expect.arrayContaining([
        "faceShape",
        "headShape",
        "hairLength",
        "hairTexture",
        "hairCondition",
        "growthPattern",
        "targetShape"
      ])
    );
    expect(plan.assumptions.some((assumption) => assumption.includes("neutral face balance"))).toBe(true);
    expect(plan.assumptions.some((assumption) => assumption.includes("balanced occipital"))).toBe(true);
    expect(plan.assumptions.some((assumption) => assumption.includes("regular growth pattern"))).toBe(true);
  });
});
