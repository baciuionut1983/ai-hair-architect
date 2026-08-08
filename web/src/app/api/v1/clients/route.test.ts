import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.hoisted(() => ({ authenticateSessionRequest: vi.fn() }));
const repositoryMock = vi.hoisted(() => ({
  clientPersistenceUnavailableResponse: vi.fn(() => Response.json({ error: "CLIENT_PERSISTENCE_UNAVAILABLE" }, { status: 503 })),
  createClientForOwner: vi.fn(),
  isClientPersistenceError: vi.fn(),
  listClientsForOwner: vi.fn(),
}));
const storeMock = vi.hoisted(() => ({
  sanitize: vi.fn(),
}));

vi.mock("@/lib/client-repository", () => repositoryMock);
vi.mock("@/lib/milestone1-store", () => storeMock);
vi.mock("@/lib/session-request-auth", () => authMock);

import { GET, POST } from "./route";

const mutableEnv = process.env as Record<string, string | undefined>;
const originalNodeEnv = process.env.NODE_ENV;
const OWNER_A = { id: "owner-1", email: "owner-a@example.com", role: "professional", locale: "en" };

describe("clients business persistence guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storeMock.sanitize.mockImplementation((value) => String(value ?? "").trim());
  });

  afterEach(() => {
    mutableEnv.NODE_ENV = originalNodeEnv;
  });

  it.each([
    ["GET", () => GET(new Request("http://localhost/api/v1/clients"))],
    ["POST", () => POST(new Request("http://localhost/api/v1/clients", { method: "POST" }))],
  ])("allows durable %s in production and continues to authentication", async (_method, invoke) => {
    mutableEnv.NODE_ENV = "production";
    authMock.authenticateSessionRequest.mockResolvedValue(null);

    const response = await invoke();

    expect(response.status).toBe(401);
    expect(authMock.authenticateSessionRequest).toHaveBeenCalled();
  });

  it("returns 401 without a cookie, bypassing the business-persistence guard in test", async () => {
    mutableEnv.NODE_ENV = "test";
    authMock.authenticateSessionRequest.mockResolvedValue(null);

    const response = await GET(new Request("http://localhost/api/v1/clients"));

    expect(response.status).toBe(401);
    expect(authMock.authenticateSessionRequest).toHaveBeenCalledOnce();
  });

  it("returns 401 for an unknown or expired session (no in-memory fallback)", async () => {
    mutableEnv.NODE_ENV = "test";
    authMock.authenticateSessionRequest.mockResolvedValue(null);

    const response = await GET(new Request("http://localhost/api/v1/clients"));

    expect(response.status).toBe(401);
    expect(repositoryMock.listClientsForOwner).not.toHaveBeenCalled();
  });

  it("lists only through the durable repository for a valid session", async () => {
    mutableEnv.NODE_ENV = "test";
    authMock.authenticateSessionRequest.mockResolvedValue(OWNER_A);
    repositoryMock.listClientsForOwner.mockResolvedValue([{ id: "client-1" }]);

    const response = await GET(new Request("http://localhost/api/v1/clients"));

    expect(response.status).toBe(200);
    expect(repositoryMock.listClientsForOwner).toHaveBeenCalledWith("owner-1");
    await expect(response.json()).resolves.toEqual({ clients: [{ id: "client-1" }] });
  });

  it("scopes the list strictly to the authenticated owner (cross-user isolation)", async () => {
    mutableEnv.NODE_ENV = "test";
    authMock.authenticateSessionRequest.mockResolvedValue({ ...OWNER_A, id: "owner-2" });
    repositoryMock.listClientsForOwner.mockResolvedValue([]);

    await GET(new Request("http://localhost/api/v1/clients"));

    expect(repositoryMock.listClientsForOwner).toHaveBeenCalledWith("owner-2");
    expect(repositoryMock.listClientsForOwner).not.toHaveBeenCalledWith("owner-1");
  });

  it("returns controlled 503 when durable persistence fails", async () => {
    mutableEnv.NODE_ENV = "test";
    authMock.authenticateSessionRequest.mockResolvedValue(OWNER_A);
    repositoryMock.listClientsForOwner.mockRejectedValue(new Error("database details"));
    repositoryMock.isClientPersistenceError.mockReturnValue(true);

    const response = await GET(new Request("http://localhost/api/v1/clients"));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: "CLIENT_PERSISTENCE_UNAVAILABLE" });
  });
});