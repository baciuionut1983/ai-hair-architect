import { randomUUID } from "crypto";

import type { ProfessionalMemoryKind, ProfessionalMemoryScope, ProfessionalMemorySource } from "@prisma/client";

import { isDatabaseConfigured, prisma } from "@/lib/prisma";

export const PROFESSIONAL_MEMORY_PERSISTENCE_ERROR_CODE = "PROFESSIONAL_MEMORY_PERSISTENCE_UNAVAILABLE";

export class ProfessionalMemoryPersistenceError extends Error {
  readonly code = PROFESSIONAL_MEMORY_PERSISTENCE_ERROR_CODE;
  readonly httpStatus = 503;

  constructor() {
    super("Professional memory data is temporarily unavailable.");
    this.name = "ProfessionalMemoryPersistenceError";
  }
}

export class ProfessionalMemoryValidationError extends Error {
  readonly code = "PROFESSIONAL_MEMORY_VALIDATION_FAILED";
  readonly httpStatus = 400;

  constructor(message: string) {
    super(message);
    this.name = "ProfessionalMemoryValidationError";
  }
}

export function isProfessionalMemoryPersistenceError(error: unknown): error is ProfessionalMemoryPersistenceError {
  return error instanceof ProfessionalMemoryPersistenceError;
}

export function professionalMemoryPersistenceUnavailableResponse(): Response {
  return Response.json(
    { error: PROFESSIONAL_MEMORY_PERSISTENCE_ERROR_CODE, message: "Professional memory data is temporarily unavailable." },
    { status: 503, headers: { "Cache-Control": "no-store" } },
  );
}

export interface MemoryRecord {
  id: string;
  scope: ProfessionalMemoryScope;
  kind: ProfessionalMemoryKind;
  content: string;
  confidence: number;
  source: ProfessionalMemorySource;
  clientId: string | null;
  createdAt: string;
}

export interface MemoryProposalActionConfig {
  scope: ProfessionalMemoryScope;
  kind: ProfessionalMemoryKind;
}

// The single source of truth for what a "memory proposal" is allowed to be
// -- both POST /api/v1/clients/[id]/memories (the manual Teach-AI panel)
// and the Gemini chat provider's proposedMemory schema import this exact
// map, so the two can never drift out of sync. Deliberately excludes
// "shared_knowledge" scope and "ai_observation" kind: nothing in this
// product creates either today -- a professional observation the AI
// recognizes in conversation is always attributed to the stylist who
// confirms it (client_specific/fact or stylist_specific/professional_rule
// or preference), never invented as if the AI itself observed it.
export const MEMORY_PROPOSAL_ACTIONS = {
  save_client_memory: { scope: "client_specific", kind: "fact" },
  save_professional_rule: { scope: "stylist_specific", kind: "professional_rule" },
  mark_preference: { scope: "stylist_specific", kind: "preference" },
  save_outcome: { scope: "client_specific", kind: "outcome" },
} as const satisfies Record<string, MemoryProposalActionConfig>;

export type MemoryProposalAction = keyof typeof MEMORY_PROPOSAL_ACTIONS;

export const MEMORY_PROPOSAL_ACTION_KEYS = Object.keys(MEMORY_PROPOSAL_ACTIONS) as MemoryProposalAction[];

export function isMemoryProposalAction(value: string): value is MemoryProposalAction {
  return Object.prototype.hasOwnProperty.call(MEMORY_PROPOSAL_ACTIONS, value);
}

async function runMemoryQuery<T>(operation: () => Promise<T>): Promise<T> {
  if (!isDatabaseConfigured()) throw new ProfessionalMemoryPersistenceError();

  try {
    return await operation();
  } catch (error) {
    if (error instanceof ProfessionalMemoryPersistenceError || error instanceof ProfessionalMemoryValidationError) {
      throw error;
    }
    throw new ProfessionalMemoryPersistenceError();
  }
}

export interface CreateConfirmedMemoryInput {
  ownerUserId: string;
  clientId?: string;
  scope: ProfessionalMemoryScope;
  kind: ProfessionalMemoryKind;
  source: ProfessionalMemorySource;
  content: string;
  confidence?: number;
  provenance: Record<string, unknown>;
}

// "Confirmed" is the only creation path this repository exposes -- there is
// no separate "create pending, confirm later" step. The explicit-confirm
// gate lives one layer up, in the caller (the UI shows the proposed content
// and requires an explicit confirm click/action before this is ever
// called): by the time this function runs, confirmation has already
// happened, so the row is created directly as status="active" with
// confirmedAt set, and an audit row is written in the same transaction so
// the confirmation is never unrecorded even if something fails right after.
export async function createConfirmedMemory(input: CreateConfirmedMemoryInput): Promise<MemoryRecord> {
  if (input.scope === "client_specific" && !input.clientId) {
    throw new ProfessionalMemoryValidationError("clientId is required for a client_specific memory.");
  }
  if (input.scope !== "client_specific" && input.clientId) {
    throw new ProfessionalMemoryValidationError("clientId is only allowed for a client_specific memory.");
  }

  const confirmedAt = new Date();

  return runMemoryQuery(async () => {
    const row = await prisma.$transaction(async (tx) => {
      const memory = await tx.professionalMemory.create({
        data: {
          id: randomUUID(),
          ownerUserId: input.ownerUserId,
          clientId: input.clientId ?? null,
          scope: input.scope,
          kind: input.kind,
          status: "active",
          source: input.source,
          content: input.content,
          confidence: input.confidence ?? 1,
          provenance: input.provenance as never,
          createdByUserId: input.ownerUserId,
          confirmedAt,
        },
      });

      await tx.professionalMemoryAudit.create({
        data: {
          id: randomUUID(),
          memoryId: memory.id,
          ownerUserId: input.ownerUserId,
          actorUserId: input.ownerUserId,
          action: "confirmed_created",
          details: { source: input.source, scope: input.scope } as never,
        },
      });

      return memory;
    });

    return toMemoryRecord(row);
  });
}

