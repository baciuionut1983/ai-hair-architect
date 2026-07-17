import { describe, expect, it } from "vitest";

import { checkRateLimit, ensureRequestId, getRequestClientIp, maskSensitive } from "./hardening";

describe("milestone5 hardening utilities", () => {
  it("generates request id and masks sensitive data", () => {
    const generated = ensureRequestId("");
    expect(generated.length).toBeGreaterThan(10);

    expect(maskSensitive("abcdefg@example.com")).toContain("***");
  });

  it("enforces rate limit window", () => {
    const key = `test-rate-${Date.now()}`;
    const first = checkRateLimit(key, 2, 60_000);
    const second = checkRateLimit(key, 2, 60_000);
    const third = checkRateLimit(key, 2, 60_000);

    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(true);
    expect(third.allowed).toBe(false);
  });

  it("extracts client ip from proxy headers", () => {
    const request = new Request("https://example.test", {
      headers: {
        "x-forwarded-for": "198.51.100.7, 10.0.0.5"
      }
    });

    expect(getRequestClientIp(request)).toBe("198.51.100.7");
  });
});
