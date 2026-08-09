import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.hoisted(() => ({ authenticateSessionRequest: vi.fn() }));
const opsPersistenceMock = vi.hoisted(() => ({ processPersistentPushQueueForUser: vi.fn() }));

vi.mock("@/lib/session-request-auth", () => authMock);
vi.mock("@/lib/ops-persistence", () => opsPersistenceMock);

import { POST } from "./route";

const OWNER_A = { id: "owner-1", email: "owner-a@example.com", role: "professional", locale: "en" };

beforeEach(() => {
  vi.clearAllMocks();
  authMock.authenticateSessionRequest.mockResolvedValue(OWNER_A);
  opsPersistenceMock.processPersistentPushQueueForUser.mockResolvedValue({ sent: 0, skipped: 0 });
});

describe("POST /api/v1/push/queue/process", () => {
  it("returns 401 without a cookie, never processing the queue", async () => {
    authMock.authenticateSessionRequest.mockResolvedValue(null);

    const response = await POST();

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ error: "Unauthorized" });
    expect(opsPersistenceMock.processPersistentPushQueueForUser).not.toHaveBeenCalled();
  });

  it("returns 401 for an unknown or expired session (no in-memory fallback)", async () => {
    authMock.authenticateSessionRequest.mockResolvedValue(null);

    const response = await POST();

    expect(response.status).toBe(401);
  });

  it("processes the owner-scoped queue for a valid session", async () => {
    opsPersistenceMock.processPersistentPushQueueForUser.mockResolvedValue({ sent: 0, skipped: 2 });

    const response = await POST();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ sent: 0, skipped: 2 });
    expect(opsPersistenceMock.processPersistentPushQueueForUser).toHaveBeenCalledWith("owner-1");
  });

  it("scopes queue processing strictly to the authenticated owner (cross-user isolation)", async () => {
    authMock.authenticateSessionRequest.mockResolvedValue({
      id: "owner-2",
      email: "owner-b@example.com",
      role: "professional",
      locale: "en",
    });

    await POST();

    expect(opsPersistenceMock.processPersistentPushQueueForUser).toHaveBeenCalledWith("owner-2");
    expect(opsPersistenceMock.processPersistentPushQueueForUser).not.toHaveBeenCalledWith("owner-1");
  });
});
