import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const cookiesMock = vi.hoisted(() => ({ cookies: vi.fn() }));
const repositoryMock = vi.hoisted(() => ({
  clientPersistenceUnavailableResponse: vi.fn(() => Response.json({ error: "CLIENT_PERSISTENCE_UNAVAILABLE" }, { status: 503 })),
  createClientForOwner: vi.fn(),
  isClientPersistenceError: vi.fn(),
  listClientsForOwner: vi.fn(),
}));
const storeMock = vi.hoisted(() => ({
  getSession: vi.fn(),
  sanitize: vi.fn(),
}));

vi.mock("next/headers", () => cookiesMock);
vi.mock("@/lib/client-repository", () => repositoryMock);
vi.mock("@/lib/milestone1-store", () => storeMock);

import { GET, POST } from "./route";

const mutableEnv = process.env as Record<string, string | undefined>;
const originalNodeEnv = process.env.NODE_ENV;

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
    cookiesMock.cookies.mockResolvedValue({ get: () => undefined });
    storeMock.getSession.mockReturnValue(null);

    const response = await invoke();

    expect(response.status).toBe(401);
    expect(storeMock.getSession).toHaveBeenCalled();
  });

  it("bypasses the guard in test and continues the existing flow", async () => {
    mutableEnv.NODE_ENV = "test";
    cookiesMock.cookies.mockResolvedValue({ get: () => undefined });
    storeMock.getSession.mockReturnValue(null);

    const response = await GET(new Request("http://localhost/api/v1/clients"));

    expect(response.status).toBe(401);
    expect(storeMock.getSession).toHaveBeenCalledOnce();
  });

  it("lists only through the durable repository", async () => {
    mutableEnv.NODE_ENV = "test";
    cookiesMock.cookies.mockResolvedValue({ get: () => ({ value: "token" }) });
    storeMock.getSession.mockReturnValue({ id: "owner-1" });
    repositoryMock.listClientsForOwner.mockResolvedValue([{ id: "client-1" }]);

    const response = await GET(new Request("http://localhost/api/v1/clients"));

    expect(response.status).toBe(200);
    expect(repositoryMock.listClientsForOwner).toHaveBeenCalledWith("owner-1");
    await expect(response.json()).resolves.toEqual({ clients: [{ id: "client-1" }] });
  });

  it("returns controlled 503 when durable persistence fails", async () => {
    mutableEnv.NODE_ENV = "test";
    cookiesMock.cookies.mockResolvedValue({ get: () => ({ value: "token" }) });
    storeMock.getSession.mockReturnValue({ id: "owner-1" });
    repositoryMock.listClientsForOwner.mockRejectedValue(new Error("database details"));
    repositoryMock.isClientPersistenceError.mockReturnValue(true);

    const response = await GET(new Request("http://localhost/api/v1/clients"));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: "CLIENT_PERSISTENCE_UNAVAILABLE" });
  });
});