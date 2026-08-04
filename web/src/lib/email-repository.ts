import { Prisma, type EmailCategory, type EmailNotification } from "@prisma/client";

import { isDatabaseConfigured, prisma } from "@/lib/prisma";

export const EMAIL_PERSISTENCE_ERROR_CODE = "EMAIL_PERSISTENCE_UNAVAILABLE";

export class EmailPersistenceError extends Error {
  readonly code = EMAIL_PERSISTENCE_ERROR_CODE;
  readonly httpStatus = 503;

  constructor() {
    super("Email notification data is temporarily unavailable.");
    this.name = "EmailPersistenceError";
  }
}

export interface CreatePendingEmailInput {
  ownerUserId: string;
  category: EmailCategory;
  eventType: string;
  recipientEmail: string;
  subject: string;
  idempotencyKey: string;
  relatedEntityType?: string;
  relatedEntityId?: string;
}

export interface CreatePendingEmailResult {
  created: boolean;
  notification: EmailNotification;
}

/**
 * Creates the durable "intent to send" row. If idempotencyKey already
 * exists (a concurrent or repeated call for the exact same event), this
 * never creates a second row and never throws for that reason -- it
 * returns the existing row with created: false so the caller can skip
 * attempting delivery again.
 */
export async function createPendingEmailNotification(
  input: CreatePendingEmailInput,
): Promise<CreatePendingEmailResult> {
  return runEmailQuery(async () => {
    try {
      const notification = await prisma.emailNotification.create({
        data: {
          ownerUserId: input.ownerUserId,
          category: input.category,
          eventType: input.eventType,
          recipientEmail: input.recipientEmail,
          subject: input.subject,
          idempotencyKey: input.idempotencyKey,
          relatedEntityType: input.relatedEntityType,
          relatedEntityId: input.relatedEntityId,
        },
      });
      return { created: true, notification };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const existing = await prisma.emailNotification.findUniqueOrThrow({
          where: { idempotencyKey: input.idempotencyKey },
        });
        return { created: false, notification: existing };
      }
      throw error;
    }
  });
}

export async function markEmailNotificationSent(
  id: string,
  providerMessageId: string,
  sentAt: Date = new Date(),
): Promise<void> {
  return runEmailQuery(async () => {
    await prisma.emailNotification.update({
      where: { id },
      data: {
        status: "sent",
        providerMessageId,
        sentAt,
        attemptCount: { increment: 1 },
      },
    });
  });
}

export async function markEmailNotificationFailed(
  id: string,
  failureCode: string,
  failureMessageSafe?: string,
): Promise<void> {
  return runEmailQuery(async () => {
    await prisma.emailNotification.update({
      where: { id },
      data: {
        status: "failed",
        failureCode,
        failureMessageSafe,
        attemptCount: { increment: 1 },
      },
    });
  });
}

export async function markEmailNotificationSkipped(id: string): Promise<void> {
  return runEmailQuery(async () => {
    await prisma.emailNotification.update({
      where: { id },
      data: { status: "skipped" },
    });
  });
}

export async function listEmailNotificationsForOwner(ownerUserId: string): Promise<EmailNotification[]> {
  return runEmailQuery(() =>
    prisma.emailNotification.findMany({
      where: { ownerUserId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    }),
  );
}

/**
 * Resolves the real recipient address for a trigger that only has an
 * ownerUserId in hand (the appointment reminder flow, the billing webhook
 * processor). Kept here rather than duplicated as a raw prisma.user call
 * in each caller, matching this codebase's one-repository-per-concern
 * convention. Returns null if the user no longer exists (defensive only --
 * onDelete: Restrict on every owned model makes this practically
 * unreachable today).
 */
export async function findRecipientEmailForOwner(ownerUserId: string): Promise<string | null> {
  return runEmailQuery(async () => {
    const user = await prisma.user.findUnique({ where: { id: ownerUserId }, select: { email: true } });
    return user?.email ?? null;
  });
}

export function isEmailPersistenceError(error: unknown): error is EmailPersistenceError {
  return error instanceof EmailPersistenceError;
}

async function runEmailQuery<T>(operation: () => Promise<T>): Promise<T> {
  if (!isDatabaseConfigured()) throw new EmailPersistenceError();

  try {
    return await operation();
  } catch (error) {
    if (error instanceof EmailPersistenceError) throw error;
    throw new EmailPersistenceError();
  }
}
