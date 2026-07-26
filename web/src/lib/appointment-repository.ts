import {
  AppointmentReminderType,
  Prisma,
  type Appointment as PrismaAppointmentRow,
} from "@prisma/client";

import type { AppointmentRecord, ReminderType } from "@/lib/contracts";
import { isDatabaseConfigured, prisma } from "@/lib/prisma";

export const APPOINTMENT_PERSISTENCE_ERROR_CODE = "APPOINTMENT_PERSISTENCE_UNAVAILABLE";

const REMINDER_TYPES = ["appointment", "follow_up", "maintenance"] as const;
const MAX_REMINDER_CANDIDATES = 100;
const MAX_REMINDER_TRANSACTION_ATTEMPTS = 3;

type AppointmentTransaction = Pick<Prisma.TransactionClient, "appointment" | "client" | "notification">;
export type AppointmentDb = Pick<Prisma.TransactionClient, "appointment">;

interface DueAppointmentCandidate {
  id: string;
  ownerUserId: string;
  clientId: string;
  title: string;
  startsAt: Date;
  reminderType: AppointmentReminderType;
}

export interface AppointmentCreateInput {
  clientId: string;
  title: string;
  startsAt: Date;
  reminderMinutesBefore: number;
  reminderType: ReminderType;
  notes: string;
}

export class AppointmentPersistenceError extends Error {
  readonly code = APPOINTMENT_PERSISTENCE_ERROR_CODE;
  readonly httpStatus = 503;

  constructor() {
    super("Appointment data is temporarily unavailable.");
    this.name = "AppointmentPersistenceError";
  }
}

export class AppointmentDependencyError extends Error {
  constructor(
    readonly code: "APPOINTMENT_CLIENT_NOT_FOUND" | "APPOINTMENT_DEPENDENCY_CHANGED",
    readonly httpStatus: 404 | 409,
    message: string,
  ) {
    super(message);
    this.name = "AppointmentDependencyError";
  }
}

export class AppointmentConcurrencyError extends Error {
  readonly code = "APPOINTMENT_CONCURRENCY_CONFLICT";
  readonly httpStatus = 409;

  constructor() {
    super("Appointment reminder could not be created because of concurrent changes.");
    this.name = "AppointmentConcurrencyError";
  }
}

export async function createAppointmentForOwner(
  ownerUserId: string,
  input: AppointmentCreateInput,
): Promise<AppointmentRecord> {
  return runAppointmentQuery(() => prisma.$transaction(async (tx: AppointmentTransaction) => {
    const client = await tx.client.findFirst({
      where: { id: input.clientId, ownerUserId, deletedAt: null },
      select: { id: true },
    });
    if (!client) {
      throw new AppointmentDependencyError("APPOINTMENT_CLIENT_NOT_FOUND", 404, "Client not found.");
    }

    return toAppointmentRecord(await tx.appointment.create({
      data: {
        ownerUserId,
        clientId: client.id,
        title: input.title,
        startsAt: input.startsAt,
        reminderMinutesBefore: input.reminderMinutesBefore,
        reminderType: toPrismaReminderType(input.reminderType),
        notes: input.notes,
      },
    }));
  }));
}

export async function listAppointmentsForOwner(
  ownerUserId: string,
  clientId?: string,
): Promise<AppointmentRecord[]> {
  return runAppointmentQuery(async () => {
    const rows = await prisma.appointment.findMany({
      where: {
        ownerUserId,
        ...(clientId ? { clientId } : {}),
        client: { deletedAt: null },
      },
      orderBy: [{ startsAt: "asc" }, { id: "asc" }],
    });
    return rows.map(toAppointmentRecord);
  });
}

export async function countAppointmentsForOwner(
  ownerUserId: string,
  db: AppointmentDb = prisma,
): Promise<number> {
  return runAppointmentQuery(() => db.appointment.count({ where: { ownerUserId } }));
}

export async function countAllAppointments(): Promise<number> {
  return runAppointmentQuery(() => prisma.appointment.count());
}

export async function countSentRemindersForOwner(ownerUserId: string): Promise<number> {
  return runAppointmentQuery(() => prisma.appointment.count({
    where: { ownerUserId, reminderSentAt: { not: null } },
  }));
}

export async function executeDueAppointmentRemindersForOwner(
  ownerUserId: string,
  now: Date = new Date(),
): Promise<{ remindersCreated: number }> {
  return runAppointmentQuery(async () => {
    if (!isValidDate(now)) throw new AppointmentPersistenceError();

    const candidates = await prisma.$queryRaw<DueAppointmentCandidate[]>(Prisma.sql`
      SELECT
        "id",
        "ownerUserId",
        "clientId",
        "title",
        "startsAt",
        "reminderType"
      FROM "Appointment"
      WHERE "ownerUserId" = ${ownerUserId}
        AND "reminderSentAt" IS NULL
        AND "startsAt" - ("reminderMinutesBefore" * INTERVAL '1 minute') <= ${now}
      ORDER BY "startsAt" ASC, "id" ASC
      LIMIT ${MAX_REMINDER_CANDIDATES}
    `);

    let remindersCreated = 0;
    for (const candidate of candidates) {
      assertDueAppointmentCandidate(candidate, ownerUserId);
      remindersCreated += await createReminderForCandidate(candidate, now);
    }
    return { remindersCreated };
  });
}

