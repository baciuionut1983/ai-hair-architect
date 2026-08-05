import { describe, expect, it } from "vitest";

import { mapPhotoAnalysisToRequestFields } from "./photo-analysis-request-mapper";
import type { ImageAnalysisResult } from "@/lib/image-analysis-provider";

function baseResult(overrides: Partial<ImageAnalysisResult> = {}): ImageAnalysisResult {
  return {
    hairType: "wavy",
    density: "medium",
    porosity: "medium",
    faceShape: "oval",
    headShape: "balanced",
    hairLength: "medium",
    hairTexture: "some freeform description",
    hairCondition: "virgin_healthy",
    growthPattern: "regular",
    targetShape: "long_layers",
    ...overrides
  };
}

describe("mapPhotoAnalysisToRequestFields", () => {
  it("maps ImageAnalysisResult.hairType (texture-shaped) to hairTexture, never to hairType", () => {
    const result = mapPhotoAnalysisToRequestFields(baseResult({ hairType: "curly" }));

    expect(result.hairTexture).toBe("curly");
    expect(result).not.toHaveProperty("hairType");
  });

  it("maps valid density/porosity through unchanged", () => {
    const result = mapPhotoAnalysisToRequestFields(baseResult({ density: "high", porosity: "low" }));

    expect(result.density).toBe("high");
    expect(result.porosity).toBe("low");
  });

  it("drops density/porosity to undefined when the AI reports unknown, rather than guessing", () => {
    const result = mapPhotoAnalysisToRequestFields(baseResult({ density: "unknown", porosity: "unknown" }));

    expect(result.density).toBeUndefined();
    expect(result.porosity).toBeUndefined();
  });

  it("drops hairTexture to undefined when the AI reports unknown", () => {
    const result = mapPhotoAnalysisToRequestFields(baseResult({ hairType: "unknown" }));

    expect(result.hairTexture).toBeUndefined();
  });

  it("maps every valid optional enum field through when present and recognized", () => {
    const result = mapPhotoAnalysisToRequestFields(baseResult());

    expect(result).toMatchObject({
      faceShape: "oval",
      headShape: "balanced",
      hairLength: "medium",
      hairCondition: "virgin_healthy",
      growthPattern: "regular",
      targetShape: "long_layers"
    });
  });

  it("drops any field the AI returns that is not a recognized enum value, never passing free text through", () => {
    const result = mapPhotoAnalysisToRequestFields(
      baseResult({
        faceShape: "some free-text description the model invented",
        headShape: "not a real head shape",
        hairLength: "very very long",
        hairCondition: "looks a bit dry maybe",
        growthPattern: "unclear",
        targetShape: "something trendy"
      })
    );

    expect(result.faceShape).toBeUndefined();
    expect(result.headShape).toBeUndefined();
    expect(result.hairLength).toBeUndefined();
    expect(result.hairCondition).toBeUndefined();
    expect(result.growthPattern).toBeUndefined();
    expect(result.targetShape).toBeUndefined();
  });

  it("drops null fields to undefined", () => {
    const result = mapPhotoAnalysisToRequestFields(
      baseResult({ faceShape: null, headShape: null, hairLength: null, hairCondition: null, growthPattern: null, targetShape: null })
    );

    expect(result.faceShape).toBeUndefined();
    expect(result.headShape).toBeUndefined();
    expect(result.hairLength).toBeUndefined();
    expect(result.hairCondition).toBeUndefined();
    expect(result.growthPattern).toBeUndefined();
    expect(result.targetShape).toBeUndefined();
  });
});
