import { describe, expect, it } from "vitest";

import { resolveEmailConfig } from "./email-provider-config";

function env(overrides: Record<string, string | undefined>): NodeJS.ProcessEnv {
  return { ...overrides } as NodeJS.ProcessEnv;
}

describe("resolveEmailConfig", () => {
  it("is disabled when EMAIL_PROCESSING_MODE is missing", () => {
    expect(resolveEmailConfig(env({}))).toEqual({ status: "disabled" });
  });

  it("is disabled for any value other than the literal string \"enabled\"", () => {
    expect(resolveEmailConfig(env({ EMAIL_PROCESSING_MODE: "true" }))).toEqual({ status: "disabled" });
    expect(resolveEmailConfig(env({ EMAIL_PROCESSING_MODE: "Enabled" }))).toEqual({ status: "disabled" });
    expect(resolveEmailConfig(env({ EMAIL_PROCESSING_MODE: "" }))).toEqual({ status: "disabled" });
  });

  it("is invalid when enabled but RESEND_API_KEY is missing", () => {
    const result = resolveEmailConfig(
      env({ EMAIL_PROCESSING_MODE: "enabled", EMAIL_FROM_ADDRESS: "noreply@example.com" }),
    );
    expect(result.status).toBe("invalid");
    if (result.status === "invalid") {
      expect(result.issues.map((issue) => issue.code)).toContain("RESEND_API_KEY_REQUIRED");
    }
  });

  it("is invalid when enabled but EMAIL_FROM_ADDRESS is missing", () => {
    const result = resolveEmailConfig(env({ EMAIL_PROCESSING_MODE: "enabled", RESEND_API_KEY: "re_test" }));
    expect(result.status).toBe("invalid");
    if (result.status === "invalid") {
      expect(result.issues.map((issue) => issue.code)).toContain("EMAIL_FROM_ADDRESS_REQUIRED");
    }
  });

  it("reports both issues when both required variables are missing", () => {
    const result = resolveEmailConfig(env({ EMAIL_PROCESSING_MODE: "enabled" }));
    expect(result.status).toBe("invalid");
    if (result.status === "invalid") {
      expect(result.issues).toHaveLength(2);
    }
  });

  it("is enabled with a default timeout when everything required is present", () => {
    const result = resolveEmailConfig(
      env({ EMAIL_PROCESSING_MODE: "enabled", RESEND_API_KEY: "re_test", EMAIL_FROM_ADDRESS: "noreply@example.com" }),
    );
    expect(result).toEqual({
      status: "enabled",
      apiKey: "re_test",
      fromAddress: "noreply@example.com",
      timeoutMs: 8000,
    });
  });

  it("honors a valid custom timeout", () => {
    const result = resolveEmailConfig(
      env({
        EMAIL_PROCESSING_MODE: "enabled",
        RESEND_API_KEY: "re_test",
        EMAIL_FROM_ADDRESS: "noreply@example.com",
        EMAIL_PROVIDER_TIMEOUT_MS: "3000",
      }),
    );
    expect(result.status).toBe("enabled");
    if (result.status === "enabled") {
      expect(result.timeoutMs).toBe(3000);
    }
  });

  it("falls back to the default timeout for an invalid or too-small value", () => {
    const result = resolveEmailConfig(
      env({
        EMAIL_PROCESSING_MODE: "enabled",
        RESEND_API_KEY: "re_test",
        EMAIL_FROM_ADDRESS: "noreply@example.com",
        EMAIL_PROVIDER_TIMEOUT_MS: "10",
      }),
    );
    expect(result.status).toBe("enabled");
    if (result.status === "enabled") {
      expect(result.timeoutMs).toBe(8000);
    }
  });

  it("trims whitespace from configured values", () => {
    const result = resolveEmailConfig(
      env({ EMAIL_PROCESSING_MODE: "enabled", RESEND_API_KEY: "  re_test  ", EMAIL_FROM_ADDRESS: "  noreply@example.com  " }),
    );
    expect(result.status).toBe("enabled");
    if (result.status === "enabled") {
      expect(result.apiKey).toBe("re_test");
      expect(result.fromAddress).toBe("noreply@example.com");
    }
  });
});
