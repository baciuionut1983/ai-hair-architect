import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.hoisted(() => ({ authenticateRetentionAutomationRequest: vi.fn() }));
const runtimeMock = vi.hoisted(() => ({ runImageAssetRetentionAutomationSweepForRuntime: vi.fn() }));

vi.mock("@/lib/retention-automation-auth", () => authMock);
vi.mock("@/lib/image-asset-retention-runtime", () => runtimeMock);

import { POST } from "./route";

function requestWithBody(body: unknown, header = "Bearer valid-token"): Request {
  const headers = new Headers({ authorization: header });
  return new Request("http://localhost/api/v1/ops/image-assets/retention/automation-run", {
    method: "POST",
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("POST /api/v1/ops/image-assets/retention/automation-run", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.authenticateRetentionAutomationRequest.mockReturnValue("authorized");
  });

  it("1. fails closed with 503 when the automation secret is not configured, never running the sweep", async () => {
    authMock.authenticateRetentionAutomationRequest.mockReturnValue("not_configured");

    const response = await POST(requestWithBody({ dryRun: false }));

    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({ error: "RETENTION_AUTOMATION_NOT_CONFIGURED" });
    expect(runtimeMock.runImageAssetRetentionAutomationSweepForRuntime).not.toHaveBeenCalled();
  });

  it("2. rejects an unauthorized (missing/wrong) bearer token with 401, never running the sweep", async () => {
    authMock.authenticateRetentionAutomationRequest.mockReturnValue("unauthorized");

    const response = await POST(requestWithBody({ dryRun: false }));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ error: "UNAUTHORIZED" });
    expect(runtimeMock.runImageAssetRetentionAutomationSweepForRuntime).not.toHaveBeenCalled();
  });

  it("3. defaults to dryRun=true for a bodiless request, never executing real deletion unless explicitly told to", async () => {
    runtimeMock.runImageAssetRetentionAutomationSweepForRuntime.mockResolvedValue({
      ownersProcessed: 0,
      ownersFailed: 0,
      totalEligible: 0,
      totalPurged: 0,
      totalFailed: 0,
      hasMore: false,
    });

    const response = await POST(requestWithBody(undefined));

    expect(response.status).toBe(200);
    expect(runtimeMock.runImageAssetRetentionAutomationSweepForRuntime).toHaveBeenCalledWith(expect.any(String), true);
  });

  it("4. runs a real sweep only when dryRun is explicitly false", async () => {
    runtimeMock.runImageAssetRetentionAutomationSweepForRuntime.mockResolvedValue({
      ownersProcessed: 2,
      ownersFailed: 0,
      totalEligible: 3,
      totalPurged: 3,
      totalFailed: 0,
      hasMore: false,
    });

    const response = await POST(requestWithBody({ dryRun: false }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ dryRun: false, result: { ownersProcessed: 2, totalPurged: 3 } });
    expect(runtimeMock.runImageAssetRetentionAutomationSweepForRuntime).toHaveBeenCalledWith(expect.any(String), false);
  });

  it("5. rejects malformed JSON with a sanitized 400, never running the sweep", async () => {
    const request = new Request("http://localhost/api/v1/ops/image-assets/retention/automation-run", {
      method: "POST",
      headers: new Headers({ authorization: "Bearer valid-token" }),
      body: "not-json{",
    });

    const response = await POST(request);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: "REQUEST_INVALID_JSON" });
    expect(runtimeMock.runImageAssetRetentionAutomationSweepForRuntime).not.toHaveBeenCalled();
  });

  it("6. collapses an unexpected sweep failure to a sanitized 500, leaking no internal detail", async () => {
    runtimeMock.runImageAssetRetentionAutomationSweepForRuntime.mockRejectedValue(new Error("unexpected: db host 10.0.0.9 unreachable"));

    const response = await POST(requestWithBody({ dryRun: false }));

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toEqual({ error: "INTERNAL_ERROR", message: "Image asset retention automation sweep failed." });
    expect(JSON.stringify(body)).not.toContain("10.0.0.9");
  });

  it("7. every response carries a Cache-Control: no-store header", async () => {
    runtimeMock.runImageAssetRetentionAutomationSweepForRuntime.mockResolvedValue({
      ownersProcessed: 0,
      ownersFailed: 0,
      totalEligible: 0,
      totalPurged: 0,
      totalFailed: 0,
      hasMore: false,
    });

    const response = await POST(requestWithBody({ dryRun: true }));
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
});
