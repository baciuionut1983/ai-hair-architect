import { beforeEach, describe, expect, it, vi } from "vitest";

const cookiesMock = vi.hoisted(() => ({ cookies: vi.fn() }));
const authPersistenceMock = vi.hoisted(() => ({ findPersistenceUserBySessionToken: vi.fn() }));
const storeMock = vi.hoisted(() => ({ upsertUser: vi.fn() }));

vi.mock("next/headers", () => cookiesMock);
vi.mock("@/lib/auth-persistence", () => authPersistenceMock);
vi.mock("@/lib/milestone1-store", () => storeMock);

import { GET } from "./route";

const PERSISTED_USER = {
  id: "owner-1",
  email: "owner-a@example.com",
  passwordHash: "hashed",
  role: "professional",
  locale: "en",
  createdAt: "2026-08-01T10:00:00.000Z",
  emailVerifiedAt: "2026-08-01T10:00:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  cookiesMock.cookies.mockResolvedValue({ get: () => ({ value: "session-token" }) });
  authPersistenceMock.findPersistenceUserBySessionToken.mockResolvedValue(PERSISTED_USER);
  storeMock.upsertUser.mockImplementation((input: unknown) => input);
});

describe("GET /api/v1/auth/me", () => {
  it("returns authenticated:false without a cookie, never querying persistence", async () => {
    cookiesMock.cookies.mockResolvedValue({ get: () => undefined });

    const response = await GET();

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ authenticated: false });
    expect(authPersistenceMock.findPersistenceUserBySessionToken).not.toHaveBeenCalled();
  });

  it("returns authenticated:false for an unknown or expired session (no in-memory fallback)", async () => {
    authPersistenceMock.findPersistenceUserBySessionToken.mockResolvedValue(null);

    const response = await GET();

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ authenticated: false });
  });

  it("returns the authenticated user for a valid Postgres session, preserving the existing response contract", async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      authenticated: true,
      user: {
        id: "owner-1",
        email: "owner-a@example.com",
        role: "professional",
        locale: "en",
        createdAt: "2026-08-01T10:00:00.000Z",
      },
    });
  });

  it("never leaks passwordHash or emailVerifiedAt in the response", async () => {
    const response = await GET();
    const body = await response.json();

    expect(body.user).not.toHaveProperty("passwordHash");
    expect(body.user).not.toHaveProperty("emailVerifiedAt");
  });

  it("syncs the resolved Postgres user into the in-memory store (unchanged non-auth business behavior)", async () => {
    await GET();

    expect(storeMock.upsertUser).toHaveBeenCalledWith({
      id: "owner-1",
      email: "owner-a@example.com",
      passwordHash: "hashed",
      role: "professional",
      locale: "en",
      createdAt: "2026-08-01T10:00:00.000Z",
    });
  });

  it("resolves distinct sessions to their own owner (cross-user isolation)", async () => {
    authPersistenceMock.findPersistenceUserBySessionToken.mockResolvedValue({
      ...PERSISTED_USER,
      id: "owner-2",
      email: "owner-b@example.com",
    });

    const response = await GET();
    const body = await response.json();

    expect(body.user.id).toBe("owner-2");
    expect(body.user.id).not.toBe("owner-1");
  });
});
