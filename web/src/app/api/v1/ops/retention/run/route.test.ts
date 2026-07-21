import { beforeEach, describe, expect, it, vi } from "vitest";

const cookiesMock = vi.hoisted(() => ({
  cookies: vi.fn(),
}));

vi.mock("next/headers", () => cookiesMock);

vi.mock("@/lib/ops-persistence", () => {
  return {
    resolveOpsSessionUser: vi.fn(),
    runPersistentRetention: vi.fn(),
  };
});

import { POST } from "./route";
import { resolveOpsSessionUser, runPersistentRetention } from "@/lib/ops-persistence";

describe("ops retention run route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(cookiesMock.cookies).mockResolvedValue({
      get: () => ({ value: "session-token" }),
    } as never);
    vi.mocked(resolveOpsSessionUser).mockResolvedValue({
      id: "user-1",
      email: "user@example.com",
      role: "professional",
      locale: "en",
      createdAt: new Date().toISOString(),
    } as never);
  });

  it("rejects execution without explicit confirmation", async () => {
    vi.mocked(runPersistentRetention).mockResolvedValue({
      httpStatus: 400,
      body: { error: "CONFIRMATION_REQUIRED", message: "Explicit confirmation is required to execute retention." },
    });

    const response = await POST({ json: async () => ({ dryRun: false }) } as never);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: "CONFIRMATION_REQUIRED" });
  });

  it("accepts explicit execution confirmation", async () => {
    vi.mocked(runPersistentRetention).mockResolvedValue({
      httpStatus: 200,
      body: {
        result: {
          runId: "run-1",
          status: "execution_completed",
          dryRun: false,
          olderThanDays: 30,
          pushQueueAffected: 0,
          auditEventsAffected: 1,
        },
      },
    });

    const response = await POST(
      {
        json: async () => ({ dryRun: false, confirmationToken: "CONFIRM_RETENTION_EXECUTION" }),
      } as never,
    );

    expect(response.status).toBe(200);
    expect(vi.mocked(runPersistentRetention)).toHaveBeenCalledWith({
      userId: "user-1",
      olderThanDays: 30,
      dryRun: false,
      confirmationToken: "CONFIRM_RETENTION_EXECUTION",
      executionIdempotencyKey: undefined,
      reason: undefined,
      correlationRequestId: expect.any(String),
    });
  });

  it("returns a conflict when advisory lock acquisition fails", async () => {
    vi.mocked(runPersistentRetention).mockResolvedValue({
      httpStatus: 409,
      body: { error: "RETENTION_CONFLICT", message: "A retention execution is already running for this scope." },
    });

    const response = await POST(
      {
        json: async () => ({
          dryRun: false,
          confirmationToken: "CONFIRM_RETENTION_EXECUTION",
          executionIdempotencyKey: "same-key",
        }),
      } as never,
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ error: "RETENTION_CONFLICT" });
  });

  it("returns persistent replay for failed executions without creating a new run", async () => {
    vi.mocked(runPersistentRetention).mockResolvedValue({
      httpStatus: 409,
      body: {
        error: "EXECUTION_FAILED",
        message: "Retention execution previously failed.",
        result: {
          runId: "run-failed",
          status: "execution_failed",
          replayed: true,
          dryRun: false,
          olderThanDays: 30,
          pushQueueAffected: 0,
          auditEventsAffected: 0,
        },
      },
    });

    const response = await POST(
      {
        json: async () => ({
          dryRun: false,
          confirmationToken: "CONFIRM_RETENTION_EXECUTION",
          executionIdempotencyKey: "failed-key",
        }),
      } as never,
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: "EXECUTION_FAILED",
      result: { runId: "run-failed", replayed: true, status: "execution_failed" },
    });
  });

  it("returns 401 when the caller is not authenticated", async () => {
    vi.mocked(resolveOpsSessionUser).mockResolvedValue(null);

    const response = await POST({ json: async () => ({ dryRun: true }) } as never);

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ error: "Unauthorized" });
  });
});