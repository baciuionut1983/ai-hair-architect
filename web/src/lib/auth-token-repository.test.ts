import { randomUUID } from "crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hasRealDatabase = Boolean(process.env.TEST_DATABASE_URL);

const prismaMocks = vi.hoisted(() => ({
  configured: true,
  transaction: vi.fn(),
  authTokenDeleteMany: vi.fn(),
  authTokenCreate: vi.fn(),
  authTokenFindUnique: vi.fn(),
  authTokenUpdateMany: vi.fn(),
}));

vi.mock("@/lib/prisma", async (importOriginal) => {
  if (process.env.TEST_DATABASE_URL) {
    return importOriginal();
  }
  return {
    isDatabaseConfigured: () => prismaMocks.configured,
    prisma: {
      $transaction: prismaMocks.transaction,
      authToken: {
        deleteMany: prismaMocks.authTokenDeleteMany,
        create: prismaMocks.authTokenCreate,
        findUnique: prismaMocks.authTokenFindUnique,
        updateMany: prismaMocks.authTokenUpdateMany,
      },
    },
  };
});

import {
  AuthTokenPersistenceError,
  claimAuthToken,
  findValidAuthToken,
  hashAuthToken,
  isAuthTokenPersistenceError,
  issueAuthToken,
} from "./auth-token-repository";

const tx = {
  authToken: {
    deleteMany: prismaMocks.authTokenDeleteMany,
    create: prismaMocks.authTokenCreate,
  },
};

const unitSuite = hasRealDatabase ? describe.skip : describe;
const integrationSuite = hasRealDatabase ? describe : describe.skip;

