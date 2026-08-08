import { beforeEach, describe, expect, it, vi } from "vitest";

const authPersistenceMock = vi.hoisted(() => ({
  resolveAuthenticatedUserFromToken: vi.fn(),
}));
const sessionAuthMock = vi.hoisted(() => ({
  authenticateSessionUser: vi.fn(),
}));

vi.mock("@/lib/auth-persistence", () => authPersistenceMock);
vi.mock("@/lib/session-auth", () => sessionAuthMock);

import { resolvePipelineAuth } from "./image-pipeline-auth";
import type { NextRequest } from "next/server";

const COOKIE_USER = { id: "user-cookie", email: "cookie@example.com", role: "professional", locale: "en" };
const BEARER_USER = { id: "user-bearer", email: "bearer@example.com", role: "professional", locale: "en" };

function request(options: { cookie?: string; bearer?: string }): NextRequest {
  const headers = new Headers();
  if (options.bearer !== undefined) {
    headers.set("Authorization", `Bearer ${options.bearer}`);
  }

  return {
    headers,
    cookies: {
      get: (name: string) =>
        name === "aha_session" && options.cookie !== undefined ? { name, value: options.cookie } : undefined,
    },
  } as unknown as NextRequest;
}

describe("resolvePipelineAuth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when no credentials are presented", async () => {
    const result = await resolvePipelineAuth(request({}));

    expect(result).toBeNull();
    expect(authPersistenceMock.resolveAuthenticatedUserFromToken).not.toHaveBeenCalled();
    expect(sessionAuthMock.authenticateSessionUser).not.toHaveBeenCalled();
  });

  it("resolves a valid, unexpired cookie session via the shared M32 resolver", async () => {
    authPersistenceMock.resolveAuthenticatedUserFromToken.mockResolvedValue(COOKIE_USER);

    const result = await resolvePipelineAuth(request({ cookie: "cookie-token" }));

    expect(result).toEqual(COOKIE_USER);
    expect(authPersistenceMock.resolveAuthenticatedUserFromToken).toHaveBeenCalledWith("cookie-token");
    expect(sessionAuthMock.authenticateSessionUser).not.toHaveBeenCalled();
  });

  it("returns null for an expired cookie session (no fallback)", async () => {
    authPersistenceMock.resolveAuthenticatedUserFromToken.mockResolvedValue(null);

    const result = await resolvePipelineAuth(request({ cookie: "expired-token" }));

    expect(result).toBeNull();
  });

  it("returns null for a cookie token with no matching session", async () => {
    authPersistenceMock.resolveAuthenticatedUserFromToken.mockResolvedValue(null);

    const result = await resolvePipelineAuth(request({ cookie: "unknown-token" }));

    expect(result).toBeNull();
  });

  it("resolves a valid Bearer token via the existing hardened check", async () => {
    sessionAuthMock.authenticateSessionUser.mockResolvedValue(BEARER_USER);

    const result = await resolvePipelineAuth(request({ bearer: "bearer-token" }));

    expect(result).toEqual(BEARER_USER);
    expect(sessionAuthMock.authenticateSessionUser).toHaveBeenCalledOnce();
    expect(authPersistenceMock.resolveAuthenticatedUserFromToken).not.toHaveBeenCalled();
  });

  it("returns null for an expired Bearer token", async () => {
    sessionAuthMock.authenticateSessionUser.mockResolvedValue(null);

    const result = await resolvePipelineAuth(request({ bearer: "expired-bearer" }));

    expect(result).toBeNull();
  });

  it("accepts both credentials when they resolve to the same user", async () => {
    authPersistenceMock.resolveAuthenticatedUserFromToken.mockResolvedValue({ ...COOKIE_USER, id: "user-1" });
    sessionAuthMock.authenticateSessionUser.mockResolvedValue({ ...BEARER_USER, id: "user-1" });

    const result = await resolvePipelineAuth(request({ cookie: "cookie-token", bearer: "bearer-token" }));

    expect(result?.id).toBe("user-1");
  });

  it("fails closed (does not disclose identities) when both credentials resolve to different users", async () => {
    authPersistenceMock.resolveAuthenticatedUserFromToken.mockResolvedValue(COOKIE_USER);
    sessionAuthMock.authenticateSessionUser.mockResolvedValue(BEARER_USER);

    const result = await resolvePipelineAuth(request({ cookie: "cookie-token", bearer: "bearer-token" }));

    expect(result).toBeNull();
  });

  it("rejects when the cookie is valid but the presented Bearer token is invalid (no silent fallback)", async () => {
    authPersistenceMock.resolveAuthenticatedUserFromToken.mockResolvedValue(COOKIE_USER);
    sessionAuthMock.authenticateSessionUser.mockResolvedValue(null);

    const result = await resolvePipelineAuth(request({ cookie: "cookie-token", bearer: "expired-bearer" }));

    expect(result).toBeNull();
  });

  it("rejects when the Bearer token is valid but the presented cookie is invalid (no silent fallback)", async () => {
    authPersistenceMock.resolveAuthenticatedUserFromToken.mockResolvedValue(null);
    sessionAuthMock.authenticateSessionUser.mockResolvedValue(BEARER_USER);

    const result = await resolvePipelineAuth(request({ cookie: "expired-token", bearer: "bearer-token" }));

    expect(result).toBeNull();
  });

  it("rejects when both presented credentials are invalid", async () => {
    authPersistenceMock.resolveAuthenticatedUserFromToken.mockResolvedValue(null);
    sessionAuthMock.authenticateSessionUser.mockResolvedValue(null);

    const result = await resolvePipelineAuth(request({ cookie: "expired-token", bearer: "expired-bearer" }));

    expect(result).toBeNull();
  });
});
