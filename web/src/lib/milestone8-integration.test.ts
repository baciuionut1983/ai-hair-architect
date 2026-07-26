import { describe, expect, it } from "vitest";

import { analyzeInitial, analyzeWithClarifications } from "./analysis-engine";

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

    const record = {
      id: "m8-analysis-1",
      clientId: "m8-client-1",
      createdByUserId: "m8-user-1",
      ...initial,
      clarificationAnswers: [],
      createdAt: "2026-07-26T10:00:00.000Z",
      updatedAt: "2026-07-26T10:00:00.000Z"
    };

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

    expect(withAnswers.technicalCutPlan?.version).toBe("1.0.0-m8");
    expect(withAnswers.technicalCutPlan?.structuralTechnique).toBe("graduation");
    expect(withAnswers.technicalCutPlan?.stylistExplanation.length).toBeGreaterThan(0);
  });
});
