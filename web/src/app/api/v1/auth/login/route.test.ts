import { beforeEach, describe, expect, it, vi } from "vitest";

class FakeAuthPersistenceUnavailableError extends Error {}

const persistenceMocks = vi.hoisted(() => ({
  createPersistenceSession: vi.fn(),
  findEmailVerifiedAtForUser: vi.fn(),
  findPersistenceUserByEmail: vi.fn(),
  isAuthPersistenceUnavailableError: vi.fn(),
  updatePersistencePasswordHash: vi.fn(),
}));
vi.mock("@/lib/auth-persistence", () => persistenceMocks);

const securityMocks = vi.hoisted(() => ({
  hashPassword: vi.fn(),
  isBcryptHash: vi.fn(),
  verifyPassword: vi.fn(),
}));
vi.mock("@/lib/auth-security", () => securityMocks);

const hardeningMocks = vi.hoisted(() => ({
  checkRateLimit: vi.fn(),
  getRequestClientIp: vi.fn(),
}));
vi.mock("@/lib/hardening", () => hardeningMocks);

const storeMocks = vi.hoisted(() => ({
  createSession: vi.fn(),
  findUserByEmail: vi.fn(),
  sanitize: vi.fn((value: unknown) => (typeof value === "string" ? value.trim() : "")),
  updateUserPasswordHash: vi.fn(),
  upsertUser: vi.fn(),
}));
vi.mock("@/lib/milestone1-store", () => storeMocks);

import { POST } from "./route";

const USER = {
  id: "user-1",
  email: "user@example.com",
  passwordHash: "$2b$10$hashedvalue",
  role: "professional" as const,
  locale: "en" as const,
  createdAt: "2026-08-04T00:00:00.000Z",
};

function invoke(body: unknown): Promise<Response> {
  const request = new Request("http://localhost/api/v1/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return POST(request);
}

const VALID_BODY = { email: "user@example.com", password: "password123" };

beforeEach(() => {
  vi.clearAllMocks();
  storeMocks.sanitize.mockImplementation((value: unknown) => (typeof value === "string" ? value.trim() : ""));
  storeMocks.findUserByEmail.mockReturnValue(USER);
  storeMocks.createSession.mockReturnValue("session-token");
  storeMocks.upsertUser.mockImplementation((input) => input);
  hardeningMocks.checkRateLimit.mockReturnValue({ allowed: true, remaining: 9 });
  hardeningMocks.getRequestClientIp.mockReturnValue("127.0.0.1");
  securityMocks.isBcryptHash.mockReturnValue(true);
  securityMocks.verifyPassword.mockResolvedValue(true);
  persistenceMocks.findPersistenceUserByEmail.mockResolvedValue(null);
  persistenceMocks.findEmailVerifiedAtForUser.mockResolvedValue(new Date("2026-08-01T00:00:00.000Z"));
  persistenceMocks.isAuthPersistenceUnavailableError.mockImplementation(
    (error: unknown) => error instanceof FakeAuthPersistenceUnavailableError,
  );
  persistenceMocks.createPersistenceSession.mockResolvedValue(undefined);
});

describe("POST /api/v1/auth/login", () => {
  it("returns 401 when no user is found", async () => {
    storeMocks.findUserByEmail.mockReturnValue(undefined);

    const response = await invoke(VALID_BODY);

    expect(response.status).toBe(401);
    expect(storeMocks.createSession).not.toHaveBeenCalled();
  });

  it("returns 401 on a wrong password", async () => {
    securityMocks.verifyPassword.mockResolvedValue(false);

    const response = await invoke(VALID_BODY);

    expect(response.status).toBe(401);
    expect(persistenceMocks.findEmailVerifiedAtForUser).not.toHaveBeenCalled();
    expect(storeMocks.createSession).not.toHaveBeenCalled();
  });

  it("rejects sign-in for a verified user's correct credentials with a 200 and a session cookie", async () => {
    const response = await invoke(VALID_BODY);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.token).toBe("session-token");
    expect(body.user.id).toBe("user-1");
    expect(response.headers.get("set-cookie")).toContain("aha_session=session-token");
    expect(storeMocks.createSession).toHaveBeenCalledWith("user-1");
    expect(persistenceMocks.createPersistenceSession).toHaveBeenCalledWith("session-token", "user-1");
  });

  it("rejects an unverified account with 403 EMAIL_NOT_VERIFIED and never creates a session", async () => {
    persistenceMocks.findEmailVerifiedAtForUser.mockResolvedValue(null);

    const response = await invoke(VALID_BODY);

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error).toBe("EMAIL_NOT_VERIFIED");
    expect(storeMocks.createSession).not.toHaveBeenCalled();
    expect(persistenceMocks.createPersistenceSession).not.toHaveBeenCalled();
  });

  it("checks verification only after credentials are confirmed valid, so a bad password never leaks verification state", async () => {
    securityMocks.verifyPassword.mockResolvedValue(false);
    persistenceMocks.findEmailVerifiedAtForUser.mockResolvedValue(null);

    const response = await invoke(VALID_BODY);

    expect(response.status).toBe(401);
    expect(persistenceMocks.findEmailVerifiedAtForUser).not.toHaveBeenCalled();
  });

  it("fails closed with 503 when verification status cannot be confirmed, and never creates a session", async () => {
    persistenceMocks.findEmailVerifiedAtForUser.mockRejectedValue(new FakeAuthPersistenceUnavailableError());

    const response = await invoke(VALID_BODY);

    expect(response.status).toBe(503);
    expect(storeMocks.createSession).not.toHaveBeenCalled();
  });

  it("upgrades a legacy plaintext credential on successful login and still enforces verification", async () => {
    const legacyUser = { ...USER, passwordHash: "password123" };
    storeMocks.findUserByEmail.mockReturnValue(legacyUser);
    securityMocks.isBcryptHash.mockReturnValue(false);
    securityMocks.hashPassword.mockResolvedValue("$2b$10$upgraded");

    const response = await invoke(VALID_BODY);

    expect(securityMocks.hashPassword).toHaveBeenCalledWith("password123");
    expect(storeMocks.updateUserPasswordHash).toHaveBeenCalledWith("user-1", "$2b$10$upgraded");
    expect(persistenceMocks.updatePersistencePasswordHash).toHaveBeenCalledWith("user-1", "$2b$10$upgraded");
    expect(response.status).toBe(200);
  });

  it("falls back to the real-Postgres lookup when the in-memory cache is cold", async () => {
    storeMocks.findUserByEmail.mockReturnValue(undefined);
    persistenceMocks.findPersistenceUserByEmail.mockResolvedValue({
      id: "user-2",
      email: "user@example.com",
      passwordHash: "$2b$10$hashedvalue",
      role: "professional",
      locale: "en",
      createdAt: "2026-08-01T00:00:00.000Z",
      emailVerifiedAt: "2026-08-01T00:00:00.000Z",
    });
    storeMocks.upsertUser.mockReturnValue({ ...USER, id: "user-2" });

    const response = await invoke(VALID_BODY);

    expect(storeMocks.upsertUser).toHaveBeenCalled();
    expect(response.status).toBe(200);
  });

  it("returns 429 when the rate limit is exceeded", async () => {
    hardeningMocks.checkRateLimit.mockReturnValue({ allowed: false, remaining: 0 });

    const response = await invoke(VALID_BODY);

    expect(response.status).toBe(429);
    expect(storeMocks.findUserByEmail).not.toHaveBeenCalled();
  });
});
