import { randomUUID } from "crypto";

import { Prisma, type ProfessionalReasoningProposal as PrismaProfessionalReasoningProposalRow } from "@prisma/client";

import { isDatabaseConfigured, prisma } from "@/lib/prisma";
import {
  isProfessionalReasoningProposal,
  type ProfessionalReasoningContext,
  type ProfessionalReasoningProposal,
} from "@/lib/professional-reasoning-contracts";

// AI Hair Architect, Professional Skill Engine Stage 5 -- PROFESSIONAL
// REASONING PROPOSAL, domain/repository layer. Mirrors hair-state-
// snapshot-repository.ts's own conventions exactly: the
// runSerializableTransaction retry-on-conflict helper, the runXQuery
// fail-closed wrapper, the ownership-check style, the typed-error
// taxonomy, and the exact confirm-time optimistic-concurrency CAS shape
// (expectedCurrent*Id).
//
// AUTHORITY BOUNDARY (Part G's own explicit, load-bearing rule): every
// row is created DRAFT, always -- there is no code path anywhere in this
// file that creates a row in any other status. AI-generated reasoning
// NEVER automatically becomes CONFIRMED/APPROVED/AUTHORITATIVE; only
// confirmDraftReasoningProposal (a real professional action, called from
// outside this file with a real confirmedByUserId) can do that, exactly
// mirroring confirmDraftMap's/confirmDraftSnapshot's own precedent.
//
// LIFECYCLE mirrors AnalysisProposal's own DRAFT|CONFIRMED|REJECTED|
// SUPERSEDED (not TechnicalVisualMap's DRAFT|CONFIRMED|SUPERSEDED): a
// Professional Reasoning Proposal is an independently-evaluated candidate
// a professional can accept OR decline, not a derived artifact of an
// already-confirmed parent -- REJECTED is a real, first-class outcome
// here, same reasoning as AnalysisProposal's own.

export const PROFESSIONAL_REASONING_PROPOSAL_STATUSES = ["DRAFT", "CONFIRMED", "REJECTED", "SUPERSEDED"] as const;
export type ProfessionalReasoningProposalStatus = (typeof PROFESSIONAL_REASONING_PROPOSAL_STATUSES)[number];

export function isProfessionalReasoningProposalStatus(value: unknown): value is ProfessionalReasoningProposalStatus {
  return typeof value === "string" && (PROFESSIONAL_REASONING_PROPOSAL_STATUSES as readonly string[]).includes(value);
}

export class ProfessionalReasoningPersistenceError extends Error {
  readonly code = "PROFESSIONAL_REASONING_PERSISTENCE_UNAVAILABLE";
  readonly httpStatus = 503;

  constructor() {
    super("Professional Reasoning Proposal data is temporarily unavailable.");
    this.name = "ProfessionalReasoningPersistenceError";
  }
}

export class ProfessionalReasoningDependencyError extends Error {
  constructor(
    readonly code: "PROFESSIONAL_REASONING_CLIENT_NOT_FOUND",
    readonly httpStatus: 404,
    message: string,
  ) {
    super(message);
    this.name = "ProfessionalReasoningDependencyError";
  }
}

export class ProfessionalReasoningValidationDbError extends Error {
  readonly httpStatus = 422;

  constructor(
    readonly code: "PROFESSIONAL_REASONING_INVALID_PROPOSAL" | "PROFESSIONAL_REASONING_DUPLICATE_REQUEST",
    message: string,
  ) {
    super(message);
    this.name = "ProfessionalReasoningValidationDbError";
  }
}

export class ProfessionalReasoningStateError extends Error {
  readonly code = "PROFESSIONAL_REASONING_ILLEGAL_STATE_TRANSITION";
  readonly httpStatus = 409;

  constructor(
    readonly fromStatus: string,
    message: string,
  ) {
    super(message);
    this.name = "ProfessionalReasoningStateError";
  }
}

