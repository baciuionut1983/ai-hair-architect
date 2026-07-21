import { beforeEach, describe, expect, it, vi } from "vitest";

const cookiesMock = vi.hoisted(() => ({
  cookies: vi.fn(),
}));

vi.mock("next/headers", () => cookiesMock);

vi.mock("@/lib/ops-persistence", () => ({
  resolveOpsSessionUser: vi.fn(),
  listOpsAuditEventsForUser: vi.fn(),
}));

import { GET } from "./route";
import { listOpsAuditEventsForUser, resolveOpsSessionUser } from "@/lib/ops-persistence";

describe("ops audit events route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(cookiesMock.cookies).mockResolvedValue({
      get: () => ({ value: "session-token" }),
    } as never);
  });

  it("returns owner-scoped ops audit events", async () => {
    vi.mocked(resolveOpsSessionUser).mockResolvedValue({
      id: "user-1",
      email: "user@example.com",
      role: "professional",
      locale: "en",
      createdAt: new Date().toISOString(),
    } as never);
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

  it("returns 401 when unauthenticated", async () => {
    vi.mocked(resolveOpsSessionUser).mockResolvedValue(null);

    const response = await GET();

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ error: "Unauthorized" });
  });
});