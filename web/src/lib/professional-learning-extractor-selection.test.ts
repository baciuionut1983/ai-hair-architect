import { describe, expect, it } from "vitest";

import {
  isProfessionalLearningExtractorProviderError,
  ProfessionalLearningExtractorSelectionError,
  professionalLearningExtractorProviderErrorHttpStatus,
  selectProfessionalLearningExtractor,
} from "@/lib/professional-learning-extractor-selection";
import { GeminiProfessionalLearningExtractor } from "@/lib/professional-learning-extractor-gemini";
import { mockProfessionalLearningExtractor } from "@/lib/professional-learning-mock-extractor";

// AI Hair Architect, Professional Skill Engine Stage 8.5T1.1 -- pure
// tests for provider selection. ZERO real network calls anywhere in this
// file: constructing GeminiProfessionalLearningExtractor with a fake key
// never contacts Gemini (only extract() does, and it is never called
// here) -- mirrors professional-learning-extractor-gemini.test.ts's own
// "requires an apiKey and model at construction" test, which does the
// same thing.

const REAL_ANALYSIS_ENV = { AI_ANALYSIS_PROVIDER: "gemini", AI_ANALYSIS_API_KEY: "fake-test-key-never-a-real-secret", AI_ANALYSIS_MODEL: "gemini-3.6-flash" };

describe("selectProfessionalLearningExtractor -- fail-closed provider selection", () => {
  it("selects the mock extractor when PROFESSIONAL_LEARNING_REAL_EXTRACTION_ENABLED is unset (the safe default)", () => {
    const extractor = selectProfessionalLearningExtractor({});
    expect(extractor).toBe(mockProfessionalLearningExtractor);
  });

  it("selects the mock extractor when the flag is explicitly false", () => {
    const extractor = selectProfessionalLearningExtractor({ PROFESSIONAL_LEARNING_REAL_EXTRACTION_ENABLED: "false", ...REAL_ANALYSIS_ENV });
    expect(extractor).toBe(mockProfessionalLearningExtractor);
  });

  it("selects the real Gemini extractor when the flag is 'true' and AI_ANALYSIS_* is valid", () => {
    const extractor = selectProfessionalLearningExtractor({ PROFESSIONAL_LEARNING_REAL_EXTRACTION_ENABLED: "true", ...REAL_ANALYSIS_ENV });
    expect(extractor).toBeInstanceOf(GeminiProfessionalLearningExtractor);
    expect(extractor.extractorVersion).toBe("gemini-real-v2:gemini-3.6-flash");
  });

  it("FAILS CLOSED: throws ProfessionalLearningExtractorSelectionError (never silently falls back to mock) when the flag is enabled but AI_ANALYSIS_* is not configured", () => {
    expect(() => selectProfessionalLearningExtractor({ PROFESSIONAL_LEARNING_REAL_EXTRACTION_ENABLED: "true" })).toThrow(ProfessionalLearningExtractorSelectionError);
  });

  it("the selection-error message is the resolver's own plain structural reason -- never an API key or provider secret", () => {
    try {
      // A deliberately secret-shaped (but fake) API key value: proves the
      // resolver's own structural reason text is used, never a value
      // interpolated from the environment.
      selectProfessionalLearningExtractor({ PROFESSIONAL_LEARNING_REAL_EXTRACTION_ENABLED: "true", AI_ANALYSIS_API_KEY: "AIzaFakeSecretShapedTestValueNeverReal12345" });
      throw new Error("expected to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ProfessionalLearningExtractorSelectionError);
      expect((error as Error).message).not.toContain("AIzaFakeSecretShapedTestValueNeverReal12345");
      expect((error as Error).message).toContain("AI_ANALYSIS_PROVIDER is not configured");
    }
  });

  it("ProfessionalLearningExtractorSelectionError carries httpStatus 503", () => {
    const error = new ProfessionalLearningExtractorSelectionError("test reason");
    expect(error.httpStatus).toBe(503);
    expect(error.code).toBe("REAL_EXTRACTION_MISCONFIGURED");
  });
});

describe("isProfessionalLearningExtractorProviderError / professionalLearningExtractorProviderErrorHttpStatus", () => {
  it("recognizes every real provider error code the Gemini adapter actually throws", () => {
    for (const code of ["TIMEOUT", "RATE_LIMITED", "INVALID_RESPONSE", "PROVIDER_ERROR", "NOT_CONFIGURED"]) {
      const error = Object.assign(new Error("provider failed"), { code, retryable: false });
      expect(isProfessionalLearningExtractorProviderError(error)).toBe(true);
    }
  });

  it("rejects a plain Error with no recognized code", () => {
    expect(isProfessionalLearningExtractorProviderError(new Error("something else"))).toBe(false);
    expect(isProfessionalLearningExtractorProviderError(Object.assign(new Error("x"), { code: "SOME_UNRELATED_CODE" }))).toBe(false);
  });

  it("rejects a non-Error value", () => {
    expect(isProfessionalLearningExtractorProviderError({ code: "TIMEOUT" })).toBe(false);
    expect(isProfessionalLearningExtractorProviderError(null)).toBe(false);
  });

  it("maps each code to the expected HTTP status", () => {
    const cases: [string, number][] = [
      ["TIMEOUT", 504],
      ["RATE_LIMITED", 429],
      ["NOT_CONFIGURED", 503],
      ["PROVIDER_ERROR", 502],
      ["INVALID_RESPONSE", 502],
    ];
    for (const [code, expected] of cases) {
      expect(professionalLearningExtractorProviderErrorHttpStatus({ code } as never)).toBe(expected);
    }
  });
});
