import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.hoisted(() => ({ authenticateSessionRequest: vi.fn() }));
const storeMock = vi.hoisted(() => ({
  createWorkspace: vi.fn(),
  getWorkspacesForUser: vi.fn(),
  sanitize: vi.fn((value: unknown) => (typeof value === "string" ? value.trim() : "")),
}));

vi.mock("@/lib/session-request-auth", () => authMock);
vi.mock("@/lib/milestone1-store", () => storeMock);

import { GET, POST } from "./route";

const OWNER_A = { id: "owner-1", email: "owner-a@example.com", role: "professional", locale: "en" };

beforeEach(() => {
  vi.clearAllMocks();
  authMock.authenticateSessionRequest.mockResolvedValue(OWNER_A);
  storeMock.sanitize.mockImplementation((value: unknown) => (typeof value === "string" ? value.trim() : ""));
  storeMock.getWorkspacesForUser.mockReturnValue([]);
  storeMock.createWorkspace.mockReturnValue({
    id: "workspace-1",
    ownerUserId: "owner-1",
    name: "My salon",
    createdAt: "2026-08-08T10:00:00.000Z",
  });
});

describe("GET /api/v1/workspaces", () => {
  it("returns 401 without a cookie, never reading workspaces", async () => {
    authMock.authenticateSessionRequest.mockResolvedValue(null);

    const response = await GET();

    expect(response.status).toBe(401);
    expect(storeMock.getWorkspacesForUser).not.toHaveBeenCalled();
  });

  it("returns 401 for an unknown or expired session (no in-memory fallback)", async () => {
    authMock.authenticateSessionRequest.mockResolvedValue(null);

    const response = await GET();

    expect(response.status).toBe(401);
  });

  it("scopes the workspace list strictly to the authenticated owner (cross-user isolation)", async () => {
    authMock.authenticateSessionRequest.mockResolvedValue({
      id: "owner-2",
      email: "owner-b@example.com",
      role: "professional",
      locale: "en",
    });

    await GET();

    expect(storeMock.getWorkspacesForUser).toHaveBeenCalledWith("owner-2");
    expect(storeMock.getWorkspacesForUser).not.toHaveBeenCalledWith("owner-1");
  });
});

describe("POST /api/v1/workspaces", () => {
  function invoke(body: unknown): Promise<Response> {
    return POST({ json: async () => body } as never);
  }

  it("returns 401 without a cookie, never creating a workspace", async () => {
    authMock.authenticateSessionRequest.mockResolvedValue(null);

    const response = await invoke({ name: "My salon" });

    expect(response.status).toBe(401);
    expect(storeMock.createWorkspace).not.toHaveBeenCalled();
  });

  it("returns 401 for an unknown or expired session (no in-memory fallback)", async () => {
    authMock.authenticateSessionRequest.mockResolvedValue(null);

    const response = await invoke({ name: "My salon" });

    expect(response.status).toBe(401);
  });

  it("rejects a missing name, never creating a workspace", async () => {
    storeMock.sanitize.mockReturnValue("");

    const response = await invoke({});

    expect(response.status).toBe(400);
    expect(storeMock.createWorkspace).not.toHaveBeenCalled();
  });

  it("creates a workspace for the authenticated owner", async () => {
    const response = await invoke({ name: "My salon" });

    expect(response.status).toBe(201);
    expect(storeMock.createWorkspace).toHaveBeenCalledWith("owner-1", "My salon");
  });

  it("scopes workspace creation strictly to the authenticated owner (cross-user isolation)", async () => {
    authMock.authenticateSessionRequest.mockResolvedValue({
      id: "owner-2",
      email: "owner-b@example.com",
      role: "professional",
      locale: "en",
    });

    await invoke({ name: "My salon" });

    expect(storeMock.createWorkspace).toHaveBeenCalledWith("owner-2", "My salon");
  });
});
