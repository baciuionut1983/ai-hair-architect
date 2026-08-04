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

  it("builds a color plan for color goals and carries it through clarifications unchanged", () => {
    const result = analyzeInitial({
      goal: "cover",
      hairType: "medium",
      density: "medium",
      porosity: "medium",
      desiredColorResult: "gray_coverage",
      grayPercentage: "medium"
    });

    expect(result.colorPlan).toBeDefined();
    expect(result.technicalCutPlan).toBeUndefined();
    expect(result.treatmentPlan).toBeUndefined();
    expect(result.recommendations[0]).toContain("Color direction");

    const updated = analyzeWithClarifications(
      {
        id: "a1",
        clientId: "c1",
        createdByUserId: "u1",
        clarificationAnswers: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        ...result
      },
      { answers: ["Hair is healthy"] }
    );

    expect(updated.colorPlan).toEqual(result.colorPlan);
  });

  it("builds a treatment plan for the treat goal and carries it through clarifications unchanged", () => {
    const result = analyzeInitial({
      goal: "treat",
      hairType: "medium",
      density: "medium",
      porosity: "medium",
      hairCondition: "fragile_breakage"
    });

    expect(result.treatmentPlan).toBeDefined();
    expect(result.treatmentPlan?.treatmentCategory).toBe("protein_reconstruction");
    expect(result.recommendations.some((line) => line.includes("Treatment category"))).toBe(true);

    const updated = analyzeWithClarifications(
      {
        id: "a1",
        clientId: "c1",
        createdByUserId: "u1",
        clarificationAnswers: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        ...result
      },
      { answers: ["No recent bleaching"] }
    );

    expect(updated.treatmentPlan).toEqual(result.treatmentPlan);
  });

  it("keeps recommendations[0] as the haircut summary when haircut and color both fire", () => {
    const result = analyzeInitial({
      goal: "reshape",
      hairType: "medium",
      density: "medium",
      porosity: "medium",
      targetShape: "graduated_bob",
      desiredColorResult: "gloss_refresh"
    });

    expect(result.technicalCutPlan).toBeDefined();
    expect(result.colorPlan).toBeDefined();
    expect(result.recommendations[0]).toContain("Structural technique");
    expect(result.recommendations.some((line) => line.includes("Color direction"))).toBe(true);
  });

  it("never auto-generates a treatment plan just because a color plan warns about compromised hair", () => {
    const result = analyzeInitial({
      goal: "lighten",
      hairType: "medium",
      density: "medium",
      porosity: "medium",
      hairCondition: "fragile_breakage",
      desiredColorResult: "full_lightening"
    });

    expect(result.colorPlan).toBeDefined();
    expect(result.colorPlan?.warnings.some((w) => w.toLowerCase().includes("treatment"))).toBe(true);
    expect(result.treatmentPlan).toBeUndefined();
  });

  it("falls back to the generic recommendations when no domain engine fires", () => {
    const result = analyzeInitial({
      goal: "refresh",
      hairType: "medium",
      density: "medium",
      porosity: "medium"
    });

    expect(result.technicalCutPlan).toBeUndefined();
    expect(result.colorPlan).toBeUndefined();
    expect(result.treatmentPlan).toBeUndefined();
    expect(result.recommendations).toEqual([
      "Use conservative formula strategy and document service context.",
      "Save follow-up protocol in client timeline for safer next visit."
    ]);
    expect(result.safetyNotes).toEqual(["Perform strand test before high-lift or correction services."]);
  });
});
