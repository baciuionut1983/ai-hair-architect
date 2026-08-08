import { beforeEach, describe, expect, it, vi } from "vitest";

const cookiesMock = vi.hoisted(() => ({ cookies: vi.fn() }));
const authPersistenceMock = vi.hoisted(() => ({ resolveAuthenticatedUserFromToken: vi.fn() }));

vi.mock("next/headers", () => cookiesMock);
vi.mock("@/lib/auth-persistence", () => authPersistenceMock);

import { authenticateSessionRequest } from "./session-request-auth";

const USER = { id: "user-1", email: "user@example.com", role: "professional", locale: "en" };

function cookieStore(value: string | undefined) {
  return {
    get: (name: string) => (name === "aha_session" && value !== undefined ? { name, value } : undefined)
  };
}

describe("authenticateSessionRequest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when the cookie is absent, never calling the resolver", async () => {
    cookiesMock.cookies.mockResolvedValue(cookieStore(undefined));

    const result = await authenticateSessionRequest();

    expect(result).toBeNull();
    expect(authPersistenceMock.resolveAuthenticatedUserFromToken).not.toHaveBeenCalled();
  });

  it("resolves the user for a valid cookie, delegating exclusively to resolveAuthenticatedUserFromToken", async () => {
    cookiesMock.cookies.mockResolvedValue(cookieStore("valid-token"));
    authPersistenceMock.resolveAuthenticatedUserFromToken.mockResolvedValue(USER);

    const result = await authenticateSessionRequest();

    expect(result).toEqual(USER);
    expect(authPersistenceMock.resolveAuthenticatedUserFromToken).toHaveBeenCalledWith("valid-token");
    expect(authPersistenceMock.resolveAuthenticatedUserFromToken).toHaveBeenCalledOnce();
  });

  it("returns null for a cookie token the resolver doesn't recognize (invalid)", async () => {
    cookiesMock.cookies.mockResolvedValue(cookieStore("unknown-token"));
    authPersistenceMock.resolveAuthenticatedUserFromToken.mockResolvedValue(null);

    const result = await authenticateSessionRequest();

    expect(result).toBeNull();
  });

  it("returns null for an expired cookie token", async () => {
    cookiesMock.cookies.mockResolvedValue(cookieStore("expired-token"));
    authPersistenceMock.resolveAuthenticatedUserFromToken.mockResolvedValue(null);

    const result = await authenticateSessionRequest();

    expect(result).toBeNull();
  });

  it("never falls back to any in-memory session store -- the resolver is the only source of truth", async () => {
    cookiesMock.cookies.mockResolvedValue(cookieStore("some-token"));
    authPersistenceMock.resolveAuthenticatedUserFromToken.mockResolvedValue(null);

    const result = await authenticateSessionRequest();

    expect(result).toBeNull();
    expect(authPersistenceMock.resolveAuthenticatedUserFromToken).toHaveBeenCalledOnce();
    expect(authPersistenceMock.resolveAuthenticatedUserFromToken).toHaveBeenCalledWith("some-token");
  });
});
