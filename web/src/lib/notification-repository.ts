import { Prisma, type Notification as PrismaNotificationRow } from "@prisma/client";

import type { NotificationRecord, ReminderType } from "@/lib/contracts";
import { isDatabaseConfigured, prisma } from "@/lib/prisma";

export const NOTIFICATION_PERSISTENCE_ERROR_CODE = "NOTIFICATION_PERSISTENCE_UNAVAILABLE";

const NOTIFICATION_TYPES = ["appointment", "follow_up", "maintenance"] as const;

export type NotificationDb = Pick<Prisma.TransactionClient, "notification">;

export class NotificationPersistenceError extends Error {
  readonly code = NOTIFICATION_PERSISTENCE_ERROR_CODE;
  readonly httpStatus = 503;

  constructor() {
    super("Notification data is temporarily unavailable.");
    this.name = "NotificationPersistenceError";
  }
}

export async function listNotificationsForOwner(ownerUserId: string): Promise<NotificationRecord[]> {
  return runNotificationQuery(async () => {
    const rows = await prisma.notification.findMany({
      where: { ownerUserId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    return rows.map(toNotificationRecord);
  });
}

export async function markNotificationsReadForOwner(
  ownerUserId: string,
  notificationIds?: string[],
  now: Date = new Date(),
): Promise<number> {
  return runNotificationQuery(async () => {
    if (!isValidDate(now)) throw new NotificationPersistenceError();

    const updated = await prisma.notification.updateMany({
      where: {
        ownerUserId,
        readAt: null,
        ...(notificationIds ? { id: { in: notificationIds } } : {}),
      },
      data: { readAt: now },
    });
    return updated.count;
  });
}

export async function countNotificationsForOwner(
  ownerUserId: string,
  db: NotificationDb = prisma,
): Promise<number> {
  return runNotificationQuery(() => db.notification.count({ where: { ownerUserId } }));
}

export async function countAllNotifications(): Promise<number> {
  return runNotificationQuery(() => prisma.notification.count());
}

export function isNotificationPersistenceError(error: unknown): error is NotificationPersistenceError {
  return error instanceof NotificationPersistenceError;
}

export function notificationPersistenceUnavailableResponse(): Response {
  return Response.json(
    { error: NOTIFICATION_PERSISTENCE_ERROR_CODE, message: "Notification data is temporarily unavailable." },
    { status: 503, headers: { "Cache-Control": "no-store" } },
  );
}

function toNotificationRecord(row: PrismaNotificationRow): NotificationRecord {
  if (
    !isNotificationType(row.type) ||
    !isValidDate(row.createdAt) ||
    (row.readAt !== null && !isValidDate(row.readAt))
  ) {
    throw new NotificationPersistenceError();
  }

  return {
    id: row.id,
    ownerUserId: row.ownerUserId,
    type: row.type,
    title: row.title,
    message: row.message,
    relatedClientId: row.relatedClientId,
    relatedAppointmentId: row.relatedAppointmentId,
    createdAt: row.createdAt.toISOString(),
    readAt: row.readAt?.toISOString() ?? null,
  };
}

async function runNotificationQuery<T>(operation: () => Promise<T>): Promise<T> {
  if (!isDatabaseConfigured()) throw new NotificationPersistenceError();

  try {
    return await operation();
  } catch (error) {
    if (error instanceof NotificationPersistenceError) throw error;
    throw new NotificationPersistenceError();
  }
}

function isNotificationType(value: string): value is ReminderType {
  return (NOTIFICATION_TYPES as readonly string[]).includes(value);
}

function isValidDate(value: Date): boolean {
  return Number.isFinite(value.getTime());
}