unitSuite("auth-token-repository (mocked)", () => {
  beforeEach(() => {
    prismaMocks.configured = true;
    prismaMocks.transaction.mockReset();
    prismaMocks.authTokenDeleteMany.mockReset();
    prismaMocks.authTokenCreate.mockReset();
    prismaMocks.authTokenFindUnique.mockReset();
    prismaMocks.authTokenUpdateMany.mockReset();
    prismaMocks.transaction.mockImplementation(async (operation) => operation(tx));
  });

  it("deletes any prior unused token for the same user+purpose before creating the new one", async () => {
    prismaMocks.authTokenDeleteMany.mockResolvedValue({ count: 1 });
    prismaMocks.authTokenCreate.mockResolvedValue({ id: "token-1" });

    const now = new Date("2026-08-05T10:00:00.000Z");
    const result = await issueAuthToken("owner-1", "email_verification", 60_000, now);

    expect(prismaMocks.authTokenDeleteMany).toHaveBeenCalledWith({
      where: { userId: "owner-1", purpose: "email_verification", usedAt: null },
    });
    expect(prismaMocks.authTokenCreate).toHaveBeenCalledWith({
      data: {
        userId: "owner-1",
        purpose: "email_verification",
        tokenHash: expect.any(String),
        expiresAt: new Date(now.getTime() + 60_000),
      },
    });
    expect(result.tokenId).toBe("token-1");
    expect(result.rawToken).toMatch(/^[0-9a-f]{64}$/);
    expect(result.expiresAt).toEqual(new Date(now.getTime() + 60_000));
  });

  it("never persists the raw token -- only its SHA-256 hash is written", async () => {
    prismaMocks.authTokenDeleteMany.mockResolvedValue({ count: 0 });
    prismaMocks.authTokenCreate.mockResolvedValue({ id: "token-1" });

    const result = await issueAuthToken("owner-1", "password_reset", 60_000);

    const persistedHash = prismaMocks.authTokenCreate.mock.calls[0][0].data.tokenHash;
    expect(persistedHash).toBe(hashAuthToken(result.rawToken));
    expect(persistedHash).not.toBe(result.rawToken);
  });

  it("throws AuthTokenPersistenceError when the database is not configured, never calling prisma", async () => {
    prismaMocks.configured = false;

    await expect(issueAuthToken("owner-1", "email_verification", 60_000)).rejects.toBeInstanceOf(
      AuthTokenPersistenceError,
    );
    expect(prismaMocks.transaction).not.toHaveBeenCalled();
  });

  it("findValidAuthToken returns null when no row matches the hash", async () => {
    prismaMocks.authTokenFindUnique.mockResolvedValue(null);

    await expect(findValidAuthToken("raw-token", "email_verification")).resolves.toBeNull();
  });

  it("findValidAuthToken returns null for a purpose mismatch (verification token can never validate for reset)", async () => {
    prismaMocks.authTokenFindUnique.mockResolvedValue({
      id: "token-1",
      userId: "owner-1",
      purpose: "email_verification",
      usedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    });

    await expect(findValidAuthToken("raw-token", "password_reset")).resolves.toBeNull();
  });

  it("findValidAuthToken returns null for an already-used token", async () => {
    prismaMocks.authTokenFindUnique.mockResolvedValue({
      id: "token-1",
      userId: "owner-1",
      purpose: "email_verification",
      usedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
    });

    await expect(findValidAuthToken("raw-token", "email_verification")).resolves.toBeNull();
  });

  it("findValidAuthToken returns null for an expired token", async () => {
    const now = new Date("2026-08-05T10:00:00.000Z");
    prismaMocks.authTokenFindUnique.mockResolvedValue({
      id: "token-1",
      userId: "owner-1",
      purpose: "email_verification",
      usedAt: null,
      expiresAt: new Date(now.getTime() - 1),
    });

    await expect(findValidAuthToken("raw-token", "email_verification", now)).resolves.toBeNull();
  });

  it("findValidAuthToken returns the token when every condition matches", async () => {
    const now = new Date("2026-08-05T10:00:00.000Z");
    prismaMocks.authTokenFindUnique.mockResolvedValue({
      id: "token-1",
      userId: "owner-1",
      purpose: "email_verification",
      usedAt: null,
      expiresAt: new Date(now.getTime() + 1),
    });

    await expect(findValidAuthToken("raw-token", "email_verification", now)).resolves.toEqual({
      id: "token-1",
      userId: "owner-1",
      purpose: "email_verification",
    });
  });

  it("claimAuthToken returns true on a successful atomic claim", async () => {
    prismaMocks.authTokenUpdateMany.mockResolvedValue({ count: 1 });

    await expect(claimAuthToken("token-1", "password_reset")).resolves.toBe(true);
    expect(prismaMocks.authTokenUpdateMany).toHaveBeenCalledWith({
      where: { id: "token-1", purpose: "password_reset", usedAt: null },
      data: { usedAt: expect.any(Date) },
    });
  });

  it("claimAuthToken returns false when the token was already claimed (lost race or reuse attempt)", async () => {
    prismaMocks.authTokenUpdateMany.mockResolvedValue({ count: 0 });

    await expect(claimAuthToken("token-1", "password_reset")).resolves.toBe(false);
  });

  it("claimAuthToken accepts a caller-supplied transaction client for atomic composition", async () => {
    const callerTx = { authToken: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) } };

    await expect(
      claimAuthToken("token-1", "email_verification", new Date(), callerTx as never),
    ).resolves.toBe(true);
    expect(callerTx.authToken.updateMany).toHaveBeenCalled();
    expect(prismaMocks.authTokenUpdateMany).not.toHaveBeenCalled();
  });

  it("isAuthTokenPersistenceError distinguishes this error type from any other", () => {
    expect(isAuthTokenPersistenceError(new AuthTokenPersistenceError())).toBe(true);
    expect(isAuthTokenPersistenceError(new Error("other"))).toBe(false);
  });
});

