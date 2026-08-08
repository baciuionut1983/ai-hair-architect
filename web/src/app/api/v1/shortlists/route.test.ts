import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.hoisted(() => ({ authenticateSessionRequest: vi.fn() }));
const clientRepositoryMock = vi.hoisted(() => ({ resolveOwnedClient: vi.fn() }));
const storeMock = vi.hoisted(() => ({
  createShortlist: vi.fn(),
  sanitize: vi.fn((value: unknown) => (typeof value === "string" ? value.trim() : "")),
}));

vi.mock("@/lib/session-request-auth", () => authMock);
vi.mock("@/lib/client-repository", () => clientRepositoryMock);
vi.mock("@/lib/milestone1-store", () => storeMock);

import { POST } from "./route";

const OWNER_A = { id: "owner-1", email: "owner-a@example.com", role: "professional", locale: "en" };

function invoke(body: unknown): Promise<Response> {
  return POST({ json: async () => body } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  authMock.authenticateSessionRequest.mockResolvedValue(OWNER_A);
  storeMock.sanitize.mockImplementation((value: unknown) => (typeof value === "string" ? value.trim() : ""));
  storeMock.createShortlist.mockReturnValue({
    id: "shortlist-1",
    ownerUserId: "owner-1",
    clientId: "",
    title: "My shortlist",
    productIds: [],
    supplierIds: [],
    createdAt: "2026-08-08T10:00:00.000Z",
  });
});

describe("POST /api/v1/shortlists", () => {
  it("returns 401 without a cookie, never creating a shortlist", async () => {
    authMock.authenticateSessionRequest.mockResolvedValue(null);

    const response = await invoke({ title: "My shortlist" });

    expect(response.status).toBe(401);
    expect(storeMock.createShortlist).not.toHaveBeenCalled();
  });

  it("returns 401 for an unknown or expired session (no in-memory fallback)", async () => {
    authMock.authenticateSessionRequest.mockResolvedValue(null);

    const response = await invoke({ title: "My shortlist" });

    expect(response.status).toBe(401);
  });

  it("rejects a missing title, never creating a shortlist", async () => {
    storeMock.sanitize.mockReturnValue("");

    const response = await invoke({});

    expect(response.status).toBe(400);
    expect(storeMock.createShortlist).not.toHaveBeenCalled();
  });

  it("creates a shortlist scoped to the authenticated owner", async () => {
    const response = await invoke({ title: "My shortlist" });

    expect(response.status).toBe(201);
    expect(storeMock.createShortlist).toHaveBeenCalledWith({
      ownerUserId: "owner-1",
      clientId: "",
      title: "My shortlist",
      productIds: [],
      supplierIds: [],
    });
    await expect(response.json()).resolves.toMatchObject({ shortlist: { id: "shortlist-1" } });
  });

  it("returns 404 when the referenced client is not owned by the caller, never creating a shortlist", async () => {
    clientRepositoryMock.resolveOwnedClient.mockResolvedValue(null);

    const response = await invoke({ title: "My shortlist", clientId: "someone-elses-client" });

    expect(response.status).toBe(404);
    expect(storeMock.createShortlist).not.toHaveBeenCalled();
  });

  it("scopes shortlist creation strictly to the authenticated owner (cross-user isolation)", async () => {
    authMock.authenticateSessionRequest.mockResolvedValue({
      id: "owner-2",
      email: "owner-b@example.com",
      role: "professional",
      locale: "en",
    });

    await invoke({ title: "My shortlist" });

    expect(storeMock.createShortlist).toHaveBeenCalledWith(
      expect.objectContaining({ ownerUserId: "owner-2" }),
    );
  });
});
