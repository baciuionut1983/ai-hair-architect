import { beforeEach, describe, expect, it, vi } from "vitest";

const cookiesMock = vi.hoisted(() => ({
  cookies: vi.fn(),
}));

vi.mock("next/headers", () => cookiesMock);

vi.mock("@/lib/milestone1-store", async () => {
  const actual = await vi.importActual<typeof import("@/lib/milestone1-store")>("@/lib/milestone1-store");
  return {
    ...(actual as object),
    getSession: vi.fn(),
    runRetentionJobForUser: vi.fn(),
  };
});

import { POST } from "./route";
import {
  beginRetentionExecutionScope,
  endRetentionExecutionScope,
  getSession,
  runRetentionJobForUser,
} from "@/lib/milestone1-store";

describe("ops retention run route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(cookiesMock.cookies).mockResolvedValue({
      get: () => ({ value: "session-token" }),
    } as never);
    vi.mocked(getSession).mockReturnValue({
      id: "user-1",
      email: "user@example.com",
      role: "professional",
      locale: "en",
      createdAt: new Date().toISOString(),
    });
    vi.mocked(runRetentionJobForUser).mockReturnValue({
      dryRun: false,
      olderThanDays: 30,
      pushQueueAffected: 1,
      auditEventsAffected: 1,
    });
  });

  it("rejects execution without explicit confirmation", async () => {
    const response = await POST({ json: async () => ({ dryRun: false }) } as never);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: "CONFIRMATION_REQUIRED" });
  });

  it("accepts explicit execution confirmation", async () => {
    const response = await POST(
      {
        json: async () => ({ dryRun: false, confirmationToken: "CONFIRM_RETENTION_EXECUTION" }),
      } as never,
    );

    expect(response.status).toBe(200);
    expect(vi.mocked(runRetentionJobForUser)).toHaveBeenCalledWith({
      userId: "user-1",
      olderThanDays: 30,
      dryRun: false,
    });
  });

  it("returns a conflict when another execution is already active", async () => {
    expect(beginRetentionExecutionScope("user-1")).toBe(true);

    const response = await POST(
      {
        json: async () => ({ dryRun: false, confirmationToken: "CONFIRM_RETENTION_EXECUTION" }),
      } as never,
    );

    endRetentionExecutionScope("user-1");

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ error: "RETENTION_CONFLICT" });
  });

  it("returns 401 when the caller is not authenticated", async () => {
    vi.mocked(getSession).mockReturnValue(null);

    const response = await POST({ json: async () => ({ dryRun: true }) } as never);

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ error: "Unauthorized" });
  });
});