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

export type ConsultationMemoryDecision = "confirmed" | "rejected";

export interface ConsultationMessageRow {
  id: string;
  role: ConsultationMessageRole;
  content: string;
  proposedCorrection: unknown;
  proposedMemory: unknown;
  proposedMemoryDecision: ConsultationMemoryDecision | null;
  createdAt: string;
}

export interface RecordConsultationMessageInput {
  ownerUserId: string;
  clientId: string;
  analysisId?: string | null;
  role: ConsultationMessageRole;
  content: string;
  proposedCorrection?: unknown;
  proposedMemory?: unknown;
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
        proposedMemory: input.proposedMemory == null ? undefined : (input.proposedMemory as never),
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

// Regression: Confirm/Edit/Reject reappeared as active buttons on
// already-decided proposedMemory cards after every reload -- the decision
// lived only in transient React state (consultation-chat.tsx), never
// persisted anywhere, and Reject made no API call at all. This is the one
// place a decision is ever written: read-then-conditionally-write, so it
// can only ever apply to a row that (a) actually carries a proposedMemory
// and (b) has no decision yet -- the final `updateMany`'s own WHERE clause
// re-asserts proposedMemoryDecision: null, closing the race window between
// the read and the write, so two concurrent decisions on the same message
// can never both succeed. Returns false (a safe, ownership-hiding no-op)
// for a message that doesn't exist, isn't owned by this owner/client,
// carries no proposal, or was already decided -- the caller maps that to a
// generic 404, exactly like resolveOwnedClient's own existence-hiding
// convention elsewhere in this codebase.
export async function markConsultationMessageMemoryDecision(
  ownerUserId: string,
  clientId: string,
  messageId: string,
  decision: ConsultationMemoryDecision,
): Promise<boolean> {
  return runQuery(async () => {
    const existing = await prisma.consultationMessage.findFirst({
      where: { id: messageId, ownerUserId, clientId },
      select: { proposedMemory: true, proposedMemoryDecision: true },
    });
    if (!existing || existing.proposedMemory == null || existing.proposedMemoryDecision != null) {
      return false;
    }

    const result = await prisma.consultationMessage.updateMany({
      where: { id: messageId, ownerUserId, clientId, proposedMemoryDecision: null },
      data: { proposedMemoryDecision: decision },
    });
    return result.count === 1;
  });
}

// AI Proposed Look (Phase 2), Stage 5 -- the single owner+client scoped
// lookup "Use in Proposed Look" needs to independently verify a
// client-supplied consultationMessageId before ever trusting anything about
// it. Same ownership-check shape as markConsultationMessageMemoryDecision's
// own read above -- one identical `null` result for a nonexistent id, a
// foreign owner, or a foreign client, so a message id can never be used as
// a cross-client discovery oracle.
export async function findConsultationMessageForOwner(
  ownerUserId: string,
  clientId: string,
  messageId: string,
): Promise<ConsultationMessageRow | null> {
  return runQuery(async () => {
    const row = await prisma.consultationMessage.findFirst({
      where: { id: messageId, ownerUserId, clientId },
    });
    return row ? toRow(row) : null;
  });
}

function toRow(row: {
  id: string;
  role: ConsultationMessageRole;
  content: string;
  proposedCorrection: unknown;
  proposedMemory: unknown;
  proposedMemoryDecision: string | null;
  createdAt: Date;
}): ConsultationMessageRow {
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    proposedCorrection: row.proposedCorrection,
    proposedMemory: row.proposedMemory,
    proposedMemoryDecision: row.proposedMemoryDecision === "confirmed" || row.proposedMemoryDecision === "rejected" ? row.proposedMemoryDecision : null,
    createdAt: row.createdAt.toISOString(),
  };
}
