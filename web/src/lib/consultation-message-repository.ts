import { randomUUID } from "crypto";

import { isDatabaseConfigured, prisma } from "@/lib/prisma";
import type { ConsultationMessageRole } from "@prisma/client";

export const CONSULTATION_MESSAGE_PERSISTENCE_ERROR_CODE = "CONSULTATION_MESSAGE_PERSISTENCE_UNAVAILABLE";

export class ConsultationMessagePersistenceError extends Error {
  readonly code = CONSULTATION_MESSAGE_PERSISTENCE_ERROR_CODE;
  readonly httpStatus = 503;

  constructor() {
    super("Conversation data is temporarily unavailable.");
    this.name = "ConsultationMessagePersistenceError";
  }
}

export function isConsultationMessagePersistenceError(error: unknown): error is ConsultationMessagePersistenceError {
  return error instanceof ConsultationMessagePersistenceError;
}

export interface ConsultationMessageRow {
  id: string;
  role: ConsultationMessageRole;
  content: string;
  proposedCorrection: unknown;
  createdAt: string;
}

export interface RecordConsultationMessageInput {
  ownerUserId: string;
  clientId: string;
  analysisId?: string | null;
  role: ConsultationMessageRole;
  content: string;
  proposedCorrection?: unknown;
}

async function runQuery<T>(operation: () => Promise<T>): Promise<T> {
  if (!isDatabaseConfigured()) throw new ConsultationMessagePersistenceError();

  try {
    return await operation();
  } catch (error) {
    if (error instanceof ConsultationMessagePersistenceError) throw error;
    throw new ConsultationMessagePersistenceError();
  }
}

// Owner+client scoping is enforced twice: the composite foreign key to
// "Client" (clientId, ownerUserId) makes a mismatched pair impossible at
// the database level, and the chat service (consultation-chat-service.ts)
// verifies the Client belongs to this owner before ever calling this --
// so a foreign-key failure here would only ever indicate an application
// bug, never a real cross-owner write actually reaching the database.
export async function recordConsultationMessage(input: RecordConsultationMessageInput): Promise<ConsultationMessageRow> {
  return runQuery(async () => {
    const row = await prisma.consultationMessage.create({
      data: {
        id: randomUUID(),
        ownerUserId: input.ownerUserId,
        clientId: input.clientId,
        analysisId: input.analysisId ?? null,
        role: input.role,
        content: input.content,
        proposedCorrection: input.proposedCorrection == null ? undefined : (input.proposedCorrection as never),
      },
    });

    return toRow(row);
  });
}

export async function listRecentConsultationMessages(
  ownerUserId: string,
  clientId: string,
  limit: number = 10,
): Promise<ConsultationMessageRow[]> {
  return runQuery(async () => {
    const rows = await prisma.consultationMessage.findMany({
      where: { ownerUserId, clientId },
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    // Oldest-first for prompt construction and UI display -- the query
    // itself fetches newest-first (so `take` bounds it to the most recent
    // messages), then this reverses it back to chronological order.
    return rows.reverse().map(toRow);
  });
}

function toRow(row: {
  id: string;
  role: ConsultationMessageRole;
  content: string;
  proposedCorrection: unknown;
  createdAt: Date;
}): ConsultationMessageRow {
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    proposedCorrection: row.proposedCorrection,
    createdAt: row.createdAt.toISOString(),
  };
}