integrationSuite("auth-token-repository (real Postgres)", () => {
  const owners = new Set<string>();

  afterEach(async () => {
    const { prisma } = await import("@/lib/prisma");
    await prisma.authToken.deleteMany({ where: { userId: { in: [...owners] } } });
    await prisma.user.deleteMany({ where: { id: { in: [...owners] } } });
    owners.clear();
  });

  it("issues a token, finds it valid, then claims it exactly once", async () => {
    const ownerUserId = await createOwner(owners);
    const issued = await issueAuthToken(ownerUserId, "email_verification", 60_000);

    const valid = await findValidAuthToken(issued.rawToken, "email_verification");
    expect(valid).toEqual({ id: issued.tokenId, userId: ownerUserId, purpose: "email_verification" });

    await expect(claimAuthToken(issued.tokenId, "email_verification")).resolves.toBe(true);
    await expect(claimAuthToken(issued.tokenId, "email_verification")).resolves.toBe(false);
    await expect(findValidAuthToken(issued.rawToken, "email_verification")).resolves.toBeNull();
  });

  it("issuing a second token for the same user+purpose invalidates the first", async () => {
    const ownerUserId = await createOwner(owners);
    const first = await issueAuthToken(ownerUserId, "password_reset", 60_000);
    const second = await issueAuthToken(ownerUserId, "password_reset", 60_000);

    expect(first.tokenId).not.toBe(second.tokenId);
    await expect(findValidAuthToken(first.rawToken, "password_reset")).resolves.toBeNull();
    await expect(findValidAuthToken(second.rawToken, "password_reset")).resolves.not.toBeNull();

    const { prisma } = await import("@/lib/prisma");
    const count = await prisma.authToken.count({ where: { userId: ownerUserId, purpose: "password_reset" } });
    expect(count).toBe(1);
  });

  it("keeps email_verification and password_reset tokens fully independent for the same user", async () => {
    const ownerUserId = await createOwner(owners);
    const verify = await issueAuthToken(ownerUserId, "email_verification", 60_000);
    const reset = await issueAuthToken(ownerUserId, "password_reset", 60_000);

    await expect(findValidAuthToken(verify.rawToken, "email_verification")).resolves.not.toBeNull();
    await expect(findValidAuthToken(reset.rawToken, "password_reset")).resolves.not.toBeNull();
    // Cross-purpose validation must fail even for the correct raw token.
    await expect(findValidAuthToken(verify.rawToken, "password_reset")).resolves.toBeNull();
    await expect(findValidAuthToken(reset.rawToken, "email_verification")).resolves.toBeNull();
  });

  it("returns null for an expired token", async () => {
    const ownerUserId = await createOwner(owners);
    const issued = await issueAuthToken(ownerUserId, "password_reset", 1);

    await new Promise((resolve) => setTimeout(resolve, 5));

    await expect(findValidAuthToken(issued.rawToken, "password_reset")).resolves.toBeNull();
  });

  it("claimAuthToken composes atomically inside a caller transaction: a failed follow-up write rolls back the claim", async () => {
    const ownerUserId = await createOwner(owners);
    const issued = await issueAuthToken(ownerUserId, "email_verification", 60_000);
    const { prisma } = await import("@/lib/prisma");

    await expect(
      prisma.$transaction(async (tx) => {
        const claimed = await claimAuthToken(issued.tokenId, "email_verification", new Date(), tx);
        expect(claimed).toBe(true);
        throw new Error("simulated downstream failure after the claim");
      }),
    ).rejects.toThrow("simulated downstream failure");

    // The transaction rolled back -- the token must still be valid/unused,
    // never left in a "claimed but nothing happened" state.
    await expect(findValidAuthToken(issued.rawToken, "email_verification")).resolves.not.toBeNull();
  });

  it("fails closed when userId references no real user (FK enforced)", async () => {
    await expect(issueAuthToken(randomUUID(), "email_verification", 60_000)).rejects.toBeInstanceOf(
      AuthTokenPersistenceError,
    );
  });

  it("deleting a user cascades to their auth tokens (onDelete: Cascade)", async () => {
    const ownerUserId = await createOwner(owners);
    await issueAuthToken(ownerUserId, "email_verification", 60_000);

    const { prisma } = await import("@/lib/prisma");
    await prisma.user.delete({ where: { id: ownerUserId } });
    owners.delete(ownerUserId);

    await expect(prisma.authToken.count({ where: { userId: ownerUserId } })).resolves.toBe(0);
  });
});

async function createOwner(owners: Set<string>): Promise<string> {
  const { prisma } = await import("@/lib/prisma");
  const ownerUserId = randomUUID();
  owners.add(ownerUserId);
  await prisma.user.create({
    data: {
      id: ownerUserId,
      email: `${ownerUserId}@auth-token.test`,
      passwordHash: "test",
      role: "professional",
      locale: "en",
    },
  });
  return ownerUserId;
}
