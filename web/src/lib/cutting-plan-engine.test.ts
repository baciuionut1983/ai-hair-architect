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
});
