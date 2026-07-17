import { describe, expect, it } from "vitest";

import { createAnalysis, getAnalysisById, updateAnalysis } from "./milestone1-store";

describe("milestone2 store analysis lifecycle", () => {
  it("creates and updates analysis records", () => {
    const analysis = createAnalysis({
      clientId: "client-1",
      createdByUserId: "user-1",
      goal: "refresh",
      hairType: "medium",
      density: "medium",
      porosity: "low",
      phase: "ready",
      clarificationRound: 0,
      confidenceScore: 0.88,
      uncertaintyReasons: [],
      followUpQuestions: [],
      recommendations: ["x"],
      safetyNotes: ["y"],
      clarificationAnswers: []
    });

    const loaded = getAnalysisById(analysis.id);
    expect(loaded?.id).toBe(analysis.id);

    const updated = updateAnalysis(analysis.id, { phase: "pending_questions" });
    expect(updated?.phase).toBe("pending_questions");
  });
});
