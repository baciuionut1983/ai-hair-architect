import { describe, expect, it } from "vitest";

import type { AnalysisResponse, AnalysisResultResponse, AuthSessionResponse } from "./contracts";

describe("contracts baseline", () => {
  it("supports auth session shape", () => {
    const value: AuthSessionResponse = {
      token: "token",
      user: {
        id: "1",
        email: "test@example.com",
        role: "professional",
        locale: "en",
        createdAt: new Date().toISOString()
      }
    };

    expect(value.user.email).toBe("test@example.com");
  });

  it("supports analysis response shape", () => {
    const result: AnalysisResponse = {
      analysisId: "id",
      phase: "ready",
      clarificationRound: 0,
      confidenceScore: 0.9,
      uncertaintyReasons: [],
      followUpQuestions: [],
      recommendations: ["x"],
      safetyNotes: ["y"]
    };

    expect(result.confidenceScore).toBeGreaterThan(0.5);
  });

  it("a manual analysis with no photo remains a valid AnalysisResponse without imageAssetId", () => {
    const result: AnalysisResponse = {
      analysisId: "id",
      phase: "ready",
      clarificationRound: 0,
      confidenceScore: 0.9,
      uncertaintyReasons: [],
      followUpQuestions: [],
      recommendations: ["x"],
      safetyNotes: ["y"]
    };

    expect(result.imageAssetId).toBeUndefined();
  });

  it("supports an AnalysisResponse with imageAssetId set to a real asset id or explicitly null", () => {
    const withPhoto: AnalysisResponse = {
      analysisId: "id",
      phase: "ready",
      clarificationRound: 0,
      confidenceScore: 0.9,
      uncertaintyReasons: [],
      followUpQuestions: [],
      recommendations: [],
      safetyNotes: [],
      imageAssetId: "asset-1"
    };
    const withoutPhoto: AnalysisResponse = { ...withPhoto, imageAssetId: null };

    expect(withPhoto.imageAssetId).toBe("asset-1");
    expect(withoutPhoto.imageAssetId).toBeNull();
  });

  it("AnalysisResultResponse (extends AnalysisResponse) also supports imageAssetId", () => {
    const result: AnalysisResultResponse = {
      analysisId: "id",
      clientId: "client-1",
      goal: "refresh",
      hairType: "medium",
      density: "medium",
      porosity: "low",
      phase: "ready",
      clarificationRound: 0,
      confidenceScore: 0.9,
      uncertaintyReasons: [],
      followUpQuestions: [],
      recommendations: [],
      safetyNotes: [],
      clarificationAnswers: [],
      imageAssetId: "asset-1",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    expect(result.imageAssetId).toBe("asset-1");
  });
});
