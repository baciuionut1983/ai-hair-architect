import { describe, expect, it } from "vitest";

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
});
