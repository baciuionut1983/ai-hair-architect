import { randomUUID } from "crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hasRealDatabase = Boolean(process.env.TEST_DATABASE_URL);

const prismaMocks = vi.hoisted(() => ({
  configured: true,
  emailNotificationCreate: vi.fn(),
  emailNotificationFindUniqueOrThrow: vi.fn(),
  emailNotificationUpdate: vi.fn(),
  emailNotificationFindMany: vi.fn(),
}));

vi.mock("@/lib/prisma", async (importOriginal) => {
  if (process.env.TEST_DATABASE_URL) {
    return importOriginal();
  }
  return {
    isDatabaseConfigured: () => prismaMocks.configured,
    prisma: {
      emailNotification: {
        create: prismaMocks.emailNotificationCreate,
        findUniqueOrThrow: prismaMocks.emailNotificationFindUniqueOrThrow,
        update: prismaMocks.emailNotificationUpdate,
        findMany: prismaMocks.emailNotificationFindMany,
      },
    },
  };
});

import { Prisma } from "@prisma/client";

import {
  EmailPersistenceError,
  createPendingEmailNotification,
  isEmailPersistenceError,
  listEmailNotificationsForOwner,
  markEmailNotificationFailed,
  markEmailNotificationSent,
  markEmailNotificationSkipped,
} from "./email-repository";

const unitSuite = hasRealDatabase ? describe.skip : describe;
const integrationSuite = hasRealDatabase ? describe : describe.skip;

function baseInput(overrides: Partial<Parameters<typeof createPendingEmailNotification>[0]> = {}) {
  return {
    ownerUserId: "owner-1",
    category: "onboarding" as const,
    eventType: "user.registered",
    recipientEmail: "user@example.com",
    subject: "Welcome",
    idempotencyKey: "onboarding.welcome:owner-1",
    ...overrides,
  };
}

