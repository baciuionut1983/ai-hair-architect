import { describe, expect, it } from "vitest";

import { resolveRealProfessionalLearningExtractionConfig } from "./professional-learning-real-extraction-config";

describe("resolveRealProfessionalLearningExtractionConfig (Stage 8.5L4.R1 safe default)", () => {
  it("is disabled when the flag is unset -- real extraction never runs by accident", () => {
    expect(resolveRealProfessionalLearningExtractionConfig({})).toEqual({ status: "disabled" });
  });

  it("is disabled for any value of the flag other than the exact string 'true'", () => {
    for (const value of ["1", "yes", "TRUE ", "enabled", ""]) {
      const result = resolveRealProfessionalLearningExtractionConfig({ PROFESSIONAL_LEARNING_REAL_EXTRACTION_ENABLED: value });
      if (value.trim().toLowerCase() === "true") continue;
      expect(result.status).toBe("disabled");
    }
  });

  it("accepts 'true' case-insensitively, trimmed", () => {
    const env = { PROFESSIONAL_LEARNING_REAL_EXTRACTION_ENABLED: " TRUE ", AI_ANALYSIS_PROVIDER: "gemini", AI_ANALYSIS_API_KEY: "k", AI_ANALYSIS_MODEL: "gemini-3.6-flash" };
    expect(resolveRealProfessionalLearningExtractionConfig(env)).toEqual({ status: "enabled", apiKey: "k", model: "gemini-3.6-flash", timeoutMs: expect.any(Number) });
  });

  it("is invalid when the flag is true but AI_ANALYSIS_PROVIDER is not configured -- never falls back to a different vendor", () => {
    const result = resolveRealProfessionalLearningExtractionConfig({ PROFESSIONAL_LEARNING_REAL_EXTRACTION_ENABLED: "true" });
    expect(result.status).toBe("invalid");
  });

  it("is invalid when the flag is true but the existing AI_ANALYSIS_* config is itself invalid", () => {
    const result = resolveRealProfessionalLearningExtractionConfig({ PROFESSIONAL_LEARNING_REAL_EXTRACTION_ENABLED: "true", AI_ANALYSIS_PROVIDER: "gemini" });
    expect(result.status).toBe("invalid");
  });

  it("is enabled only when both the flag and the reused AI_ANALYSIS_* config are valid", () => {
    const result = resolveRealProfessionalLearningExtractionConfig({
      PROFESSIONAL_LEARNING_REAL_EXTRACTION_ENABLED: "true",
      AI_ANALYSIS_PROVIDER: "gemini",
      AI_ANALYSIS_API_KEY: "real-key",
      AI_ANALYSIS_MODEL: "gemini-3.6-flash",
    });
    expect(result).toEqual({ status: "enabled", apiKey: "real-key", model: "gemini-3.6-flash", timeoutMs: expect.any(Number) });
  });
});
