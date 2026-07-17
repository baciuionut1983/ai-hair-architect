import { afterEach, describe, expect, it, vi } from "vitest";

const prismaMocks = vi.hoisted(() => ({
  upsert: vi.fn(),
  findFirst: vi.fn()
}));

vi.mock("./prisma", () => ({
  isDatabaseConfigured: () => true,
  prisma: {
    analysis: {
      upsert: prismaMocks.upsert,
      findFirst: prismaMocks.findFirst
    }
  }
}));

import { findPersistedAnalysisById, upsertPersistedAnalysis } from "./analysis-persistence";

afterEach(() => {
  prismaMocks.upsert.mockReset();
  prismaMocks.findFirst.mockReset();
});

describe("analysis-persistence", () => {
  it("saves technical plans with client and owner ownership", async () => {
    await upsertPersistedAnalysis({
      id: "analysis-1",
      clientId: "client-1",
      ownerUserId: "owner-1",
      goal: "reshape",
      hairType: "medium",
      density: "high",
      porosity: "low",
      phase: "ready",
      clarificationRound: 0,
      confidenceScore: 0.9,
      uncertaintyReasons: ["one"],
      followUpQuestions: ["two"],
      recommendations: ["three"],
      safetyNotes: ["four"],
      faceShape: "round",
      headShape: "balanced",
      hairLength: "medium",
      hairTexture: "curly",
      hairCondition: "virgin_healthy",
      growthPattern: "regular",
      targetShape: "graduated_bob",
      technicalCutPlan: {
        structuralTechnique: "graduation",
        cuttingTechnique: "slice_cutting",
        texturizingTechnique: "point_cutting",
        sectioning: "diagonal_back",
        elevation: "45_deg_graduation",
        distribution: "overdirected_back",
        guideline: "stationary",
        cuttingSteps: [],
        stylistExplanation: "x",
        clientExplanation: "y",
        professionalReason: "z",
        warnings: [],
        contraindications: [],
        assumptions: [],
        missingData: [],
        confidence: 0.9,
        stylistValidationDisclaimer: "validate",
        version: "1.0.0-m8"
      },
      clarificationAnswers: ["ok"],
      createdAt: "2026-07-17T10:00:00.000Z",
      updatedAt: "2026-07-17T10:00:00.000Z"
    });

    expect(prismaMocks.upsert).toHaveBeenCalledTimes(1);
    expect(prismaMocks.upsert.mock.calls[0][0].create.clientId).toBe("client-1");
    expect(prismaMocks.upsert.mock.calls[0][0].create.technicalCutPlan).toBeTruthy();
  });

  it("reads owned analyses and rejects foreign ownership", async () => {
    prismaMocks.findFirst.mockResolvedValueOnce({
      id: "analysis-1",
      clientId: "client-1",
      ownerUserId: "owner-1",
      goal: "reshape",
      hairType: "medium",
      density: "high",
      porosity: "low",
      phase: "ready",
      clarificationRound: 0,
      confidenceScore: 0.9,
      uncertaintyReasons: [],
      followUpQuestions: [],
      recommendations: [],
      safetyNotes: [],
      faceShape: null,
      headShape: null,
      hairLength: null,
      hairTexture: null,
      hairCondition: null,
      growthPattern: null,
      targetShape: null,
      technicalCutPlan: null,
      clarificationAnswers: [],
      createdAt: new Date("2026-07-17T10:00:00.000Z"),
      updatedAt: new Date("2026-07-17T10:00:00.000Z")
    });

    const owned = await findPersistedAnalysisById("analysis-1", "owner-1");
    expect(owned?.clientId).toBe("client-1");

    prismaMocks.findFirst.mockResolvedValueOnce(null);
    const foreign = await findPersistedAnalysisById("analysis-1", "foreign-owner");
    expect(foreign).toBeNull();
  });
});
