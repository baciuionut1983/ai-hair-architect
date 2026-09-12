import { afterEach, describe, expect, it } from "vitest";

import nextConfig from "../next.config";

// Regression: a blanket `Permissions-Policy: microphone=()` on every route
// silently blocked getUserMedia({ audio: true }) for teach-ai-panel.tsx's
// "Speak to AI" feature -- a Permissions-Policy violation, enforced by the
// browser BEFORE it ever consults the user's own site/OS microphone
// permission, so no combination of user-facing permission settings could
// ever have fixed it. Locks in that microphone is scoped to `self` (this
// app's own pages can use it) while camera/geolocation, which nothing in
// this app calls, remain fully disabled.
describe("next.config.ts security headers", () => {
  async function permissionsPolicyValue(): Promise<string> {
    if (typeof nextConfig.headers !== "function") {
      throw new Error("next.config.ts must export a headers() function");
    }
    const rules = await nextConfig.headers();
    const rule = rules.find((entry) => entry.source === "/:path*");
    const header = rule?.headers.find((h) => h.key === "Permissions-Policy");
    if (!header) {
      throw new Error("Permissions-Policy header is missing from next.config.ts");
    }
    return header.value;
  }

  it("allows microphone for this app's own pages (self), not disabled entirely", async () => {
    const value = await permissionsPolicyValue();
    expect(value).toContain("microphone=(self)");
  });

  it("keeps camera and geolocation disabled -- nothing in this app calls either API", async () => {
    const value = await permissionsPolicyValue();
    expect(value).toContain("camera=()");
    expect(value).toContain("geolocation=()");
  });

  it("applies the Permissions-Policy header to every route, not just specific pages", async () => {
    const rules = await nextConfig.headers?.();
    expect(rules?.some((entry) => entry.source === "/:path*")).toBe(true);
  });

  // Regression: cloud Voice Reply's <audio> element plays a blob: URL
  // built from the /voice-reply response. With no explicit media-src,
  // CSP falls back to default-src 'self', which does not include the
  // blob: scheme -- Chrome blocked the load at the security-policy level
  // (before ever attempting to decode real, valid audio bytes),
  // surfacing as "MEDIA_ELEMENT_ERROR: Media rejected by URL safety
  // check" and a NotSupportedError on play(). Applies globally
  // (source: "/:path*"), so this covers every language's Voice Reply.
  async function contentSecurityPolicyValue(): Promise<string> {
    if (typeof nextConfig.headers !== "function") {
      throw new Error("next.config.ts must export a headers() function");
    }
    const rules = await nextConfig.headers();
    const rule = rules.find((entry) => entry.source === "/:path*");
    const header = rule?.headers.find((h) => h.key === "Content-Security-Policy");
    if (!header) {
      throw new Error("Content-Security-Policy header is missing from next.config.ts");
    }
    return header.value;
  }

  it("allows blob: media sources for this app's own pages -- required for cloud Voice Reply's <audio> playback", async () => {
    const value = await contentSecurityPolicyValue();
    expect(value).toContain("media-src 'self' blob:");
  });

  it("keeps the same blob: allowance already established for images (client photo previews), for consistency", async () => {
    const value = await contentSecurityPolicyValue();
    expect(value).toContain("img-src 'self' data: blob:");
  });

  // Stage 8.5L3.3 -- a real live-browser test against a real, newly
  // created non-production S3 bucket found this exact CSP directive
  // silently blocking every browser-to-S3 presigned multipart PUT
  // request before the network call was ever attempted (a real console
  // error: "Refused to connect because it violates the document's
  // Content Security Policy"), invisible to every prior test because
  // CSP is a browser-enforced header no Node-based fake/mock ever
  // exercises.
  describe("connect-src / Stage 8.5L3.3 S3 multipart CSP fix", () => {
    const originalEnv = { ...process.env };

    afterEach(() => {
      for (const key of Object.keys(process.env)) {
        if (!(key in originalEnv)) delete process.env[key];
      }
      Object.assign(process.env, originalEnv);
    });

    it("stays exactly connect-src 'self' when the s3 backend is not configured (every local dev/test environment by default)", async () => {
      delete process.env.OBJECT_STORAGE_BACKEND;
      const value = await contentSecurityPolicyValue();
      expect(value).toContain("connect-src 'self';");
      expect(value).not.toContain("amazonaws.com");
    });

    it("allows the real, configured S3 origin once the s3 backend is active -- exactly what the browser multipart PUT needs", async () => {
      process.env.OBJECT_STORAGE_BACKEND = "s3";
      process.env.OBJECT_STORAGE_BUCKET = "ai-hair-architect-learning-test-example";
      process.env.OBJECT_STORAGE_REGION = "eu-north-1";
      const value = await contentSecurityPolicyValue();
      expect(value).toContain("connect-src 'self' https://ai-hair-architect-learning-test-example.s3.eu-north-1.amazonaws.com;");
    });
  });
});