export class ProfessionalReasoningConcurrencyError extends Error {
  readonly code = "PROFESSIONAL_REASONING_CONCURRENCY_CONFLICT";
  readonly httpStatus = 409;

  constructor() {
    super("Professional Reasoning Proposal could not be confirmed because of a concurrent confirmation.");
    this.name = "ProfessionalReasoningConcurrencyError";
  }
}

export class ProfessionalReasoningInvariantError extends Error {
  readonly code = "PROFESSIONAL_REASONING_CONFIRMED_INVARIANT_VIOLATED";
  readonly httpStatus = 500;

  constructor(message: string) {
    super(message);
    this.name = "ProfessionalReasoningInvariantError";
  }
}

const MAX_TRANSACTION_ATTEMPTS = 3;

export interface ProfessionalReasoningProposalRecord {
  id: string;
  ownerUserId: string;
  clientId: string;
  currentSnapshotId: string;
  currentSnapshotVersion: number;
  targetSnapshotId: string;
  targetSnapshotVersion: number;
  context: ProfessionalReasoningContext;
  contextFingerprint: string;
  provider: string;
  model: string;
  providerRequestId: string | null;
  proposal: ProfessionalReasoningProposal;
  status: ProfessionalReasoningProposalStatus;
  confirmedByUserId: string | null;
  confirmedAt: string | null;
  rejectedAt: string | null;
  supersededByProposalId: string | null;
  supersededAt: string | null;
  createdAt: string;
  updatedAt: string;
}

type ReasoningTransaction = Pick<Prisma.TransactionClient, "professionalReasoningProposal" | "client">;

// ---------------------------------------------------------------------------
// createDraftReasoningProposal -- the ONLY creation path. Always DRAFT.
// ---------------------------------------------------------------------------

export interface CreateDraftReasoningProposalInput {
  ownerUserId: string;
  clientId: string;
  context: ProfessionalReasoningContext;
  provider: string;
  model: string;
  providerRequestId?: string | null;
  proposal: ProfessionalReasoningProposal;
}

