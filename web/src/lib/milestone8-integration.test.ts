import { describe, expect, it } from "vitest";

import { analyzeInitial, analyzeWithClarifications } from "./analysis-engine";
import { createAnalysis, getAnalysisById, updateAnalysis } from "./milestone1-store";

describe("milestone8 integration", () => {
  it("persists technical plan in analysis lifecycle", () => {
    const initial = analyzeInitial({
      goal: "reshape",
      hairType: "medium",
      density: "high",
      porosity: "medium",
      faceShape: "round",
      headShape: "balanced",
      hairLength: "long",
      hairTexture: "curly",
      hairCondition: "virgin_healthy",
      growthPattern: "regular",
      targetShape: "graduated_bob"
    });

    const record = createAnalysis({
      clientId: "m8-client-1",
      createdByUserId: "m8-user-1",
      goal: initial.goal,
      hairType: initial.hairType,
      density: initial.density,
      porosity: initial.porosity,
      faceShape: initial.faceShape,
      headShape: initial.headShape,
      hairLength: initial.hairLength,
      hairTexture: initial.hairTexture,
      hairCondition: initial.hairCondition,
      growthPattern: initial.growthPattern,
      targetShape: initial.targetShape,
      phase: initial.phase,
      clarificationRound: initial.clarificationRound,
      confidenceScore: initial.confidenceScore,
      uncertaintyReasons: initial.uncertaintyReasons,
      followUpQuestions: initial.followUpQuestions,
      recommendations: initial.recommendations,
      safetyNotes: initial.safetyNotes,
      technicalCutPlan: initial.technicalCutPlan,
      clarificationAnswers: []
    });

    expect(record.technicalCutPlan).toBeDefined();
    expect(record.technicalCutPlan?.structuralTechnique).toBe("graduation");
    expect(record.technicalCutPlan?.cuttingTechnique).toBe("slice_cutting");
    expect(record.technicalCutPlan?.texturizingTechnique).toBe("point_cutting");

    const withAnswers = analyzeWithClarifications(
      {
        ...record,
        clarificationAnswers: []
      },
      { answers: ["No scalp sensitivity", "Hair is healthy"] }
    );

    const updated = updateAnalysis(record.id, withAnswers);
    expect(updated?.technicalCutPlan?.version).toBe("1.0.0-m8");
    expect(updated?.technicalCutPlan?.structuralTechnique).toBe("graduation");

    const loaded = getAnalysisById(record.id);
    expect(loaded?.technicalCutPlan?.stylistExplanation.length).toBeGreaterThan(0);
  });
});
