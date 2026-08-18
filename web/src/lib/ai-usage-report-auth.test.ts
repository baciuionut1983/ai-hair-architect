import { afterEach, describe, expect, it } from "vitest";

import { authenticateAiUsageReportRequest } from "./ai-usage-report-auth";

const ORIGINAL_TOKEN = process.env.AI_USAGE_REPORT_TOKEN;

function requestWithAuthHeader(header: string | null): Request {
  const headers = new Headers();
  if (header !== null) headers.set("authorization", header);
  return new Request("http://localhost/api/v1/ops/ai-usage/report", { headers });
}

describe("authenticateAiUsageReportRequest", () => {
  afterEach(() => {
    if (ORIGINAL_TOKEN === undefined) delete process.env.AI_USAGE_REPORT_TOKEN;
    else process.env.AI_USAGE_REPORT_TOKEN = ORIGINAL_TOKEN;
  });

  it("1. fails closed as not_configured when the secret is unset, regardless of what header is presented", () => {
    delete process.env.AI_USAGE_REPORT_TOKEN;
    expect(authenticateAiUsageReportRequest(requestWithAuthHeader("Bearer anything"))).toBe("not_configured");
    expect(authenticateAiUsageReportRequest(requestWithAuthHeader(null))).toBe("not_configured");
  });

  it("2. fails closed as not_configured when the secret is set to an empty/whitespace string", () => {
    process.env.AI_USAGE_REPORT_TOKEN = "   ";
    expect(authenticateAiUsageReportRequest(requestWithAuthHeader("Bearer anything"))).toBe("not_configured");
  });

  it("3. authorizes an exact matching bearer token", () => {
    process.env.AI_USAGE_REPORT_TOKEN = "correct-horse-battery-staple";
    expect(authenticateAiUsageReportRequest(requestWithAuthHeader("Bearer correct-horse-battery-staple"))).toBe("authorized");
  });

  it("4. rejects a missing Authorization header", () => {
    process.env.AI_USAGE_REPORT_TOKEN = "secret-1";
    expect(authenticateAiUsageReportRequest(requestWithAuthHeader(null))).toBe("unauthorized");
  });

  it("5. rejects a non-Bearer scheme", () => {
    process.env.AI_USAGE_REPORT_TOKEN = "secret-1";
    expect(authenticateAiUsageReportRequest(requestWithAuthHeader("Basic secret-1"))).toBe("unauthorized");
  });

  it("6. rejects a wrong token", () => {
    process.env.AI_USAGE_REPORT_TOKEN = "secret-1";
    expect(authenticateAiUsageReportRequest(requestWithAuthHeader("Bearer secret-2"))).toBe("unauthorized");
  });

  it("7. rejects a token that is a prefix or suffix of the real one (no partial match)", () => {
    process.env.AI_USAGE_REPORT_TOKEN = "secret-12345";
    expect(authenticateAiUsageReportRequest(requestWithAuthHeader("Bearer secret-1234"))).toBe("unauthorized");
    expect(authenticateAiUsageReportRequest(requestWithAuthHeader("Bearer secret-123456"))).toBe("unauthorized");
  });

  it("8. rejects an empty bearer token even when never explicitly configured to equal empty", () => {
    process.env.AI_USAGE_REPORT_TOKEN = "secret-1";
    expect(authenticateAiUsageReportRequest(requestWithAuthHeader("Bearer "))).toBe("unauthorized");
  });
});
