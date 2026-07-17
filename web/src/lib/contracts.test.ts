import { describe, expect, it } from "vitest";

import type { AnalysisResponse, AuthSessionResponse } from "./contracts";

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
});
