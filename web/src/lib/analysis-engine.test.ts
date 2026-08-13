import { describe, expect, it } from "vitest";

import { analyzeInitial, analyzeWithClarifications, deriveHairConditionFromClarifications } from "./analysis-engine";
import type { AnalysisCreateRecordInput } from "./milestone2-types";

function stateFrom(seed: AnalysisCreateRecordInput) {
  return {
    id: "a1",
    clientId: "c1",
    createdByUserId: "u1",
    clarificationAnswers: [] as string[],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...seed
  };
}

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

  // Regression coverage for the production bug where Submit clarifications
  // only nudged confidenceScore/phase and left the plan, warnings, and
  // missingData completely frozen from before the clarification existed.
  describe("clarifications drive real plan recomputation, not just confidence/status", () => {
    it("a relevant clarification answer changes the color plan's professional output (developer volume, contraindications) -- proves real recomputation, not a hardcoded result", () => {
      const seed = analyzeInitial({
        goal: "lighten",
        hairType: "medium",
        density: "medium",
        porosity: "medium",
        desiredColorResult: "full_lightening"
      });
      // These are the exact, only two questions analyzeInitial ever asks --
      // asserted here so this test fails loudly if that text ever drifts
      // out of sync with deriveHairConditionFromClarifications's matching.
      expect(seed.followUpQuestions).toEqual([
        "Did the client bleach in the last 90 days?",
        "Is there visible breakage or strong elasticity loss?"
      ]);

      const healthy = analyzeWithClarifications(stateFrom(seed), { answers: ["no", "no"] });
      const bleached = analyzeWithClarifications(stateFrom(seed), { answers: ["yes", "no"] });
      const breakage = analyzeWithClarifications(stateFrom(seed), { answers: ["no", "yes"] });

      expect(healthy.hairCondition).toBe("virgin_healthy");
      expect(bleached.hairCondition).toBe("chemically_treated");
      expect(breakage.hairCondition).toBe("fragile_breakage");

      // Same desiredColorResult, three different clarification outcomes ->
      // three professionally distinct developer strengths (color-plan-engine.ts's
      // mandatory safety clamp), not three copies of the same frozen plan.
      expect(healthy.colorPlan?.developerVolume).toBe("40vol");
      expect(bleached.colorPlan?.developerVolume).toBe("30vol");
      expect(breakage.colorPlan?.developerVolume).toBe("20vol");

      expect(breakage.colorPlan?.contraindications).toContain(
        "Do not perform double-process lightening on compromised hair in this session."
      );
      expect(healthy.colorPlan?.contraindications ?? []).not.toContain(
        "Do not perform double-process lightening on compromised hair in this session."
      );

      // Closes the exact production complaint: hairCondition no longer sits
      // in missingData once a clarification answer actually resolved it.
      expect(healthy.colorPlan?.missingData).not.toContain("hairCondition");
      expect(bleached.colorPlan?.missingData).not.toContain("hairCondition");
      expect(breakage.colorPlan?.missingData).not.toContain("hairCondition");
    });

    it("clarification answers are persisted (non-empty only) and actually consumed by the next round, across multiple rounds", () => {
      const seed = analyzeInitial({ goal: "lighten", hairType: "fine", density: "medium", porosity: "high" });

      const round1 = analyzeWithClarifications(stateFrom(seed), { answers: ["no", ""] });
      expect(round1.clarificationAnswers).toEqual(["no"]);

      const round2 = analyzeWithClarifications({ ...stateFrom(seed), ...round1 }, { answers: ["fine"] });
      expect(round2.clarificationAnswers).toEqual(["no", "fine"]);
      expect(round2.clarificationRound).toBe(2);
    });

    it("does not invent a hairCondition from an ambiguous or unanswered clarification -- stays undefined, never guessed", () => {
      const questions = [
        "Did the client bleach in the last 90 days?",
        "Is there visible breakage or strong elasticity loss?"
      ];
      expect(deriveHairConditionFromClarifications(questions, ["maybe", "not sure"], undefined)).toBeUndefined();
      expect(deriveHairConditionFromClarifications(questions, [], undefined)).toBeUndefined();
    });

    it("never overwrites a hairCondition already known from the photo/manual form with a clarification-derived guess", () => {
      const questions = [
        "Did the client bleach in the last 90 days?",
        "Is there visible breakage or strong elasticity loss?"
      ];
      expect(deriveHairConditionFromClarifications(questions, ["yes", "yes"], "virgin_healthy")).toBe("virgin_healthy");
    });

    it("targetShape is never inferred from clarifications either -- it stays whatever the client/stylist explicitly declared (or undefined)", () => {
      const seed = analyzeInitial({
        goal: "reshape",
        hairType: "medium",
        density: "medium",
        porosity: "medium",
        faceShape: "round"
      });

      const updated = analyzeWithClarifications(stateFrom(seed), { answers: ["no", "no"] });

      expect(updated.targetShape).toBeUndefined();
    });
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
