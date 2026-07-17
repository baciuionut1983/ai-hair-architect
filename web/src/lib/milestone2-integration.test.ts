import { describe, expect, it } from "vitest";

import { analyzeInitial, analyzeWithClarifications } from "./analysis-engine";

describe("milestone2 integration behavior", () => {
  it("starts in pending phase for risky profile and may become ready after clarification", () => {
    const start = analyzeInitial({
      goal: "lighten",
      hairType: "fine",
      density: "low",
      porosity: "high"
    });

    expect(start.phase).toBe("pending_questions");

    const updated = analyzeWithClarifications(
      {
        id: "analysis-1",
        clientId: "client-1",
        createdByUserId: "user-1",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        clarificationAnswers: [],
        ...start
      },
      {
        answers: ["No bleaching recently", "Hair looks healthy"]
      }
    );

    expect(updated.confidenceScore).toBeGreaterThan(start.confidenceScore);
    expect(["pending_questions", "ready"]).toContain(updated.phase);
  });

  it("starts ready for low-risk profile", () => {
    const start = analyzeInitial({
      goal: "refresh",
      hairType: "medium",
      density: "medium",
      porosity: "low"
    });

    expect(start.phase).toBe("ready");
    expect(start.followUpQuestions).toHaveLength(0);
  });
});
