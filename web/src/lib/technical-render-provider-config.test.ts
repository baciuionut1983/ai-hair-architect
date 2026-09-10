import { describe, expect, it } from "vitest";

import { resolveTechnicalRenderProviderConfig, summarizeTechnicalRenderProviderConfig } from "@/lib/technical-render-provider-config";

// AI Hair Architect, Stage 8.5A -- TECHNICAL RENDER PROVIDER CONFIG
// tests. Pure. Never asserts on a key VALUE, only PRESENT/MISSING.

const SHARED_OK = {
  VIDEO_DEMONSTRATION_PROVIDER: "google",
  VIDEO_DEMONSTRATION_API_KEY: "SECRET-not-inspected",
  VIDEO_DEMONSTRATION_MODEL: "veo-3.1-lite-generate-preview",
};

describe("resolveTechnicalRenderProviderConfig -- Option B: share credential, isolate feature", () => {
  it("is DISABLED by default even when the shared video provider is fully configured (feature isolation)", () => {
    const r = resolveTechnicalRenderProviderConfig({ ...SHARED_OK });
    expect(r.status).toBe("disabled");
  });

  it("requires an explicit dedicated model when enabled", () => {
    const r = resolveTechnicalRenderProviderConfig({ ...SHARED_OK, PROFESSIONAL_TECHNICAL_RENDER_ENABLED: "true" });
    expect(r.status).toBe("invalid");
    if (r.status === "invalid") expect(r.issues.some((i) => i.variable === "PROFESSIONAL_TECHNICAL_RENDER_MODEL")).toBe(true);
  });

  it("configured: shares the credential, uses a DEDICATED model", () => {
    const r = resolveTechnicalRenderProviderConfig({ ...SHARED_OK, PROFESSIONAL_TECHNICAL_RENDER_ENABLED: "true", PROFESSIONAL_TECHNICAL_RENDER_MODEL: "veo-3.1-generate-preview" });
    expect(r.status).toBe("configured");
    if (r.status === "configured") {
      expect(r.provider).toBe("google");
      expect(r.model).toBe("veo-3.1-generate-preview");
      expect(r.credentialSource).toBe("SHARED_VIDEO_DEMONSTRATION");
      expect(r.modelSource).toBe("DEDICATED");
      expect(r.apiKeyPresent).toBe(true);
    }
    expect(JSON.stringify(r)).not.toContain("SECRET-not-inspected");
  });

  it("configured with explicit \"inherit\" reuses the shared model but records the source", () => {
    const r = resolveTechnicalRenderProviderConfig({ ...SHARED_OK, PROFESSIONAL_TECHNICAL_RENDER_ENABLED: "true", PROFESSIONAL_TECHNICAL_RENDER_MODEL: "inherit" });
    expect(r.status).toBe("configured");
    if (r.status === "configured") {
      expect(r.model).toBe("veo-3.1-lite-generate-preview");
      expect(r.modelSource).toBe("INHERITED_VIDEO_DEMONSTRATION");
    }
  });

  it("enabled but shared credential missing -> invalid, never configured", () => {
    const r = resolveTechnicalRenderProviderConfig({ PROFESSIONAL_TECHNICAL_RENDER_ENABLED: "true", PROFESSIONAL_TECHNICAL_RENDER_MODEL: "veo-3.1-generate-preview" });
    expect(r.status).toBe("invalid");
  });

  it("summarize reports only PRESENT/MISSING booleans, never a key", () => {
    const disabled = summarizeTechnicalRenderProviderConfig({ ...SHARED_OK });
    expect(disabled).toMatchObject({ enabled: false, status: "disabled", apiKeyPresent: false, modelPresent: false });

    const configured = summarizeTechnicalRenderProviderConfig({ ...SHARED_OK, PROFESSIONAL_TECHNICAL_RENDER_ENABLED: "true", PROFESSIONAL_TECHNICAL_RENDER_MODEL: "veo-3.1-generate-preview" });
    expect(configured).toMatchObject({ enabled: true, status: "configured", provider: "google", model: "veo-3.1-generate-preview", apiKeyPresent: true, modelPresent: true });
    expect(JSON.stringify(configured)).not.toContain("SECRET-not-inspected");
  });
});
