import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createPersistenceSession, revokePersistenceSessionToken } from "@/lib/auth-persistence";
import { createSession, revokeSessionToken, store } from "@/lib/milestone1-store";
import { isDatabaseConfigured, prisma } from "@/lib/prisma";

describe("auth session revocation integration", () => {
  const userId = `int-auth-user-${Date.now()}`;
  const userEmail = `int-auth-${Date.now()}@example.com`;

  beforeEach(async () => {
    store.sessions.clear();

    if (!isDatabaseConfigured()) {
      return;
    }

    await prisma.session.deleteMany({ where: { token: { startsWith: "int-auth-token-" } } });
    await prisma.user.deleteMany({ where: { id: userId } });

    await prisma.user.create({
      data: {
        id: userId,
        email: userEmail,
        passwordHash: "hash",
        role: "professional",
        locale: "en",
      },
    });
  });

  afterEach(async () => {
    store.sessions.clear();

    if (!isDatabaseConfigured()) {
      return;
    }

    await prisma.session.deleteMany({ where: { token: { startsWith: "int-auth-token-" } } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("revokes only the current in-memory session token", () => {
    const currentToken = createSession(userId);
    const otherToken = createSession(userId);

    expect(revokeSessionToken(currentToken)).toBe(true);
    expect(store.sessions.has(currentToken)).toBe(false);
    expect(store.sessions.has(otherToken)).toBe(true);
  });

  it("revokes only the current persisted session token", async () => {
    if (!isDatabaseConfigured()) {
      return;
    }

    const currentToken = `int-auth-token-current-${Date.now()}`;
    const otherToken = `int-auth-token-other-${Date.now()}`;
    await createPersistenceSession(currentToken, userId);
    await createPersistenceSession(otherToken, userId);

    await revokePersistenceSessionToken(currentToken);

    const current = await prisma.session.findUnique({ where: { token: currentToken } });
    const other = await prisma.session.findUnique({ where: { token: otherToken } });
    expect(current).toBeNull();
    expect(other).not.toBeNull();
  });
});