// Revocation only ever flips status from "active" -> "revoked" (never
// deletes the row, so the provenance and audit trail survive) and only for
// a row this exact owner already has active -- revoking a foreign or
// already-revoked memory is a no-op (false), never a 500 or a silent
// success on the wrong row.
export async function revokeMemory(ownerUserId: string, memoryId: string): Promise<boolean> {
  return runMemoryQuery(async () => prisma.$transaction(async (tx) => {
    const changed = await tx.professionalMemory.updateMany({
      where: { id: memoryId, ownerUserId, status: "active" },
      data: { status: "revoked", revokedAt: new Date() },
    });
    if (changed.count === 0) {
      return false;
    }

    await tx.professionalMemoryAudit.create({
      data: {
        id: randomUUID(),
        memoryId,
        ownerUserId,
        actorUserId: ownerUserId,
        action: "revoked",
        details: {} as never,
      },
    });
    return true;
  }));
}

const RETRIEVAL_CANDIDATE_LIMIT = 60;
const RETRIEVAL_MIN_RESULTS = 1;
const RETRIEVAL_MAX_RESULTS = 20;
const DEFAULT_RETRIEVAL_LIMIT = 12;
const RULE_SCORE_BONUS = 6;
const PREFERENCE_SCORE_BONUS = 3;
const SAME_CLIENT_SCORE_BONUS = 2;
const MIN_MATCH_TERM_LENGTH = 3;

// Bounded, deterministic retrieval -- never every memory this owner has
// ever confirmed, only the top-scoring, most-relevant slice. A client's own
// facts/outcomes and this owner's stylist-wide rules/preferences are
// eligible; another client's memory never is (enforced in the WHERE
// clause, not filtered after the fact). Only status="active" rows are ever
// candidates -- a revoked or still-unconfirmed memory can never be
// injected into an AI conversation.
export async function retrieveRelevantMemories(
  ownerUserId: string,
  clientId: string,
  message: string,
  limit: number = DEFAULT_RETRIEVAL_LIMIT,
): Promise<MemoryRecord[]> {
  return runMemoryQuery(async () => {
    const rows = await prisma.professionalMemory.findMany({
      where: {
        ownerUserId,
        status: "active",
        OR: [
          { scope: "client_specific", clientId },
          { scope: { in: ["stylist_specific", "shared_knowledge"] }, clientId: null },
        ],
      },
      orderBy: { updatedAt: "desc" },
      take: RETRIEVAL_CANDIDATE_LIMIT,
    });

    const terms = extractMatchTerms(message);
    const bounded = Math.max(RETRIEVAL_MIN_RESULTS, Math.min(limit, RETRIEVAL_MAX_RESULTS));

    return rows
      .map((row) => ({ row, score: scoreMemory(row, terms, clientId) }))
      .sort((a, b) => b.score - a.score || b.row.updatedAt.getTime() - a.row.updatedAt.getTime())
      .slice(0, bounded)
      .map(({ row }) => toMemoryRecord(row));
  });
}

function extractMatchTerms(message: string): Set<string> {
  return new Set(
    message
      .toLocaleLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((term) => term.length > MIN_MATCH_TERM_LENGTH - 1),
  );
}

function scoreMemory(
  row: { content: string; kind: ProfessionalMemoryKind; clientId: string | null },
  terms: Set<string>,
  clientId: string,
): number {
  const contentLower = row.content.toLocaleLowerCase();
  const overlap = [...terms].filter((term) => contentLower.includes(term)).length;
  const kindBonus = row.kind === "professional_rule" ? RULE_SCORE_BONUS : row.kind === "preference" ? PREFERENCE_SCORE_BONUS : 0;
  const sameClientBonus = row.clientId === clientId ? SAME_CLIENT_SCORE_BONUS : 0;
  return overlap + kindBonus + sameClientBonus;
}

function toMemoryRecord(row: {
  id: string;
  scope: ProfessionalMemoryScope;
  kind: ProfessionalMemoryKind;
  content: string;
  confidence: number;
  source: ProfessionalMemorySource;
  clientId: string | null;
  createdAt: Date;
}): MemoryRecord {
  return {
    id: row.id,
    scope: row.scope,
    kind: row.kind,
    content: row.content,
    confidence: row.confidence,
    source: row.source,
    clientId: row.clientId,
    createdAt: row.createdAt.toISOString(),
  };
}
