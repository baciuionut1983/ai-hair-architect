import { describe, expect, it } from "vitest";

import { resolveImageAnalysisProviderConfig } from "./image-analysis-provider-config";

describe("resolveImageAnalysisProviderConfig", () => {
  it("is disabled when AI_ANALYSIS_PROVIDER is unset", () => {
    expect(resolveImageAnalysisProviderConfig({})).toEqual({ status: "disabled" });
  });

  it("is disabled when AI_ANALYSIS_PROVIDER is an empty/whitespace string", () => {
    expect(resolveImageAnalysisProviderConfig({ AI_ANALYSIS_PROVIDER: "   " })).toEqual({ status: "disabled" });
  });

  it("fails closed as invalid for an unrecognized provider, never falling back to gemini or mock", () => {
    const result = resolveImageAnalysisProviderConfig({
      AI_ANALYSIS_PROVIDER: "openai",
      AI_ANALYSIS_API_KEY: "key",
      AI_ANALYSIS_MODEL: "gpt-x",
    });
    expect(result.status).toBe("invalid");
    if (result.status === "invalid") {
      expect(result.issues).toEqual([
        {
          code: "AI_ANALYSIS_PROVIDER_INVALID",
          variable: "AI_ANALYSIS_PROVIDER",
          message: "AI_ANALYSIS_PROVIDER must be one of: gemini.",
        },
      ]);
    }
  });

  it("fails closed as invalid when the api key is missing", () => {
    const result = resolveImageAnalysisProviderConfig({
      AI_ANALYSIS_PROVIDER: "gemini",
      AI_ANALYSIS_MODEL: "gemini-3.6-flash",
    });
    expect(result.status).toBe("invalid");
    if (result.status === "invalid") {
      expect(result.issues).toEqual([
        {
          code: "AI_ANALYSIS_API_KEY_REQUIRED",
          variable: "AI_ANALYSIS_API_KEY",
          message: "AI_ANALYSIS_API_KEY is required when AI_ANALYSIS_PROVIDER is set.",
        },
      ]);
    }
  });

  it("fails closed as invalid when the model is missing", () => {
    const result = resolveImageAnalysisProviderConfig({
      AI_ANALYSIS_PROVIDER: "gemini",
      AI_ANALYSIS_API_KEY: "key",
    });
    expect(result.status).toBe("invalid");
    if (result.status === "invalid") {
      expect(result.issues).toEqual([
        {
          code: "AI_ANALYSIS_MODEL_REQUIRED",
          variable: "AI_ANALYSIS_MODEL",
          message: "AI_ANALYSIS_MODEL is required when AI_ANALYSIS_PROVIDER is set.",
        },
      ]);
    }
  });

  it("collects both issues when both api key and model are missing", () => {
    const result = resolveImageAnalysisProviderConfig({ AI_ANALYSIS_PROVIDER: "gemini" });
    expect(result.status).toBe("invalid");
    if (result.status === "invalid") {
      expect(result.issues.map((i) => i.code)).toEqual([
        "AI_ANALYSIS_API_KEY_REQUIRED",
        "AI_ANALYSIS_MODEL_REQUIRED",
      ]);
    }
  });

  it("treats whitespace-only api key/model as missing, not as a valid value", () => {
    const result = resolveImageAnalysisProviderConfig({
      AI_ANALYSIS_PROVIDER: "gemini",
      AI_ANALYSIS_API_KEY: "   ",
      AI_ANALYSIS_MODEL: "   ",
    });
    expect(result.status).toBe("invalid");
  });

  it("resolves to enabled with trimmed values when fully configured for gemini", () => {
    const result = resolveImageAnalysisProviderConfig({
      AI_ANALYSIS_PROVIDER: "gemini",
      AI_ANALYSIS_API_KEY: "  secret-key  ",
      AI_ANALYSIS_MODEL: "  gemini-3.6-flash  ",
    });
    expect(result).toEqual({
      status: "enabled",
      provider: "gemini",
      apiKey: "secret-key",
      model: "gemini-3.6-flash",
      timeoutMs: 45_000,
    });
  });

  describe("timeoutMs (AI_ANALYSIS_TIMEOUT_MS)", () => {
    function enabledConfig(overrides: Record<string, string | undefined> = {}) {
      return resolveImageAnalysisProviderConfig({
        AI_ANALYSIS_PROVIDER: "gemini",
        AI_ANALYSIS_API_KEY: "key",
        AI_ANALYSIS_MODEL: "gemini-3.6-flash",
        ...overrides,
      });
    }

    it("defaults to 45000ms (GEMINI_DEFAULT_TIMEOUT_MS) when unset", () => {
      const result = enabledConfig();
      expect(result.status).toBe("enabled");
      if (result.status === "enabled") {
        expect(result.timeoutMs).toBe(45_000);
      }
    });

    it("uses a valid override value", () => {
      const result = enabledConfig({ AI_ANALYSIS_TIMEOUT_MS: "60000" });
      expect(result.status).toBe("enabled");
      if (result.status === "enabled") {
        expect(result.timeoutMs).toBe(60_000);
      }
    });

    it("clamps a value below the minimum instead of accepting an unsafe near-zero timeout", () => {
      const result = enabledConfig({ AI_ANALYSIS_TIMEOUT_MS: "100" });
      expect(result.status).toBe("enabled");
      if (result.status === "enabled") {
        expect(result.timeoutMs).toBe(5_000);
      }
    });

    it("clamps a value above the maximum instead of accepting an unbounded timeout", () => {
      const result = enabledConfig({ AI_ANALYSIS_TIMEOUT_MS: "999999999" });
      expect(result.status).toBe("enabled");
      if (result.status === "enabled") {
        expect(result.timeoutMs).toBe(120_000);
      }
    });

    it("falls back to the default for a non-numeric value, never flipping config status to invalid", () => {
      const result = enabledConfig({ AI_ANALYSIS_TIMEOUT_MS: "not-a-number" });
      expect(result.status).toBe("enabled");
      if (result.status === "enabled") {
        expect(result.timeoutMs).toBe(45_000);
      }
    });

    it("falls back to the default for an empty/whitespace value", () => {
      const result = enabledConfig({ AI_ANALYSIS_TIMEOUT_MS: "   " });
      expect(result.status).toBe("enabled");
      if (result.status === "enabled") {
        expect(result.timeoutMs).toBe(45_000);
      }
    });
  });
});
