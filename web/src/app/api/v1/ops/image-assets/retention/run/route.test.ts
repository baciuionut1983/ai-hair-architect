import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.hoisted(() => ({ authenticateSessionRequest: vi.fn() }));
const runtimeMock = vi.hoisted(() => ({ runImageAssetRetentionPurgeForUser: vi.fn() }));

vi.mock("@/lib/session-request-auth", () => authMock);

vi.mock("@/lib/image-asset-retention-runtime", async () => {
  const actual = await vi.importActual<typeof import("@/lib/image-asset-retention-runtime")>(
    "@/lib/image-asset-retention-runtime",
  );
  return {
    ImageAssetRetentionError: actual.ImageAssetRetentionError,
    runImageAssetRetentionPurgeForUser: runtimeMock.runImageAssetRetentionPurgeForUser,
  };
});

import { POST } from "./route";
import { ImageAssetRetentionError } from "@/lib/image-asset-retention-runtime";

const OWNER_A = { id: "user-1", email: "user@example.com", role: "professional", locale: "en" };

describe("POST /api/v1/ops/image-assets/retention/run", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.authenticateSessionRequest.mockResolvedValue(OWNER_A);
  });

  it("returns 401 without a cookie, never touching the purge", async () => {
    authMock.authenticateSessionRequest.mockResolvedValue(null);

    const response = await POST({ json: async () => ({}) } as never);

    expect(response.status).toBe(401);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(runtimeMock.runImageAssetRetentionPurgeForUser).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON with a sanitized 400", async () => {
    const response = await POST({
      json: async () => {
        throw new Error("bad-json");
      },
    } as never);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: "REQUEST_INVALID_JSON" });
    expect(runtimeMock.runImageAssetRetentionPurgeForUser).not.toHaveBeenCalled();
  });

  it("rejects a non-object body", async () => {
    const response = await POST({ json: async () => [] } as never);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: "REQUEST_INVALID_JSON" });
  });

  it("defaults to dry-run when dryRun is omitted", async () => {
    runtimeMock.runImageAssetRetentionPurgeForUser.mockResolvedValue({
      runId: "run-1",
      status: "dry_run_completed",
      startedAt: "2026-08-10T00:00:00.000Z",
      finishedAt: "2026-08-10T00:00:00.000Z",
      replayed: false,
      dryRun: true,
      eligibleCount: 0,
      purgedCount: 0,
      failedCount: 0,
      failures: [],
    });

    const response = await POST({ json: async () => ({}) } as never);

    expect(response.status).toBe(200);
    expect(runtimeMock.runImageAssetRetentionPurgeForUser).toHaveBeenCalledWith(
      expect.objectContaining({ ownerUserId: "user-1", dryRun: true }),
    );
  });

  it("passes through an explicit execution request with all fields", async () => {
    runtimeMock.runImageAssetRetentionPurgeForUser.mockResolvedValue({
      runId: "run-2",
      status: "execution_completed",
      startedAt: "2026-08-10T00:00:00.000Z",
      finishedAt: "2026-08-10T00:00:01.000Z",
      replayed: false,
      dryRun: false,
      eligibleCount: 1,
      purgedCount: 1,
      failedCount: 0,
      failures: [],
    });

    const response = await POST({
      json: async () => ({
        dryRun: false,
        confirmationToken: "CONFIRM_IMAGE_ASSET_RETENTION_EXECUTION",
        executionIdempotencyKey: "key-1",
        reason: "scheduled purge",
      }),
    } as never);

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({ result: { runId: "run-2", purgedCount: 1 } });
    expect(runtimeMock.runImageAssetRetentionPurgeForUser).toHaveBeenCalledWith({
      ownerUserId: "user-1",
      dryRun: false,
      confirmationToken: "CONFIRM_IMAGE_ASSET_RETENTION_EXECUTION",
      executionIdempotencyKey: "key-1",
      reason: "scheduled purge",
      correlationRequestId: expect.any(String),
    });
  });

  it("maps CONFIRMATION_REQUIRED to a sanitized 400", async () => {
    runtimeMock.runImageAssetRetentionPurgeForUser.mockRejectedValue(
      new ImageAssetRetentionError("CONFIRMATION_REQUIRED", 400, "Explicit confirmation is required to execute retention."),
    );

    const response = await POST({ json: async () => ({ dryRun: false }) } as never);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "CONFIRMATION_REQUIRED",
      message: "Explicit confirmation is required to execute retention.",
    });
  });

  it("maps RETENTION_CONFLICT to 409", async () => {
    runtimeMock.runImageAssetRetentionPurgeForUser.mockRejectedValue(
      new ImageAssetRetentionError("RETENTION_CONFLICT", 409, "An image asset retention execution is already running for this owner."),
    );

    const response = await POST({
      json: async () => ({ dryRun: false, confirmationToken: "CONFIRM_IMAGE_ASSET_RETENTION_EXECUTION" }),
    } as never);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ error: "RETENTION_CONFLICT" });
  });

  it("maps IDEMPOTENCY_CONFLICT to 409", async () => {
    runtimeMock.runImageAssetRetentionPurgeForUser.mockRejectedValue(
      new ImageAssetRetentionError("IDEMPOTENCY_CONFLICT", 409, "The idempotency key was already used with a different payload."),
    );

    const response = await POST({
      json: async () => ({ dryRun: false, confirmationToken: "CONFIRM_IMAGE_ASSET_RETENTION_EXECUTION", executionIdempotencyKey: "k" }),
    } as never);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ error: "IDEMPOTENCY_CONFLICT" });
  });

  it("collapses an unexpected error to a sanitized 500 with no internal detail leaked", async () => {
    runtimeMock.runImageAssetRetentionPurgeForUser.mockRejectedValue(new Error("unexpected: connection reset by peer at 10.0.0.5"));

    const response = await POST({
      json: async () => ({ dryRun: false, confirmationToken: "CONFIRM_IMAGE_ASSET_RETENTION_EXECUTION" }),
    } as never);

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toEqual({ error: "INTERNAL_ERROR", message: "Image asset retention execution failed." });
    expect(JSON.stringify(body)).not.toContain("10.0.0.5");
  });

  it("scopes the purge strictly to the authenticated owner (cross-user isolation)", async () => {
    authMock.authenticateSessionRequest.mockResolvedValue({ id: "owner-2", email: "b@example.com", role: "professional", locale: "en" });
    runtimeMock.runImageAssetRetentionPurgeForUser.mockResolvedValue({
      runId: "run-3",
      status: "dry_run_completed",
      startedAt: "2026-08-10T00:00:00.000Z",
      finishedAt: "2026-08-10T00:00:00.000Z",
      replayed: false,
      dryRun: true,
      eligibleCount: 0,
      purgedCount: 0,
      failedCount: 0,
      failures: [],
    });

    await POST({ json: async () => ({}) } as never);

    expect(runtimeMock.runImageAssetRetentionPurgeForUser).toHaveBeenCalledWith(expect.objectContaining({ ownerUserId: "owner-2" }));
    expect(runtimeMock.runImageAssetRetentionPurgeForUser).not.toHaveBeenCalledWith(expect.objectContaining({ ownerUserId: "user-1" }));
  });
});
