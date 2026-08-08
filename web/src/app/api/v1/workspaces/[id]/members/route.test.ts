import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.hoisted(() => ({ authenticateSessionRequest: vi.fn() }));
const storeMock = vi.hoisted(() => ({
  addWorkspaceMember: vi.fn(),
  sanitize: vi.fn((value: unknown) => (typeof value === "string" ? value.trim() : "")),
}));

vi.mock("@/lib/session-request-auth", () => authMock);
vi.mock("@/lib/milestone1-store", () => storeMock);

import { POST } from "./route";

const OWNER_A = { id: "owner-1", email: "owner-a@example.com", role: "professional", locale: "en" };

function invoke(body: unknown, workspaceId = "workspace-1"): Promise<Response> {
  return POST({ json: async () => body } as never, { params: Promise.resolve({ id: workspaceId }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  authMock.authenticateSessionRequest.mockResolvedValue(OWNER_A);
  storeMock.sanitize.mockImplementation((value: unknown) => (typeof value === "string" ? value.trim() : ""));
  storeMock.addWorkspaceMember.mockReturnValue({
    id: "member-1",
    workspaceId: "workspace-1",
    userId: "new-member",
    role: "stylist",
    createdAt: "2026-08-08T10:00:00.000Z",
  });
});

describe("POST /api/v1/workspaces/[id]/members", () => {
  it("returns 401 without a cookie, never adding a member", async () => {
    authMock.authenticateSessionRequest.mockResolvedValue(null);

    const response = await invoke({ userId: "new-member" });

    expect(response.status).toBe(401);
    expect(storeMock.addWorkspaceMember).not.toHaveBeenCalled();
  });

  it("returns 401 for an unknown or expired session (no in-memory fallback)", async () => {
    authMock.authenticateSessionRequest.mockResolvedValue(null);

    const response = await invoke({ userId: "new-member" });

    expect(response.status).toBe(401);
  });

  it("rejects a missing userId, never adding a member", async () => {
    storeMock.sanitize.mockReturnValue("");

    const response = await invoke({});

    expect(response.status).toBe(400);
    expect(storeMock.addWorkspaceMember).not.toHaveBeenCalled();
  });

  it("adds a member on behalf of the authenticated actor", async () => {
    const response = await invoke({ userId: "new-member", role: "manager" });

    expect(response.status).toBe(201);
    expect(storeMock.addWorkspaceMember).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      actorUserId: "owner-1",
      userId: "new-member",
      role: "manager",
    });
  });

  it("returns 403 unchanged when the actor lacks permission to add members (role authorization, not authentication)", async () => {
    storeMock.addWorkspaceMember.mockReturnValue(null);

    const response = await invoke({ userId: "new-member" });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: "Cannot add member with current permissions or invalid user.",
    });
  });

  it("scopes the actor strictly to the authenticated session (cross-user isolation)", async () => {
    authMock.authenticateSessionRequest.mockResolvedValue({
      id: "owner-2",
      email: "owner-b@example.com",
      role: "professional",
      locale: "en",
    });

    await invoke({ userId: "new-member" });

    expect(storeMock.addWorkspaceMember).toHaveBeenCalledWith(
      expect.objectContaining({ actorUserId: "owner-2" }),
    );
  });
});
