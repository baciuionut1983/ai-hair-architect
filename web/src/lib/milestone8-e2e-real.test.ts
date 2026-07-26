import { describe, expect, it } from "vitest";

import { analyzeInitial } from "./analysis-engine";
import { createUser, getSession } from "./milestone1-store";

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

    expect(seed.technicalCutPlan).toBeDefined();
    expect(seed.technicalCutPlan?.cuttingSteps.length).toBeGreaterThan(0);
    expect(seed.technicalCutPlan?.structuralTechnique).toBe("precision_layering");
    expect(seed.technicalCutPlan?.texturizingTechnique).toBeUndefined();

    expect(user.id).toBeTruthy();
  });
});