export function isAppointmentPersistenceError(error: unknown): error is AppointmentPersistenceError {
  return error instanceof AppointmentPersistenceError;
}

export function appointmentPersistenceUnavailableResponse(): Response {
  return Response.json(
    { error: APPOINTMENT_PERSISTENCE_ERROR_CODE, message: "Appointment data is temporarily unavailable." },
    { status: 503, headers: { "Cache-Control": "no-store" } },
  );
}

function toAppointmentRecord(row: PrismaAppointmentRow): AppointmentRecord {
  if (
    !isReminderType(row.reminderType) ||
    !isValidDate(row.startsAt) ||
    !isValidDate(row.createdAt) ||
    (row.reminderSentAt !== null && !isValidDate(row.reminderSentAt)) ||
    !Number.isInteger(row.reminderMinutesBefore) ||
    row.reminderMinutesBefore < 1 ||
    row.reminderMinutesBefore > 525600
  ) {
    throw new AppointmentPersistenceError();
  }

  return {
    id: row.id,
    ownerUserId: row.ownerUserId,
    clientId: row.clientId,
    title: row.title,
    startsAt: row.startsAt.toISOString(),
    reminderMinutesBefore: row.reminderMinutesBefore,
    reminderType: row.reminderType,
    reminderSentAt: row.reminderSentAt?.toISOString() ?? null,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
  };
}

async function runAppointmentQuery<T>(operation: () => Promise<T>): Promise<T> {
  if (!isDatabaseConfigured()) throw new AppointmentPersistenceError();

  try {
    return await operation();
  } catch (error) {
    if (
      error instanceof AppointmentPersistenceError ||
      error instanceof AppointmentDependencyError ||
      error instanceof AppointmentConcurrencyError
    ) {
      throw error;
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") {
      throw new AppointmentDependencyError(
        "APPOINTMENT_DEPENDENCY_CHANGED",
        409,
        "Appointment dependencies changed.",
      );
    }
    throw new AppointmentPersistenceError();
  }
}

async function createReminderForCandidate(
  candidate: DueAppointmentCandidate,
  now: Date,
): Promise<number> {
  return runSerializableReminderTransaction(async (tx) => {
    const claimed = await tx.appointment.updateMany({
      where: {
        id: candidate.id,
        ownerUserId: candidate.ownerUserId,
        reminderSentAt: null,
      },
      data: { reminderSentAt: now },
    });
    if (claimed.count !== 1) return 0;

    await tx.notification.create({
      data: {
        ownerUserId: candidate.ownerUserId,
        type: candidate.reminderType,
        title: `Reminder: ${candidate.title}`,
        message: `Upcoming ${candidate.reminderType.replace("_", " ")} at ${candidate.startsAt.toISOString()}`,
        relatedClientId: candidate.clientId,
        relatedAppointmentId: candidate.id,
        createdAt: now,
      },
    });
    return 1;
  });
}

async function runSerializableReminderTransaction<T>(
  operation: (tx: AppointmentTransaction) => Promise<T>,
): Promise<T> {
  for (let attempt = 1; attempt <= MAX_REMINDER_TRANSACTION_ATTEMPTS; attempt += 1) {
    try {
      return await prisma.$transaction(operation, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error) {
      if (!isRetryableConcurrencyError(error)) throw error;
      if (attempt === MAX_REMINDER_TRANSACTION_ATTEMPTS) throw new AppointmentConcurrencyError();
    }
  }

  throw new AppointmentConcurrencyError();
}

function assertDueAppointmentCandidate(
  candidate: DueAppointmentCandidate,
  ownerUserId: string,
): void {
  if (
    candidate.ownerUserId !== ownerUserId ||
    !candidate.id ||
    !candidate.clientId ||
    !candidate.title ||
    !isReminderType(candidate.reminderType) ||
    !isValidDate(candidate.startsAt)
  ) {
    throw new AppointmentPersistenceError();
  }
}

function isRetryableConcurrencyError(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) return error.code === "P2034";
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return message.includes("deadlock") || message.includes("serialization");
}

function toPrismaReminderType(value: ReminderType): AppointmentReminderType {
  return value;
}

function isReminderType(value: string): value is ReminderType {
  return (REMINDER_TYPES as readonly string[]).includes(value);
}

function isValidDate(value: Date): boolean {
  return Number.isFinite(value.getTime());
}
