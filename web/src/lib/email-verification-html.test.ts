import { describe, expect, it } from "vitest";

import { buildVerificationEmailHtml } from "./email-verification-html";

describe("buildVerificationEmailHtml", () => {
  it("includes the brand name, a Verify email button linked to the url, and the url as a visible fallback", () => {
    const html = buildVerificationEmailHtml({
      introText: "Please verify your email.",
      verifyUrl: "https://app.example.com/verify-email?token=abc123",
      expiryNote: "This link expires in 24 hours.",
    });

    expect(html).toContain("AI Hair Architect");
    expect(html).toContain("Please verify your email.");
    expect(html).toContain("This link expires in 24 hours.");
    expect(html).toContain('href="https://app.example.com/verify-email?token=abc123"');
    expect(html).toContain(">Verify email<");
    // The full URL also appears as plain visible text, not only as an href.
    expect(html.split("https://app.example.com/verify-email?token=abc123").length).toBe(3);
  });

  it("escapes HTML-special characters in the url, never emitting raw markup from it", () => {
    const html = buildVerificationEmailHtml({
      introText: "Please verify your email.",
      verifyUrl: 'https://app.example.com/verify-email?token=abc"><script>alert(1)</script>',
      expiryNote: "This link expires in 24 hours.",
    });

    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&quot;&gt;&lt;script&gt;");
  });

  it("escapes HTML-special characters in the intro and expiry text", () => {
    const html = buildVerificationEmailHtml({
      introText: '<img src=x onerror=alert(1)> & "quoted"',
      verifyUrl: "https://app.example.com/verify-email?token=abc123",
      expiryNote: "5 < 10 & 10 > 5",
    });

    expect(html).not.toContain("<img src=x onerror=alert(1)>");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).toContain("&amp; &quot;quoted&quot;");
    expect(html).toContain("5 &lt; 10 &amp; 10 &gt; 5");
  });

  it("is a complete, self-contained HTML document", () => {
    const html = buildVerificationEmailHtml({
      introText: "Please verify your email.",
      verifyUrl: "https://app.example.com/verify-email?token=abc123",
      expiryNote: "This link expires in 24 hours.",
    });

    expect(html.trim().startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("<html>");
    expect(html).toContain("</html>");
  });
});
