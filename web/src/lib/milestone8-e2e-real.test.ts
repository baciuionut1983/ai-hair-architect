import { describe, expect, it } from "vitest";

import { analyzeInitial } from "./analysis-engine";
import { createAnalysis, createClient, createUser, getClientTimelineByUser, getSession } from "./milestone1-store";

describe("milestone8 e2e real domain flow", () => {
  it("creates user and client, generates technical analysis, and surfaces consultation timeline", () => {
    const user = createUser({
      email: `m8-${Date.now()}@example.com`,
      password: "hashed-password",
      role: "professional",
      locale: "en"
    });

    const session = getSession("non-existent-token");
    expect(session).toBeNull();

    const client = createClient({
      ownerUserId: user.id,
      fullName: "Milestone Eight Client"
    });

    const seed = analyzeInitial({
      goal: "reshape",
      hairType: "coarse",
      density: "high",
      porosity: "low",
      faceShape: "heart",
      headShape: "prominent_crown",
      hairLength: "medium",
      hairTexture: "straight",
      hairCondition: "virgin_healthy",
      growthPattern: "regular",
      targetShape: "face_framing_cascade"
    });

    const analysis = createAnalysis({
      clientId: client.id,
      createdByUserId: user.id,
      goal: seed.goal,
      hairType: seed.hairType,
      density: seed.density,
      porosity: seed.porosity,
      faceShape: seed.faceShape,
      headShape: seed.headShape,
      hairLength: seed.hairLength,
      hairTexture: seed.hairTexture,
      hairCondition: seed.hairCondition,
      growthPattern: seed.growthPattern,
      targetShape: seed.targetShape,
      phase: seed.phase,
      clarificationRound: seed.clarificationRound,
      confidenceScore: seed.confidenceScore,
      uncertaintyReasons: seed.uncertaintyReasons,
      followUpQuestions: seed.followUpQuestions,
      recommendations: seed.recommendations,
      safetyNotes: seed.safetyNotes,
      technicalCutPlan: seed.technicalCutPlan,
      clarificationAnswers: []
    });

    expect(analysis.technicalCutPlan).toBeDefined();
    expect(analysis.technicalCutPlan?.cuttingSteps.length).toBeGreaterThan(0);
    expect(analysis.technicalCutPlan?.structuralTechnique).toBe("precision_layering");
    expect(analysis.technicalCutPlan?.texturizingTechnique).toBeUndefined();

    const timeline = getClientTimelineByUser(client.id, user.id);
    expect(Array.isArray(timeline)).toBe(true);
  });
});
