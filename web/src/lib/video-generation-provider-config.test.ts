import { describe, expect, it } from "vitest";

import {
  isVideoDemonstrationProviderName,
  isVideoDemonstrationVeoModel,
  resolveVideoDemonstrationProviderConfig,
  VIDEO_DEMONSTRATION_ALLOWED_VEO_MODELS,
} from "@/lib/video-generation-provider-config";

// Real AI Video Demonstration, Stage 2 -- fills a Stage 1 test-coverage
// gap for the provider config resolver, and locks down the exact,
// live-verified 3-model allowlist (Stage 2, section 1) so a future,
// unverified addition to the allowlist fails this test rather than
// silently shipping.

describe("VIDEO_DEMONSTRATION_ALLOWED_VEO_MODELS", () => {
  it("is exactly the 3 models independently verified live against ai.google.dev/gemini-api/docs/models and .../docs/pricing this stage -- no more, no less", () => {
    expect(VIDEO_DEMONSTRATION_ALLOWED_VEO_MODELS).toEqual(["veo-3.1-generate-preview", "veo-3.1-fast-generate-preview", "veo-3.1-lite-generate-preview"]);
  });

  it("no longer contains the unverified Stage 0/1 placeholders veo-3-generate / veo-2-generate", () => {
    const list: readonly string[] = VIDEO_DEMONSTRATION_ALLOWED_VEO_MODELS;
    expect(list.includes("veo-3-generate")).toBe(false);
    expect(list.includes("veo-2-generate")).toBe(false);
    expect(list.includes("veo-2.0-generate-001")).toBe(false);
  });
});

describe("isVideoDemonstrationVeoModel / isVideoDemonstrationProviderName", () => {
  it("accepts every allowlisted model, rejects anything else", () => {
    for (const model of VIDEO_DEMONSTRATION_ALLOWED_VEO_MODELS) {
      expect(isVideoDemonstrationVeoModel(model)).toBe(true);
    }
    expect(isVideoDemonstrationVeoModel("veo-2.0-generate-001")).toBe(false);
    expect(isVideoDemonstrationVeoModel("sora-2")).toBe(false);
    expect(isVideoDemonstrationVeoModel(123)).toBe(false);
  });

  it("only google is a recognized provider", () => {
    expect(isVideoDemonstrationProviderName("google")).toBe(true);
    expect(isVideoDemonstrationProviderName("openai")).toBe(false);
    expect(isVideoDemonstrationProviderName("gemini")).toBe(false); // Photo Preview's own provider name, deliberately not Video's
  });
});

describe("resolveVideoDemonstrationProviderConfig", () => {
  it("unset VIDEO_DEMONSTRATION_PROVIDER means disabled -- the safe default for a feature that must never make a real call yet", () => {
    expect(resolveVideoDemonstrationProviderConfig({})).toEqual({ status: "disabled" });
    expect(resolveVideoDemonstrationProviderConfig({ VIDEO_DEMONSTRATION_PROVIDER: "" })).toEqual({ status: "disabled" });
  });

  it("an unrecognized provider is invalid, never silently coerced to disabled or to a default", () => {
    const result = resolveVideoDemonstrationProviderConfig({ VIDEO_DEMONSTRATION_PROVIDER: "openai" });
    expect(result.status).toBe("invalid");
    if (result.status === "invalid") {
      expect(result.issues.map((i) => i.code)).toContain("VIDEO_DEMONSTRATION_PROVIDER_INVALID");
    }
  });

  it("google set but missing API key / model is invalid, listing every missing variable", () => {
    const result = resolveVideoDemonstrationProviderConfig({ VIDEO_DEMONSTRATION_PROVIDER: "google" });
    expect(result.status).toBe("invalid");
    if (result.status === "invalid") {
      const codes = result.issues.map((i) => i.code);
      expect(codes).toContain("VIDEO_DEMONSTRATION_API_KEY_REQUIRED");
      expect(codes).toContain("VIDEO_DEMONSTRATION_MODEL_REQUIRED");
    }
  });

  it("google with a model outside the allowlist is invalid, never accepting an arbitrary caller-supplied model id", () => {
    const result = resolveVideoDemonstrationProviderConfig({
      VIDEO_DEMONSTRATION_PROVIDER: "google",
      VIDEO_DEMONSTRATION_API_KEY: "key-123",
      VIDEO_DEMONSTRATION_MODEL: "veo-2.0-generate-001",
    });
    expect(result.status).toBe("invalid");
    if (result.status === "invalid") {
      expect(result.issues.map((i) => i.code)).toContain("VIDEO_DEMONSTRATION_MODEL_INVALID");
    }
  });

  it("a fully valid configuration resolves to enabled with the exact model requested, and an optional parsed timeout", () => {
    const result = resolveVideoDemonstrationProviderConfig({
      VIDEO_DEMONSTRATION_PROVIDER: "google",
      VIDEO_DEMONSTRATION_API_KEY: "key-123",
      VIDEO_DEMONSTRATION_MODEL: "veo-3.1-lite-generate-preview",
      VIDEO_DEMONSTRATION_TIMEOUT_MS: "45000",
    });
    expect(result).toEqual({ status: "enabled", provider: "google", apiKey: "key-123", model: "veo-3.1-lite-generate-preview", timeoutMs: 45000 });
  });

  it("a missing/invalid timeout value resolves to undefined, never a fabricated default or NaN", () => {
    const result = resolveVideoDemonstrationProviderConfig({
      VIDEO_DEMONSTRATION_PROVIDER: "google",
      VIDEO_DEMONSTRATION_API_KEY: "key-123",
      VIDEO_DEMONSTRATION_MODEL: "veo-3.1-lite-generate-preview",
      VIDEO_DEMONSTRATION_TIMEOUT_MS: "not-a-number",
    });
    expect(result.status).toBe("enabled");
    if (result.status === "enabled") expect(result.timeoutMs).toBeUndefined();
  });
});
