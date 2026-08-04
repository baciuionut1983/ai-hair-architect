import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMocks = vi.hoisted(() => ({
  configured: true,
  userFindUnique: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  isDatabaseConfigured: () => prismaMocks.configured,
  prisma: {
    user: {
      findUnique: prismaMocks.userFindUnique,
    },
  },
}));

import {
  AuthPersistenceUnavailableError,
  findEmailVerifiedAtForUser,
  findPersistenceUserByEmail,
  isAuthPersistenceUnavailableError,
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
