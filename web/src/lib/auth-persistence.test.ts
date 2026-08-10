import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMocks = vi.hoisted(() => ({
  configured: true,
  userFindUnique: vi.fn(),
  userCreate: vi.fn(),
  sessionFindUnique: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  isDatabaseConfigured: () => prismaMocks.configured,
  prisma: {
    user: {
      findUnique: prismaMocks.userFindUnique,
      create: prismaMocks.userCreate,
    },
    session: {
      findUnique: prismaMocks.sessionFindUnique,
    },
  },
}));

import { Prisma } from "@prisma/client";

import {
  AuthPersistenceUnavailableError,
  createPersistenceUserExclusive,
  findEmailVerifiedAtForUser,
  findPersistenceUserByEmail,
  findPersistenceUserBySessionToken,
  isAuthPersistenceUnavailableError,
  resolveAuthenticatedUserFromToken,
} from "./auth-persistence";

beforeEach(() => {
  vi.clearAllMocks();
  prismaMocks.configured = true;
});

describe("isAuthPersistenceUnavailableError", () => {
  it("recognizes instances of AuthPersistenceUnavailableError and rejects everything else", () => {
    expect(isAuthPersistenceUnavailableError(new AuthPersistenceUnavailableError())).toBe(true);
    expect(isAuthPersistenceUnavailableError(new Error("other"))).toBe(false);
    expect(isAuthPersistenceUnavailableError(null)).toBe(false);
  });
});

describe("findEmailVerifiedAtForUser", () => {
  it("returns the verified timestamp when the user has one", async () => {
    const verifiedAt = new Date("2026-08-01T00:00:00.000Z");
    prismaMocks.userFindUnique.mockResolvedValue({ emailVerifiedAt: verifiedAt });

    const result = await findEmailVerifiedAtForUser("user-1");

    expect(result).toEqual(verifiedAt);
    expect(prismaMocks.userFindUnique).toHaveBeenCalledWith({
      where: { id: "user-1" },
      select: { emailVerifiedAt: true },
    });
  });

  it("returns null when the account exists but has not been verified", async () => {
    prismaMocks.userFindUnique.mockResolvedValue({ emailVerifiedAt: null });

    const result = await findEmailVerifiedAtForUser("user-1");

    expect(result).toBeNull();
  });

  it("throws (fails closed) rather than returning null when the database is not configured", async () => {
    prismaMocks.configured = false;

    await expect(findEmailVerifiedAtForUser("user-1")).rejects.toBeInstanceOf(AuthPersistenceUnavailableError);
    expect(prismaMocks.userFindUnique).not.toHaveBeenCalled();
  });

  it("throws when the user row cannot be found", async () => {
    prismaMocks.userFindUnique.mockResolvedValue(null);

    await expect(findEmailVerifiedAtForUser("missing-user")).rejects.toBeInstanceOf(AuthPersistenceUnavailableError);
  });

  it("throws (never resolves to a misleading null) when the query itself fails", async () => {
    prismaMocks.userFindUnique.mockRejectedValue(new Error("connection reset"));

    await expect(findEmailVerifiedAtForUser("user-1")).rejects.toBeInstanceOf(AuthPersistenceUnavailableError);
  });
});

describe("findPersistenceUserByEmail", () => {
  const ROW = {
    id: "user-1",
    email: "user@example.com",
    passwordHash: "hashed",
    role: "professional",
    locale: "en",
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
    emailVerifiedAt: new Date("2026-08-02T00:00:00.000Z"),
  };

  it("includes emailVerifiedAt as an ISO string when the account is verified", async () => {
    prismaMocks.userFindUnique.mockResolvedValue(ROW);

    const result = await findPersistenceUserByEmail("user@example.com");

    expect(result?.emailVerifiedAt).toBe("2026-08-02T00:00:00.000Z");
  });

  it("returns emailVerifiedAt: null for an unverified account, not a missing field", async () => {
    prismaMocks.userFindUnique.mockResolvedValue({ ...ROW, emailVerifiedAt: null });

    const result = await findPersistenceUserByEmail("user@example.com");

    expect(result?.emailVerifiedAt).toBeNull();
  });

  it("returns null when the database is not configured (best-effort, non-fatal)", async () => {
    prismaMocks.configured = false;

    const result = await findPersistenceUserByEmail("user@example.com");

    expect(result).toBeNull();
  });

  it("returns null (not a throw) when the lookup fails", async () => {
    prismaMocks.userFindUnique.mockRejectedValue(new Error("connection reset"));

    const result = await findPersistenceUserByEmail("user@example.com");

    expect(result).toBeNull();
  });
});

