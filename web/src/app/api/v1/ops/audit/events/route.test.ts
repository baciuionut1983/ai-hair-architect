import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.hoisted(() => ({ authenticateSessionRequest: vi.fn() }));

vi.mock("@/lib/session-request-auth", () => authMock);

vi.mock("@/lib/ops-persistence", () => ({
  listOpsAuditEventsForUser: vi.fn(),
}));

import { GET } from "./route";
import { listOpsAuditEventsForUser } from "@/lib/ops-persistence";

const OWNER_A = { id: "user-1", email: "user@example.com", role: "professional", locale: "en" };

describe("ops audit events route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns owner-scoped ops audit events", async () => {
    authMock.authenticateSessionRequest.mockResolvedValue(OWNER_A);
    vi.mocked(listOpsAuditEventsForUser).mockResolvedValue([
      {
        id: "audit-1",
        ownerUserId: "user-1",
        requestId: "req-1",
        module: "security",
        action: "ops.retention.execution.completed",
        createdAt: "2026-07-21T10:00:00.000Z",
        metadata: { correlationRequestId: "req-1" },
      },
    ]);

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      events: [{ id: "audit-1", action: "ops.retention.execution.completed" }],
    });
  });

  it("returns 401 without a cookie, never reading persistence", async () => {
    authMock.authenticateSessionRequest.mockResolvedValue(null);

    const response = await GET();

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ error: "Unauthorized" });
    expect(listOpsAuditEventsForUser).not.toHaveBeenCalled();
  });

  it("returns 401 for an unknown or expired session (no in-memory fallback)", async () => {
    authMock.authenticateSessionRequest.mockResolvedValue(null);

    const response = await GET();

    expect(response.status).toBe(401);
  });

  it("scopes the audit event list strictly to the authenticated owner (cross-user isolation)", async () => {
    authMock.authenticateSessionRequest.mockResolvedValue({
      id: "user-2",
      email: "user2@example.com",
      role: "professional",
      locale: "en",
    });
    vi.mocked(listOpsAuditEventsForUser).mockResolvedValue([]);

    await GET();

    expect(listOpsAuditEventsForUser).toHaveBeenCalledWith("user-2");
    expect(listOpsAuditEventsForUser).not.toHaveBeenCalledWith("user-1");
  });
});