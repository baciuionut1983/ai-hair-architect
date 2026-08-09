import { afterEach, describe, expect, it } from "vitest";

import { authenticateRetentionAutomationRequest } from "./retention-automation-auth";

const ORIGINAL_TOKEN = process.env.RETENTION_AUTOMATION_TOKEN;

function requestWithAuthHeader(header: string | null): Request {
  const headers = new Headers();
  if (header !== null) headers.set("authorization", header);
  return new Request("http://localhost/api/v1/ops/image-assets/retention/automation-run", { headers });
}

describe("authenticateRetentionAutomationRequest", () => {
  afterEach(() => {
    if (ORIGINAL_TOKEN === undefined) delete process.env.RETENTION_AUTOMATION_TOKEN;
    else process.env.RETENTION_AUTOMATION_TOKEN = ORIGINAL_TOKEN;
  });

  it("1. fails closed as not_configured when the secret is unset, regardless of what header is presented", () => {
    delete process.env.RETENTION_AUTOMATION_TOKEN;
    expect(authenticateRetentionAutomationRequest(requestWithAuthHeader("Bearer anything"))).toBe("not_configured");
    expect(authenticateRetentionAutomationRequest(requestWithAuthHeader(null))).toBe("not_configured");
  });

  it("2. fails closed as not_configured when the secret is set to an empty/whitespace string", () => {
    process.env.RETENTION_AUTOMATION_TOKEN = "   ";
    expect(authenticateRetentionAutomationRequest(requestWithAuthHeader("Bearer anything"))).toBe("not_configured");
  });

  it("3. authorizes an exact matching bearer token", () => {
    process.env.RETENTION_AUTOMATION_TOKEN = "correct-horse-battery-staple";
    expect(authenticateRetentionAutomationRequest(requestWithAuthHeader("Bearer correct-horse-battery-staple"))).toBe("authorized");
  });

  it("4. rejects a missing Authorization header", () => {
    process.env.RETENTION_AUTOMATION_TOKEN = "secret-1";
    expect(authenticateRetentionAutomationRequest(requestWithAuthHeader(null))).toBe("unauthorized");
  });

  it("5. rejects a non-Bearer scheme", () => {
    process.env.RETENTION_AUTOMATION_TOKEN = "secret-1";
    expect(authenticateRetentionAutomationRequest(requestWithAuthHeader("Basic secret-1"))).toBe("unauthorized");
  });

  it("6. rejects a wrong token", () => {
    process.env.RETENTION_AUTOMATION_TOKEN = "secret-1";
    expect(authenticateRetentionAutomationRequest(requestWithAuthHeader("Bearer secret-2"))).toBe("unauthorized");
  });

  it("7. rejects a token that is a prefix or suffix of the real one (no partial match)", () => {
    process.env.RETENTION_AUTOMATION_TOKEN = "secret-12345";
    expect(authenticateRetentionAutomationRequest(requestWithAuthHeader("Bearer secret-1234"))).toBe("unauthorized");
    expect(authenticateRetentionAutomationRequest(requestWithAuthHeader("Bearer secret-123456"))).toBe("unauthorized");
  });

  it("8. rejects an empty bearer token even when never explicitly configured to equal empty", () => {
    process.env.RETENTION_AUTOMATION_TOKEN = "secret-1";
    expect(authenticateRetentionAutomationRequest(requestWithAuthHeader("Bearer "))).toBe("unauthorized");
  });
});
