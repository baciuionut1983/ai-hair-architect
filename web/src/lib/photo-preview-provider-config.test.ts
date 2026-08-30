import { describe, expect, it } from "vitest";

import {
  isPhotoPreviewGeminiModel,
  isPhotoPreviewProviderName,
  PHOTO_PREVIEW_ALLOWED_GEMINI_MODELS,
  resolvePhotoPreviewProviderConfig,
} from "@/lib/photo-preview-provider-config";

describe("resolvePhotoPreviewProviderConfig", () => {
  it("unset PHOTO_PREVIEW_PROVIDER means disabled -- the safe default for a feature that must never make a real call yet", () => {
    expect(resolvePhotoPreviewProviderConfig({})).toEqual({ status: "disabled" });
    expect(resolvePhotoPreviewProviderConfig({ PHOTO_PREVIEW_PROVIDER: "" })).toEqual({ status: "disabled" });
  });

  it("an unrecognized provider is invalid, never silently coerced to disabled or to a default", () => {
    const result = resolvePhotoPreviewProviderConfig({ PHOTO_PREVIEW_PROVIDER: "openai" });
    expect(result.status).toBe("invalid");
    if (result.status === "invalid") {
      expect(result.issues.map((i) => i.code)).toContain("PHOTO_PREVIEW_PROVIDER_INVALID");
    }
  });

  it("gemini set but missing API key / model is invalid, listing every missing variable", () => {
    const result = resolvePhotoPreviewProviderConfig({ PHOTO_PREVIEW_PROVIDER: "gemini" });
    expect(result.status).toBe("invalid");
    if (result.status === "invalid") {
      const codes = result.issues.map((i) => i.code);
      expect(codes).toContain("PHOTO_PREVIEW_API_KEY_REQUIRED");
      expect(codes).toContain("PHOTO_PREVIEW_MODEL_REQUIRED");
    }
  });

  it("gemini with a model outside the allowlist is invalid, never accepting an arbitrary caller-supplied model id", () => {
    const result = resolvePhotoPreviewProviderConfig({
      PHOTO_PREVIEW_PROVIDER: "gemini",
      PHOTO_PREVIEW_API_KEY: "key-123",
      PHOTO_PREVIEW_MODEL: "gemini-1.5-flash",
    });
    expect(result.status).toBe("invalid");
    if (result.status === "invalid") {
      expect(result.issues.map((i) => i.code)).toContain("PHOTO_PREVIEW_MODEL_INVALID");
    }
  });

  it("gemini with a valid, allowlisted model resolves to enabled", () => {
    const result = resolvePhotoPreviewProviderConfig({
      PHOTO_PREVIEW_PROVIDER: "gemini",
      PHOTO_PREVIEW_API_KEY: "key-123",
      PHOTO_PREVIEW_MODEL: "gemini-3-pro-image",
    });
    expect(result).toEqual({ status: "enabled", provider: "gemini", apiKey: "key-123", model: "gemini-3-pro-image" });
  });

  it("both candidate models from Stage 0's A/B evaluation are accepted", () => {
    for (const model of PHOTO_PREVIEW_ALLOWED_GEMINI_MODELS) {
      const result = resolvePhotoPreviewProviderConfig({ PHOTO_PREVIEW_PROVIDER: "gemini", PHOTO_PREVIEW_API_KEY: "k", PHOTO_PREVIEW_MODEL: model });
      expect(result.status).toBe("enabled");
    }
  });
});

describe("isPhotoPreviewGeminiModel / isPhotoPreviewProviderName", () => {
  it("accept only the exact locked allowlists", () => {
    expect(isPhotoPreviewGeminiModel("gemini-3.1-flash-image")).toBe(true);
    expect(isPhotoPreviewGeminiModel("gpt-image-1")).toBe(false);
    expect(isPhotoPreviewProviderName("gemini")).toBe(true);
    expect(isPhotoPreviewProviderName("openai")).toBe(false);
  });
});
