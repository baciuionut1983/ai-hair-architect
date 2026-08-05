import { beforeEach, describe, expect, it, vi } from "vitest";

const cookiesMock = vi.hoisted(() => ({ cookies: vi.fn() }));
const storeMock = vi.hoisted(() => ({
  getSession: vi.fn(),
  sanitize: vi.fn((value: unknown) => (typeof value === "string" ? value.trim() : ""))
}));
const repositoryMock = vi.hoisted(() => ({
  clientPersistenceUnavailableResponse: vi.fn(),
  isClientPersistenceError: vi.fn(),
  resolveOwnedClient: vi.fn(),
  softDeleteClientForOwner: vi.fn(),
  updateClientForOwner: vi.fn()
}));

vi.mock("next/headers", () => cookiesMock);
vi.mock("@/lib/milestone1-store", () => storeMock);
vi.mock("@/lib/client-repository", () => repositoryMock);

import { DELETE, GET, PATCH } from "./route";

const params = { params: Promise.resolve({ id: "client-1" }) };

function getRequest(): Request {
  return new Request("http://localhost/api/v1/clients/client-1");
}

function patchRequest(body: unknown): Request {
  return new Request("http://localhost/api/v1/clients/client-1", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

function deleteRequest(): Request {
  return new Request("http://localhost/api/v1/clients/client-1", { method: "DELETE" });
}

beforeEach(() => {
  vi.clearAllMocks();
  cookiesMock.cookies.mockResolvedValue({ get: () => ({ value: "session-token" }) });
  storeMock.getSession.mockReturnValue({ id: "owner-1" });
  storeMock.sanitize.mockImplementation((value: unknown) => (typeof value === "string" ? value.trim() : ""));
  repositoryMock.isClientPersistenceError.mockReturnValue(false);
  repositoryMock.clientPersistenceUnavailableResponse.mockReturnValue(
    Response.json({ error: "CLIENT_PERSISTENCE_UNAVAILABLE" }, { status: 503, headers: { "Cache-Control": "no-store" } })
  );
});

describe("GET /api/v1/clients/:id", () => {
  it("returns 401 without a session", async () => {
    storeMock.getSession.mockReturnValue(null);
    const response = await GET(getRequest(), params);
    expect(response.status).toBe(401);
    expect(repositoryMock.resolveOwnedClient).not.toHaveBeenCalled();
  });

  it("returns 404 for a nonexistent or another owner's client", async () => {
    repositoryMock.resolveOwnedClient.mockResolvedValue(null);
    const response = await GET(getRequest(), params);
    expect(response.status).toBe(404);
  });

  it("returns the client, owner-scoped, preserving the existing ClientRecord shape", async () => {
    const client = {
      id: "client-1",
      ownerUserId: "owner-1",
      fullName: "Jane Doe",
      email: "jane@example.com",
      phone: "555-0100",
      notes: "Prefers cool tones",
      createdAt: "2026-08-05T10:00:00.000Z",
      updatedAt: "2026-08-05T10:00:00.000Z"
    };
    repositoryMock.resolveOwnedClient.mockResolvedValue(client);

    const response = await GET(getRequest(), params);

    expect(response.status).toBe(200);
    expect(repositoryMock.resolveOwnedClient).toHaveBeenCalledWith("owner-1", "client-1");
    await expect(response.json()).resolves.toEqual({ client });
  });

  it("propagates a persistence-unavailable Response from resolveOwnedClient", async () => {
    const unavailable = Response.json({ error: "CLIENT_PERSISTENCE_UNAVAILABLE" }, { status: 503 });
    repositoryMock.resolveOwnedClient.mockResolvedValue(unavailable);

    const response = await GET(getRequest(), params);
    expect(response.status).toBe(503);
  });
});

describe("PATCH /api/v1/clients/:id", () => {
  it("returns 401 without a session", async () => {
    storeMock.getSession.mockReturnValue(null);
    const response = await PATCH(patchRequest({ fullName: "New name" }), params);
    expect(response.status).toBe(401);
    expect(repositoryMock.updateClientForOwner).not.toHaveBeenCalled();
  });

  it("returns 404 when the client does not exist or is owned by someone else", async () => {
    repositoryMock.updateClientForOwner.mockResolvedValue(null);
    const response = await PATCH(patchRequest({ fullName: "New name" }), params);
    expect(response.status).toBe(404);
  });

  it("updates only the fields provided", async () => {
    const updated = {
      id: "client-1",
      ownerUserId: "owner-1",
      fullName: "New name",
      email: "",
      phone: "",
      notes: "",
      createdAt: "2026-08-05T10:00:00.000Z",
      updatedAt: "2026-08-05T10:05:00.000Z"
    };
    repositoryMock.updateClientForOwner.mockResolvedValue(updated);

    const response = await PATCH(patchRequest({ fullName: "New name" }), params);

    expect(response.status).toBe(200);
    expect(repositoryMock.updateClientForOwner).toHaveBeenCalledWith("owner-1", "client-1", { fullName: "New name" });
    await expect(response.json()).resolves.toEqual({ client: updated });
  });

  it("rejects clearing fullName to empty", async () => {
    const response = await PATCH(patchRequest({ fullName: "" }), params);
    expect(response.status).toBe(400);
    expect(repositoryMock.updateClientForOwner).not.toHaveBeenCalled();
  });

  it("fails closed with 503 when persistence is unavailable", async () => {
    const error = new Error("db down");
    repositoryMock.updateClientForOwner.mockRejectedValue(error);
    repositoryMock.isClientPersistenceError.mockImplementation((value: unknown) => value === error);

    const response = await PATCH(patchRequest({ fullName: "New name" }), params);
    expect(response.status).toBe(503);
  });
});

describe("DELETE /api/v1/clients/:id", () => {
  it("returns 401 without a session", async () => {
    storeMock.getSession.mockReturnValue(null);
    const response = await DELETE(deleteRequest(), params);
    expect(response.status).toBe(401);
    expect(repositoryMock.softDeleteClientForOwner).not.toHaveBeenCalled();
  });

  it("returns 404 when the client does not exist or is owned by someone else", async () => {
    repositoryMock.softDeleteClientForOwner.mockResolvedValue(false);
    const response = await DELETE(deleteRequest(), params);
    expect(response.status).toBe(404);
  });

  it("soft-deletes and returns success", async () => {
    repositoryMock.softDeleteClientForOwner.mockResolvedValue(true);
    const response = await DELETE(deleteRequest(), params);

    expect(response.status).toBe(200);
    expect(repositoryMock.softDeleteClientForOwner).toHaveBeenCalledWith("owner-1", "client-1");
    await expect(response.json()).resolves.toEqual({ success: true });
  });

  it("fails closed with 503 when persistence is unavailable", async () => {
    const error = new Error("db down");
    repositoryMock.softDeleteClientForOwner.mockRejectedValue(error);
    repositoryMock.isClientPersistenceError.mockImplementation((value: unknown) => value === error);

    const response = await DELETE(deleteRequest(), params);
    expect(response.status).toBe(503);
  });
});