describe("findPersistenceUserBySessionToken", () => {
  const USER_ROW = {
    id: "user-1",
    email: "user@example.com",
    passwordHash: "hashed",
    role: "professional",
    locale: "en",
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
    emailVerifiedAt: new Date("2026-08-02T00:00:00.000Z"),
  };

  it("resolves the user for a valid, unexpired session", async () => {
    prismaMocks.sessionFindUnique.mockResolvedValue({
      expiresAt: new Date(Date.now() + 60_000),
      user: USER_ROW,
    });

    const result = await findPersistenceUserBySessionToken("valid-token");

    expect(result?.id).toBe("user-1");
    expect(result?.role).toBe("professional");
  });

  it("returns null when the session is expired", async () => {
    prismaMocks.sessionFindUnique.mockResolvedValue({
      expiresAt: new Date(Date.now() - 1000),
      user: USER_ROW,
    });

    const result = await findPersistenceUserBySessionToken("expired-token");

    expect(result).toBeNull();
  });

  it("returns null when no session matches the token", async () => {
    prismaMocks.sessionFindUnique.mockResolvedValue(null);

    const result = await findPersistenceUserBySessionToken("unknown-token");

    expect(result).toBeNull();
  });

  it("returns null when the database is not configured", async () => {
    prismaMocks.configured = false;

    const result = await findPersistenceUserBySessionToken("any-token");

    expect(result).toBeNull();
    expect(prismaMocks.sessionFindUnique).not.toHaveBeenCalled();
  });

  it("returns null (not a throw) when the lookup fails", async () => {
    prismaMocks.sessionFindUnique.mockRejectedValue(new Error("connection reset"));

    const result = await findPersistenceUserBySessionToken("any-token");

    expect(result).toBeNull();
  });
});

describe("resolveAuthenticatedUserFromToken", () => {
  const USER_ROW = {
    id: "user-1",
    email: "user@example.com",
    passwordHash: "hashed",
    role: "professional",
    locale: "en",
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
    emailVerifiedAt: new Date("2026-08-02T00:00:00.000Z"),
  };

  it("resolves a minimal AuthenticatedUser for a valid, unexpired token", async () => {
    prismaMocks.sessionFindUnique.mockResolvedValue({
      expiresAt: new Date(Date.now() + 60_000),
      user: USER_ROW,
    });

    const result = await resolveAuthenticatedUserFromToken("valid-token");

    expect(result).toEqual({
      id: "user-1",
      email: "user@example.com",
      role: "professional",
      locale: "en",
    });
  });

  it("never exposes passwordHash, createdAt, or emailVerifiedAt", async () => {
    prismaMocks.sessionFindUnique.mockResolvedValue({
      expiresAt: new Date(Date.now() + 60_000),
      user: USER_ROW,
    });

    const result = await resolveAuthenticatedUserFromToken("valid-token");

    expect(result).not.toHaveProperty("passwordHash");
    expect(result).not.toHaveProperty("createdAt");
    expect(result).not.toHaveProperty("emailVerifiedAt");
  });

  it("returns null for an unknown token", async () => {
    prismaMocks.sessionFindUnique.mockResolvedValue(null);

    const result = await resolveAuthenticatedUserFromToken("unknown-token");

    expect(result).toBeNull();
  });

  it("returns null for an expired token", async () => {
    prismaMocks.sessionFindUnique.mockResolvedValue({
      expiresAt: new Date(Date.now() - 1000),
      user: USER_ROW,
    });

    const result = await resolveAuthenticatedUserFromToken("expired-token");

    expect(result).toBeNull();
  });

  it("returns null when the database is not configured (fail-closed, no fallback)", async () => {
    prismaMocks.configured = false;

    const result = await resolveAuthenticatedUserFromToken("any-token");

    expect(result).toBeNull();
    expect(prismaMocks.sessionFindUnique).not.toHaveBeenCalled();
  });

  it("returns null (not a throw) when the persistence lookup fails", async () => {
    prismaMocks.sessionFindUnique.mockRejectedValue(new Error("connection reset"));

    const result = await resolveAuthenticatedUserFromToken("any-token");

    expect(result).toBeNull();
  });
});

describe("createPersistenceUserExclusive", () => {
  const INPUT = {
    id: "candidate-id",
    email: "new@example.com",
    passwordHash: "hashed",
    role: "professional" as const,
    locale: "en" as const,
    createdAt: "2026-08-01T00:00:00.000Z",
  };

  it("inserts a brand-new user and returns the id Postgres actually created", async () => {
    prismaMocks.userCreate.mockResolvedValue({ id: "candidate-id" });

    const result = await createPersistenceUserExclusive(INPUT);

    expect(result).toEqual({ status: "created", id: "candidate-id" });
    expect(prismaMocks.userCreate).toHaveBeenCalledWith({
      data: {
        id: "candidate-id",
        email: "new@example.com",
        passwordHash: "hashed",
        role: "professional",
        locale: "en",
        createdAt: new Date("2026-08-01T00:00:00.000Z"),
      },
    });
  });

  it("returns conflict, never throwing, when the email already exists (P2002) -- the existing account is never touched", async () => {
    prismaMocks.userCreate.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("duplicate", { code: "P2002", clientVersion: "test" }),
    );

    const result = await createPersistenceUserExclusive(INPUT);

    expect(result).toEqual({ status: "conflict" });
  });

  it("returns skipped and never calls Postgres when the database is not configured", async () => {
    prismaMocks.configured = false;

    const result = await createPersistenceUserExclusive(INPUT);

    expect(result).toEqual({ status: "skipped" });
    expect(prismaMocks.userCreate).not.toHaveBeenCalled();
  });

  it("throws AuthPersistenceUnavailableError, never a silent success, on a genuine (non-conflict) database failure", async () => {
    prismaMocks.userCreate.mockRejectedValue(new Error("connection reset"));

    await expect(createPersistenceUserExclusive(INPUT)).rejects.toBeInstanceOf(AuthPersistenceUnavailableError);
  });
});