unitSuite("email-repository (mocked)", () => {
  beforeEach(() => {
    prismaMocks.configured = true;
    prismaMocks.emailNotificationCreate.mockReset();
    prismaMocks.emailNotificationFindUniqueOrThrow.mockReset();
    prismaMocks.emailNotificationUpdate.mockReset();
    prismaMocks.emailNotificationFindMany.mockReset();
  });

  it("creates a pending row with the given fields", async () => {
    const row = { id: "email-1", ...baseInput(), status: "pending" };
    prismaMocks.emailNotificationCreate.mockResolvedValue(row);

    const result = await createPendingEmailNotification(baseInput());

    expect(result).toEqual({ created: true, notification: row });
    expect(prismaMocks.emailNotificationCreate).toHaveBeenCalledWith({
      data: {
        ownerUserId: "owner-1",
        category: "onboarding",
        eventType: "user.registered",
        recipientEmail: "user@example.com",
        subject: "Welcome",
        idempotencyKey: "onboarding.welcome:owner-1",
        relatedEntityType: undefined,
        relatedEntityId: undefined,
      },
    });
  });

  it("returns the existing row with created: false on an idempotencyKey collision, never throwing", async () => {
    const existing = { id: "email-1", ...baseInput(), status: "sent" };
    const conflict = new Prisma.PrismaClientKnownRequestError("duplicate", {
      code: "P2002",
      clientVersion: "test",
    });
    prismaMocks.emailNotificationCreate.mockRejectedValue(conflict);
    prismaMocks.emailNotificationFindUniqueOrThrow.mockResolvedValue(existing);

    const result = await createPendingEmailNotification(baseInput());

    expect(result).toEqual({ created: false, notification: existing });
    expect(prismaMocks.emailNotificationFindUniqueOrThrow).toHaveBeenCalledWith({
      where: { idempotencyKey: "onboarding.welcome:owner-1" },
    });
  });

  it("wraps any other unexpected error into EmailPersistenceError", async () => {
    prismaMocks.emailNotificationCreate.mockRejectedValue(new Error("connection reset"));

    await expect(createPendingEmailNotification(baseInput())).rejects.toBeInstanceOf(EmailPersistenceError);
  });

  it("throws EmailPersistenceError when the database is not configured, never calling prisma", async () => {
    prismaMocks.configured = false;

    await expect(createPendingEmailNotification(baseInput())).rejects.toBeInstanceOf(EmailPersistenceError);
    expect(prismaMocks.emailNotificationCreate).not.toHaveBeenCalled();
  });

  it("marks a notification sent with the real provider message id", async () => {
    await markEmailNotificationSent("email-1", "re_abc123");

    expect(prismaMocks.emailNotificationUpdate).toHaveBeenCalledWith({
      where: { id: "email-1" },
      data: {
        status: "sent",
        providerMessageId: "re_abc123",
        sentAt: expect.any(Date),
        attemptCount: { increment: 1 },
      },
    });
  });

  it("marks a notification failed with a failure code and safe message", async () => {
    await markEmailNotificationFailed("email-1", "EMAIL_PROVIDER_ERROR", "truncated reason");

    expect(prismaMocks.emailNotificationUpdate).toHaveBeenCalledWith({
      where: { id: "email-1" },
      data: {
        status: "failed",
        failureCode: "EMAIL_PROVIDER_ERROR",
        failureMessageSafe: "truncated reason",
        attemptCount: { increment: 1 },
      },
    });
  });

  it("marks a notification skipped", async () => {
    await markEmailNotificationSkipped("email-1");

    expect(prismaMocks.emailNotificationUpdate).toHaveBeenCalledWith({
      where: { id: "email-1" },
      data: { status: "skipped" },
    });
  });

  it("lists notifications for an owner ordered by newest first", async () => {
    prismaMocks.emailNotificationFindMany.mockResolvedValue([]);

    await listEmailNotificationsForOwner("owner-1");

    expect(prismaMocks.emailNotificationFindMany).toHaveBeenCalledWith({
      where: { ownerUserId: "owner-1" },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
  });

  it("isEmailPersistenceError distinguishes this error type from any other", () => {
    expect(isEmailPersistenceError(new EmailPersistenceError())).toBe(true);
    expect(isEmailPersistenceError(new Error("other"))).toBe(false);
  });
});

integrationSuite("email-repository (real Postgres)", () => {
  const owners = new Set<string>();

  afterEach(async () => {
    const { prisma } = await import("@/lib/prisma");
    await prisma.emailNotification.deleteMany({ where: { ownerUserId: { in: [...owners] } } });
    await prisma.user.deleteMany({ where: { id: { in: [...owners] } } });
    owners.clear();
  });

  it("persists a pending row and transitions it to sent", async () => {
    const ownerUserId = await createOwner(owners);
    const created = await createPendingEmailNotification(baseInput({ ownerUserId, idempotencyKey: `test:${randomUUID()}` }));

    expect(created.created).toBe(true);
    expect(created.notification.status).toBe("pending");

    await markEmailNotificationSent(created.notification.id, "re_real_id");

    const { prisma } = await import("@/lib/prisma");
    const row = await prisma.emailNotification.findUniqueOrThrow({ where: { id: created.notification.id } });
    expect(row.status).toBe("sent");
    expect(row.providerMessageId).toBe("re_real_id");
    expect(row.sentAt).not.toBeNull();
    expect(row.attemptCount).toBe(1);
  });

  it("transitions a row to failed with a failure code", async () => {
    const ownerUserId = await createOwner(owners);
    const created = await createPendingEmailNotification(baseInput({ ownerUserId, idempotencyKey: `test:${randomUUID()}` }));

    await markEmailNotificationFailed(created.notification.id, "EMAIL_PROVIDER_TIMEOUT", "timed out");

    const { prisma } = await import("@/lib/prisma");
    const row = await prisma.emailNotification.findUniqueOrThrow({ where: { id: created.notification.id } });
    expect(row.status).toBe("failed");
    expect(row.failureCode).toBe("EMAIL_PROVIDER_TIMEOUT");
    expect(row.failureMessageSafe).toBe("timed out");
  });

  it("transitions a row to skipped", async () => {
    const ownerUserId = await createOwner(owners);
    const created = await createPendingEmailNotification(baseInput({ ownerUserId, idempotencyKey: `test:${randomUUID()}` }));

    await markEmailNotificationSkipped(created.notification.id);

    const { prisma } = await import("@/lib/prisma");
    const row = await prisma.emailNotification.findUniqueOrThrow({ where: { id: created.notification.id } });
    expect(row.status).toBe("skipped");
  });

  it("never creates a second row for the same idempotencyKey, returning the existing one instead", async () => {
    const ownerUserId = await createOwner(owners);
    const idempotencyKey = `test:${randomUUID()}`;

    const first = await createPendingEmailNotification(baseInput({ ownerUserId, idempotencyKey }));
    const second = await createPendingEmailNotification(baseInput({ ownerUserId, idempotencyKey, subject: "Different subject" }));

    expect(first.notification.id).toBe(second.notification.id);
    expect(second.created).toBe(false);

    const { prisma } = await import("@/lib/prisma");
    const count = await prisma.emailNotification.count({ where: { idempotencyKey } });
    expect(count).toBe(1);
  });

  it("fails closed when ownerUserId references no real user (FK enforced)", async () => {
    await expect(
      createPendingEmailNotification(baseInput({ ownerUserId: randomUUID(), idempotencyKey: `test:${randomUUID()}` })),
    ).rejects.toBeInstanceOf(EmailPersistenceError);
  });

  it("blocks deleting a user who still has an email notification row (onDelete: Restrict)", async () => {
    const ownerUserId = await createOwner(owners);
    await createPendingEmailNotification(baseInput({ ownerUserId, idempotencyKey: `test:${randomUUID()}` }));

    const { prisma } = await import("@/lib/prisma");
    await expect(prisma.user.delete({ where: { id: ownerUserId } })).rejects.toBeTruthy();
  });

  it("lists only the requesting owner's notifications, newest first", async () => {
    const ownerA = await createOwner(owners);
    const ownerB = await createOwner(owners);
    await createPendingEmailNotification(baseInput({ ownerUserId: ownerA, idempotencyKey: `test:${randomUUID()}` }));
    await createPendingEmailNotification(baseInput({ ownerUserId: ownerB, idempotencyKey: `test:${randomUUID()}` }));

    const listForA = await listEmailNotificationsForOwner(ownerA);
    expect(listForA).toHaveLength(1);
    expect(listForA[0].ownerUserId).toBe(ownerA);
  });
});

async function createOwner(owners: Set<string>): Promise<string> {
  const { prisma } = await import("@/lib/prisma");
  const ownerUserId = randomUUID();
  owners.add(ownerUserId);
  await prisma.user.create({
    data: {
      id: ownerUserId,
      email: `${ownerUserId}@email-repository.test`,
      passwordHash: "test",
      role: "professional",
      locale: "en",
    },
  });
  return ownerUserId;
}
