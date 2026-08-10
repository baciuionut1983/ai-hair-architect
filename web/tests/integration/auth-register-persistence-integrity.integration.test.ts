import { randomUUID } from "crypto";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { POST as registerRoute } from "@/app/api/v1/auth/register/route";
import { store } from "@/lib/milestone1-store";
import { isDatabaseConfigured, prisma } from "@/lib/prisma";

function post(body: unknown): Promise<Response> {
  return registerRoute(
    new Request("http://localhost/api/v1/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

describe("register persistence integrity (AuthToken FK / account-takeover regression)", () => {
  const testEmails: string[] = [];

  beforeEach(() => {
    // A fresh, empty in-memory store on every test, exactly like a cold
    // Railway process right after a restart/redeploy.
    store.users.length = 0;
  });

  afterEach(async () => {
    store.users.length = 0;

    if (!isDatabaseConfigured()) return;
    if (testEmails.length > 0) {
      const users = await prisma.user.findMany({ where: { email: { in: testEmails } }, select: { id: true } });
      const userIds = users.map((entry) => entry.id);
      if (userIds.length > 0) {
        // EmailNotification.ownerUserId uses onDelete: Restrict, unlike
        // AuthToken (Cascade) -- it must be cleared explicitly first, or the
        // User delete below is blocked by EmailNotification_ownerUserId_fkey.
        await prisma.emailNotification.deleteMany({ where: { ownerUserId: { in: userIds } } });
      }
      await prisma.user.deleteMany({ where: { email: { in: testEmails } } });
    }
    testEmails.length = 0;
  });

  it("creates a genuinely new user whose AuthToken.userId matches the real Postgres User.id", async () => {
    if (!isDatabaseConfigured()) return;
    const email = `register-integrity-${randomUUID()}@example.com`;
    testEmails.push(email);

    const response = await post({ email, password: "password123", role: "professional", locale: "en" });
    expect(response.status).toBe(201);

    const user = await prisma.user.findUnique({ where: { email } });
    expect(user).not.toBeNull();

    const token = await prisma.authToken.findFirst({ where: { userId: user!.id, purpose: "email_verification" } });
    expect(token).not.toBeNull();
    expect(token!.userId).toBe(user!.id);
  });

  it("returns 409 and never overwrites the existing passwordHash when re-registering an email that exists in Postgres but not in the cold in-memory store", async () => {
    if (!isDatabaseConfigured()) return;
    const email = `register-integrity-cold-${randomUUID()}@example.com`;
    testEmails.push(email);

    // Simulate an account created in an EARLIER process (e.g. before a
    // Railway restart) -- inserted directly via Prisma, never through the
    // in-memory store, so store.users has no record of it.
    const original = await prisma.user.create({
      data: {
        id: randomUUID(),
        email,
        passwordHash: "original-hash-should-survive",
        role: "professional",
        locale: "en",
      },
    });
    expect(store.users.find((entry) => entry.email === email)).toBeUndefined();

    const response = await post({ email, password: "attacker-chosen-password", role: "professional", locale: "en" });
    expect(response.status).toBe(409);

    const after = await prisma.user.findUnique({ where: { id: original.id } });
    expect(after?.passwordHash).toBe("original-hash-should-survive");

    // The 409 path must never reach issueAuthToken -- no token should exist
    // for this user at all after a rejected re-registration attempt.
    const tokensForThisUser = await prisma.authToken.findMany({ where: { userId: original.id } });
    expect(tokensForThisUser.length).toBe(0);
  });

  it("under two concurrent registrations for the same brand-new email, exactly one succeeds and no AuthToken references a non-existent userId", async () => {
    if (!isDatabaseConfigured()) return;
    const email = `register-integrity-race-${randomUUID()}@example.com`;
    testEmails.push(email);

    const [responseA, responseB] = await Promise.all([
      post({ email, password: "password-a-123", role: "professional", locale: "en" }),
      post({ email, password: "password-b-456", role: "professional", locale: "en" }),
    ]);

    const statuses = [responseA.status, responseB.status].sort();
    expect(statuses).toEqual([201, 409]);

    const users = await prisma.user.findMany({ where: { email } });
    expect(users.length).toBe(1);

    const tokens = await prisma.authToken.findMany({ where: { userId: users[0].id } });
    expect(tokens.length).toBe(1);
    expect(tokens[0].purpose).toBe("email_verification");
  });
});