export async function createDraftReasoningProposal(input: CreateDraftReasoningProposalInput): Promise<ProfessionalReasoningProposalRecord> {
  if (!isProfessionalReasoningProposal(input.proposal)) {
    throw new ProfessionalReasoningValidationDbError("PROFESSIONAL_REASONING_INVALID_PROPOSAL", "proposal is not a structurally valid ProfessionalReasoningProposal.");
  }

  return runReasoningQuery(() =>
    runSerializableTransaction(async (tx) => {
      const client = await tx.client.findFirst({ where: { id: input.clientId, ownerUserId: input.ownerUserId, deletedAt: null }, select: { id: true } });
      if (!client) {
        throw new ProfessionalReasoningDependencyError("PROFESSIONAL_REASONING_CLIENT_NOT_FOUND", 404, "Client not found.");
      }

      const row = await tx.professionalReasoningProposal.create({
        data: {
          id: randomUUID(),
          ownerUserId: input.ownerUserId,
          clientId: input.clientId,
          currentSnapshotId: input.context.currentSnapshotId,
          currentSnapshotVersion: input.context.currentSnapshotVersion,
          targetSnapshotId: input.context.targetSnapshotId,
          targetSnapshotVersion: input.context.targetSnapshotVersion,
          contextPayload: input.context as unknown as Prisma.InputJsonValue,
          contextFingerprint: input.context.contextFingerprint,
          provider: input.provider,
          model: input.model,
          providerRequestId: input.providerRequestId ?? null,
          proposalPayload: input.proposal as unknown as Prisma.InputJsonValue,
          status: "DRAFT",
        },
      });
      return toRecord(row);
    }),
  );
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function findReasoningProposalForOwner(ownerUserId: string, proposalId: string): Promise<ProfessionalReasoningProposalRecord | null> {
  return runReasoningQuery(async () => {
    const row = await prisma.professionalReasoningProposal.findFirst({ where: { id: proposalId, ownerUserId } });
    return row ? toRecord(row) : null;
  });
}

// Idempotency lookup -- an identical reasoning context sent to the same
// provider/model resolves to this existing row, never a second write
// (the DB's own @@unique([contextFingerprint, provider, model]) is the
// final backstop).
export async function findReasoningProposalByFingerprint(contextFingerprint: string, provider: string, model: string): Promise<ProfessionalReasoningProposalRecord | null> {
  return runReasoningQuery(async () => {
    const row = await prisma.professionalReasoningProposal.findFirst({ where: { contextFingerprint, provider, model } });
    return row ? toRecord(row) : null;
  });
}

export async function listReasoningProposalsForClient(ownerUserId: string, clientId: string): Promise<ProfessionalReasoningProposalRecord[]> {
  return runReasoningQuery(async () => {
    const rows = await prisma.professionalReasoningProposal.findMany({
      where: { ownerUserId, clientId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    return rows.map(toRecord);
  });
}

// ---------------------------------------------------------------------------
// confirmDraftReasoningProposal -- the ONE real professional-approval
// action. CAS semantics mirror confirmDraftSnapshot's own exact shape.
// ---------------------------------------------------------------------------

export async function confirmDraftReasoningProposal(
  ownerUserId: string,
  proposalId: string,
  confirmedByUserId: string,
  expectedCurrentConfirmedProposalId: string | null,
): Promise<ProfessionalReasoningProposalRecord | null> {
  return runReasoningQuery(() =>
    runSerializableTransaction(async (tx) => {
      const target = await tx.professionalReasoningProposal.findFirst({ where: { id: proposalId, ownerUserId } });
      if (!target) return null;
      if (target.status !== "DRAFT") {
        throw new ProfessionalReasoningStateError(target.status, `Proposal ${proposalId} is ${target.status}; only a DRAFT proposal can be confirmed.`);
      }

      const currentConfirmed = await tx.professionalReasoningProposal.findFirst({
        where: { ownerUserId, clientId: target.clientId, status: "CONFIRMED" },
        select: { id: true },
      });
      const actualCurrentId = currentConfirmed?.id ?? null;
      if (actualCurrentId !== expectedCurrentConfirmedProposalId) {
        throw new ProfessionalReasoningConcurrencyError();
      }

      const now = new Date();
      if (currentConfirmed) {
        await tx.professionalReasoningProposal.update({
          where: { id: currentConfirmed.id },
          data: { status: "SUPERSEDED", supersededAt: now, supersededByProposalId: target.id },
        });
      }

      const confirmed = await tx.professionalReasoningProposal.update({
        where: { id: target.id },
        data: { status: "CONFIRMED", confirmedByUserId, confirmedAt: now },
      });
      return toRecord(confirmed);
    }),
  );
}

export async function rejectDraftReasoningProposal(ownerUserId: string, proposalId: string): Promise<ProfessionalReasoningProposalRecord | null> {
  return runReasoningQuery(() =>
    runSerializableTransaction(async (tx) => {
      const target = await tx.professionalReasoningProposal.findFirst({ where: { id: proposalId, ownerUserId } });
      if (!target) return null;
      if (target.status !== "DRAFT") {
        throw new ProfessionalReasoningStateError(target.status, `Proposal ${proposalId} is ${target.status}; only a DRAFT proposal can be rejected.`);
      }
      const rejected = await tx.professionalReasoningProposal.update({ where: { id: target.id }, data: { status: "REJECTED", rejectedAt: new Date() } });
      return toRecord(rejected);
    }),
  );
}

export async function findCurrentConfirmedReasoningProposal(ownerUserId: string, clientId: string): Promise<ProfessionalReasoningProposalRecord | null> {
  return runReasoningQuery(async () => {
    const rows = await prisma.professionalReasoningProposal.findMany({ where: { ownerUserId, clientId, status: "CONFIRMED" } });
    if (rows.length > 1) {
      throw new ProfessionalReasoningInvariantError(
        `Found ${rows.length} CONFIRMED Professional Reasoning Proposals for one (owner ${ownerUserId}, client ${clientId}) -- there should never be more than one.`,
      );
    }
    return rows[0] ? toRecord(rows[0]) : null;
  });
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

async function runReasoningQuery<T>(operation: () => Promise<T>): Promise<T> {
  if (!isDatabaseConfigured()) throw new ProfessionalReasoningPersistenceError();
  try {
    return await operation();
  } catch (error) {
    if (
      error instanceof ProfessionalReasoningPersistenceError ||
      error instanceof ProfessionalReasoningDependencyError ||
      error instanceof ProfessionalReasoningValidationDbError ||
      error instanceof ProfessionalReasoningStateError ||
      error instanceof ProfessionalReasoningConcurrencyError ||
      error instanceof ProfessionalReasoningInvariantError
    ) {
      throw error;
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new ProfessionalReasoningValidationDbError("PROFESSIONAL_REASONING_DUPLICATE_REQUEST", "An identical reasoning request to this provider/model already exists.");
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") {
      throw new ProfessionalReasoningDependencyError("PROFESSIONAL_REASONING_CLIENT_NOT_FOUND", 404, "Professional Reasoning Proposal dependencies changed.");
    }
    throw new ProfessionalReasoningPersistenceError();
  }
}

async function runSerializableTransaction<T>(operation: (tx: ReasoningTransaction) => Promise<T>): Promise<T> {
  for (let attempt = 1; attempt <= MAX_TRANSACTION_ATTEMPTS; attempt += 1) {
    try {
      return await prisma.$transaction(operation, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (!isRetryableConcurrencyError(error)) throw error;
      if (attempt === MAX_TRANSACTION_ATTEMPTS) throw new ProfessionalReasoningConcurrencyError();
    }
  }
  throw new ProfessionalReasoningConcurrencyError();
}

function isRetryableConcurrencyError(error: unknown): boolean {
  if (
    error instanceof ProfessionalReasoningPersistenceError ||
    error instanceof ProfessionalReasoningDependencyError ||
    error instanceof ProfessionalReasoningValidationDbError ||
    error instanceof ProfessionalReasoningStateError ||
    error instanceof ProfessionalReasoningConcurrencyError ||
    error instanceof ProfessionalReasoningInvariantError
  ) {
    return false;
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return error.code === "P2034";
  }
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return message.includes("deadlock") || message.includes("serialization");
}

function toRecord(row: PrismaProfessionalReasoningProposalRow): ProfessionalReasoningProposalRecord {
  const context = row.contextPayload;
  const proposal = row.proposalPayload;
  if (!isRecord(context) || !isProfessionalReasoningProposal(proposal)) {
    throw new ProfessionalReasoningPersistenceError();
  }
  if (!isProfessionalReasoningProposalStatus(row.status)) {
    throw new ProfessionalReasoningPersistenceError();
  }
  return {
    id: row.id,
    ownerUserId: row.ownerUserId,
    clientId: row.clientId,
    currentSnapshotId: row.currentSnapshotId,
    currentSnapshotVersion: row.currentSnapshotVersion,
    targetSnapshotId: row.targetSnapshotId,
    targetSnapshotVersion: row.targetSnapshotVersion,
    context: context as unknown as ProfessionalReasoningContext,
    contextFingerprint: row.contextFingerprint,
    provider: row.provider,
    model: row.model,
    providerRequestId: row.providerRequestId,
    proposal,
    status: row.status,
    confirmedByUserId: row.confirmedByUserId,
    confirmedAt: row.confirmedAt ? row.confirmedAt.toISOString() : null,
    rejectedAt: row.rejectedAt ? row.rejectedAt.toISOString() : null,
    supersededByProposalId: row.supersededByProposalId,
    supersededAt: row.supersededAt ? row.supersededAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
