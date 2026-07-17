import { describe, expect, it } from "vitest";

import { analyzeInitial, analyzeWithClarifications } from "./analysis-engine";

describe("analysis-engine", () => {
  it("returns pending questions for risky inputs", () => {
    const result = analyzeInitial({
      goal: "lighten",
      hairType: "fine",
      density: "low",
      porosity: "high"
    });

    expect(result.phase).toBe("pending_questions");
    expect(result.followUpQuestions.length).toBeGreaterThan(0);
  });

  it("promotes to ready after clarifications", () => {
    const initial = analyzeInitial({
      goal: "lighten",
      hairType: "fine",
      density: "medium",
      porosity: "high"
    });

    const updated = analyzeWithClarifications(
      {
        id: "a1",
        clientId: "c1",
        createdByUserId: "u1",
        clarificationAnswers: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        ...initial
      },
      { answers: ["No bleaching recently", "Hair is healthy"] }
    );

    expect(updated.confidenceScore).toBeGreaterThan(initial.confidenceScore);
    expect(["pending_questions", "ready"]).toContain(updated.phase);
  });

  it("builds deterministic technical plan for reshape goals", () => {
    const result = analyzeInitial({
      goal: "reshape",
      hairType: "medium",
      density: "high",
      porosity: "low",
      faceShape: "round",
      headShape: "balanced",
      hairLength: "medium",
      hairTexture: "curly",
      hairCondition: "virgin_healthy",
      growthPattern: "regular",
      targetShape: "graduated_bob"
    });

    expect(result.technicalCutPlan).toBeDefined();
    expect(result.technicalCutPlan?.cuttingSteps.length).toBeGreaterThan(0);
    expect(result.technicalCutPlan?.structuralTechnique).toBe("graduation");
    expect(result.technicalCutPlan?.cuttingTechnique).toBe("slice_cutting");
    expect(result.technicalCutPlan?.texturizingTechnique).toBe("point_cutting");
    expect(result.technicalCutPlan?.confidence).toBeGreaterThanOrEqual(0.58);
    expect(result.technicalCutPlan?.stylistValidationDisclaimer.length).toBeGreaterThan(0);
    expect(result.recommendations[0]).toContain("Structural technique");
    expect(result.technicalCutPlan?.professionalReason).toContain("Graduation");
    expect(result.technicalCutPlan?.professionalReason).toContain("Point-cut");
  });
});
