import { randomUUID } from "crypto";

import { Prisma, type ProfessionalExecutionPlan as PrismaProfessionalExecutionPlanRow } from "@prisma/client";

import { isDatabaseConfigured, prisma } from "@/lib/prisma";
import { isValidProfessionalExecutionPlan, isProfessionalExecutionPlanReadiness, type ProfessionalExecutionPlan, type ProfessionalExecutionPlanReadiness } from "@/lib/professional-execution-plan-contracts";

// AI Hair Architect, Professional Skill Engine Stage 6 -- PROFESSIONAL
// EXECUTION PLAN, domain/repository layer. Mirrors professional-reasoning-
// repository.ts's own conventions exactly: the runSerializableTransaction
// retry-on-conflict helper, the runXQuery fail-closed wrapper, the
// ownership-check style, the typed-error taxonomy, and the exact confirm-
// time optimistic-concurrency CAS shape (expectedCurrentConfirmedPlanId).
//
// AUTHORITY BOUNDARY (mirrors Stage 5's own load-bearing rule): every row
// is created DRAFT, always -- there is no code path anywhere in this file
// that creates a row in any other status. A compiled plan NEVER
// automatically becomes CONFIRMED/authoritative; only
// confirmDraftExecutionPlan (a real professional action, called from
// outside this file with a real confirmedByUserId) can do that.
//
// LIFECYCLE -- DRAFT | CONFIRMED | SUPERSEDED, deliberately WITHOUT
// REJECTED -- see this file's own Prisma model header comment
// (schema.prisma) for why: a plan is a derived, deterministic compile of
// an already-CONFIRMED Stage 5 proposal, not an independently-evaluated
// option. There is no rejectDraftExecutionPlan here.
//
// IMMUTABILITY (Part S): confirmDraftExecutionPlan is the ONLY write path
// that ever changes `status`/`confirmedByUserId`/`confirmedAt` on an
// existing row, and it never touches `planPayload` -- an approved
// historical plan's own content is permanently frozen the moment it is
// written, exactly like ProfessionalReasoningProposal.proposalPayload. A
// professional edit (applyProfessionalParameterOverride/
// rejectPlannedExecutionUnit, professional-execution-plan-compiler.ts)
// always produces a NEW plan VALUE, which this repository then persists
// as a NEW DRAFT row via createDraftExecutionPlan -- never an UPDATE to
// an existing row's planPayload.

export const PROFESSIONAL_EXECUTION_PLAN_STATUSES = ["DRAFT", "CONFIRMED", "SUPERSEDED"] as const;
export type ProfessionalExecutionPlanStatus = (typeof PROFESSIONAL_EXECUTION_PLAN_STATUSES)[number];

export function isProfessionalExecutionPlanStatus(value: unknown): value is ProfessionalExecutionPlanStatus {
  return typeof value === "string" && (PROFESSIONAL_EXECUTION_PLAN_STATUSES as readonly string[]).includes(value);
}

export class ExecutionPlanPersistenceError extends Error {
  readonly code = "EXECUTION_PLAN_PERSISTENCE_UNAVAILABLE";
  readonly httpStatus = 503;

  constructor() {
    super("Professional Execution Plan data is temporarily unavailable.");
    this.name = "ExecutionPlanPersistenceError";
  }
}

export class ExecutionPlanDependencyError extends Error {
  constructor(
    readonly code: "EXECUTION_PLAN_CLIENT_NOT_FOUND" | "EXECUTION_PLAN_SOURCE_PROPOSAL_NOT_FOUND",
    readonly httpStatus: 404,
    message: string,
  ) {
    super(message);
    this.name = "ExecutionPlanDependencyError";
  }
}

export class ExecutionPlanValidationDbError extends Error {
  readonly httpStatus = 422;

  constructor(
    readonly code: "EXECUTION_PLAN_INVALID_PLAN",
    message: string,
  ) {
    super(message);
    this.name = "ExecutionPlanValidationDbError";
  }
}

export class ExecutionPlanStateError extends Error {
  readonly code = "EXECUTION_PLAN_ILLEGAL_STATE_TRANSITION";
  readonly httpStatus = 409;

  constructor(
    readonly fromStatus: string,
    message: string,
  ) {
    super(message);
    this.name = "ExecutionPlanStateError";
  }
}

export class ExecutionPlanConcurrencyError extends Error {
  readonly code = "EXECUTION_PLAN_CONCURRENCY_CONFLICT";
  readonly httpStatus = 409;

  constructor() {
    super("Professional Execution Plan could not be confirmed because of a concurrent confirmation.");
    this.name = "ExecutionPlanConcurrencyError";
  }
}

export class ExecutionPlanInvariantError extends Error {
  readonly code = "EXECUTION_PLAN_CONFIRMED_INVARIANT_VIOLATED";
  readonly httpStatus = 500;

  constructor(message: string) {
    super(message);
    this.name = "ExecutionPlanInvariantError";
  }
}

const MAX_TRANSACTION_ATTEMPTS = 3;

export interface ProfessionalExecutionPlanRecord {
  id: string;
  ownerUserId: string;
  clientId: string;
  currentSnapshotId: string;
  currentSnapshotVersion: number;
  targetSnapshotId: string;
  targetSnapshotVersion: number;
  sourceReasoningProposalId: string;
  reasoningProposalContextFingerprint: string;
  plan: ProfessionalExecutionPlan;
  status: ProfessionalExecutionPlanStatus;
  readiness: ProfessionalExecutionPlanReadiness;
  professionalOverrides: readonly unknown[];
  confirmedByUserId: string | null;
  confirmedAt: string | null;
  supersededByPlanId: string | null;
  supersededAt: string | null;
  createdAt: string;
  updatedAt: string;
}

type ExecutionPlanTransaction = Pick<Prisma.TransactionClient, "professionalExecutionPlan" | "client" | "professionalReasoningProposal">;

// ---------------------------------------------------------------------------
// createDraftExecutionPlan -- the ONLY creation path. Always DRAFT.
// ---------------------------------------------------------------------------

export interface CreateDraftExecutionPlanInput {
  ownerUserId: string;
  clientId: string;
  sourceReasoningProposalId: string;
  plan: ProfessionalExecutionPlan;
  professionalOverrides?: readonly unknown[];
}

export async function createDraftExecutionPlan(input: CreateDraftExecutionPlanInput): Promise<ProfessionalExecutionPlanRecord> {
  if (!isValidProfessionalExecutionPlan(input.plan, (candidate): candidate is string => typeof candidate === "string")) {
    throw new ExecutionPlanValidationDbError("EXECUTION_PLAN_INVALID_PLAN", "plan is not a structurally valid ProfessionalExecutionPlan.");
  }

  return runExecutionPlanQuery(() =>
    runSerializableTransaction(async (tx) => {
      const client = await tx.client.findFirst({ where: { id: input.clientId, ownerUserId: input.ownerUserId, deletedAt: null }, select: { id: true } });
      if (!client) {
        throw new ExecutionPlanDependencyError("EXECUTION_PLAN_CLIENT_NOT_FOUND", 404, "Client not found.");
      }

      const sourceProposal = await tx.professionalReasoningProposal.findFirst({
        where: { id: input.sourceReasoningProposalId, ownerUserId: input.ownerUserId, clientId: input.clientId },
        select: { id: true },
      });
      if (!sourceProposal) {
        throw new ExecutionPlanDependencyError("EXECUTION_PLAN_SOURCE_PROPOSAL_NOT_FOUND", 404, "Source Professional Reasoning Proposal not found.");
      }

      const row = await tx.professionalExecutionPlan.create({
        data: {
          id: randomUUID(),
          ownerUserId: input.ownerUserId,
          clientId: input.clientId,
          currentSnapshotId: input.plan.currentSnapshotId,
          currentSnapshotVersion: input.plan.currentSnapshotVersion,
          targetSnapshotId: input.plan.targetSnapshotId,
          targetSnapshotVersion: input.plan.targetSnapshotVersion,
          sourceReasoningProposalId: input.sourceReasoningProposalId,
          reasoningProposalContextFingerprint: input.plan.reasoningProposalContextFingerprint,
          planPayload: input.plan as unknown as Prisma.InputJsonValue,
          status: "DRAFT",
          readiness: input.plan.readiness,
          professionalOverrides: (input.professionalOverrides ?? []) as unknown as Prisma.InputJsonValue,
        },
      });
      return toRecord(row);
    }),
  );
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function findExecutionPlanForOwner(ownerUserId: string, planId: string): Promise<ProfessionalExecutionPlanRecord | null> {
  return runExecutionPlanQuery(async () => {
    const row = await prisma.professionalExecutionPlan.findFirst({ where: { id: planId, ownerUserId } });
    return row ? toRecord(row) : null;
  });
}

export async function listExecutionPlansForClient(ownerUserId: string, clientId: string): Promise<ProfessionalExecutionPlanRecord[]> {
  return runExecutionPlanQuery(async () => {
    const rows = await prisma.professionalExecutionPlan.findMany({
      where: { ownerUserId, clientId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    return rows.map(toRecord);
  });
}

export async function findCurrentConfirmedExecutionPlan(ownerUserId: string, clientId: string): Promise<ProfessionalExecutionPlanRecord | null> {
  return runExecutionPlanQuery(async () => {
    const rows = await prisma.professionalExecutionPlan.findMany({ where: { ownerUserId, clientId, status: "CONFIRMED" } });
    if (rows.length > 1) {
      throw new ExecutionPlanInvariantError(`Found ${rows.length} CONFIRMED Professional Execution Plans for one (owner ${ownerUserId}, client ${clientId}) -- there should never be more than one.`);
    }
    return rows[0] ? toRecord(rows[0]) : null;
  });
}

// ---------------------------------------------------------------------------
// confirmDraftExecutionPlan -- the ONE real professional-approval action.
// CAS semantics mirror confirmDraftReasoningProposal's own exact shape.
// ---------------------------------------------------------------------------

export async function confirmDraftExecutionPlan(
  ownerUserId: string,
  planId: string,
  confirmedByUserId: string,
  expectedCurrentConfirmedPlanId: string | null,
): Promise<ProfessionalExecutionPlanRecord | null> {
  return runExecutionPlanQuery(() =>
    runSerializableTransaction(async (tx) => {
      const target = await tx.professionalExecutionPlan.findFirst({ where: { id: planId, ownerUserId } });
      if (!target) return null;
      if (target.status !== "DRAFT") {
        throw new ExecutionPlanStateError(target.status, `Plan ${planId} is ${target.status}; only a DRAFT plan can be confirmed.`);
      }

      const currentConfirmed = await tx.professionalExecutionPlan.findFirst({
        where: { ownerUserId, clientId: target.clientId, status: "CONFIRMED" },
        select: { id: true },
      });
      const actualCurrentId = currentConfirmed?.id ?? null;
      if (actualCurrentId !== expectedCurrentConfirmedPlanId) {
        throw new ExecutionPlanConcurrencyError();
      }

      const now = new Date();
      if (currentConfirmed) {
        await tx.professionalExecutionPlan.update({
          where: { id: currentConfirmed.id },
          data: { status: "SUPERSEDED", supersededAt: now, supersededByPlanId: target.id },
        });
      }

      const confirmed = await tx.professionalExecutionPlan.update({
        where: { id: target.id },
        data: { status: "CONFIRMED", confirmedByUserId, confirmedAt: now },
      });
      return toRecord(confirmed);
    }),
  );
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

async function runExecutionPlanQuery<T>(operation: () => Promise<T>): Promise<T> {
  if (!isDatabaseConfigured()) throw new ExecutionPlanPersistenceError();
  try {
    return await operation();
  } catch (error) {
    if (
      error instanceof ExecutionPlanPersistenceError ||
      error instanceof ExecutionPlanDependencyError ||
      error instanceof ExecutionPlanValidationDbError ||
      error instanceof ExecutionPlanStateError ||
      error instanceof ExecutionPlanConcurrencyError ||
      error instanceof ExecutionPlanInvariantError
    ) {
      throw error;
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") {
      throw new ExecutionPlanDependencyError("EXECUTION_PLAN_CLIENT_NOT_FOUND", 404, "Professional Execution Plan dependencies changed.");
    }
    throw new ExecutionPlanPersistenceError();
  }
}

async function runSerializableTransaction<T>(operation: (tx: ExecutionPlanTransaction) => Promise<T>): Promise<T> {
  for (let attempt = 1; attempt <= MAX_TRANSACTION_ATTEMPTS; attempt += 1) {
    try {
      return await prisma.$transaction(operation, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (!isRetryableConcurrencyError(error)) throw error;
      if (attempt === MAX_TRANSACTION_ATTEMPTS) throw new ExecutionPlanConcurrencyError();
    }
  }
  throw new ExecutionPlanConcurrencyError();
}

function isRetryableConcurrencyError(error: unknown): boolean {
  if (
    error instanceof ExecutionPlanPersistenceError ||
    error instanceof ExecutionPlanDependencyError ||
    error instanceof ExecutionPlanValidationDbError ||
    error instanceof ExecutionPlanStateError ||
    error instanceof ExecutionPlanConcurrencyError ||
    error instanceof ExecutionPlanInvariantError
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

function toRecord(row: PrismaProfessionalExecutionPlanRow): ProfessionalExecutionPlanRecord {
  const plan = row.planPayload;
  if (!isValidProfessionalExecutionPlan(plan, (candidate): candidate is string => typeof candidate === "string")) {
    throw new ExecutionPlanPersistenceError();
  }
  if (!isProfessionalExecutionPlanStatus(row.status) || !isProfessionalExecutionPlanReadiness(row.readiness)) {
    throw new ExecutionPlanPersistenceError();
  }
  const professionalOverrides = row.professionalOverrides;
  return {
    id: row.id,
    ownerUserId: row.ownerUserId,
    clientId: row.clientId,
    currentSnapshotId: row.currentSnapshotId,
    currentSnapshotVersion: row.currentSnapshotVersion,
    targetSnapshotId: row.targetSnapshotId,
    targetSnapshotVersion: row.targetSnapshotVersion,
    sourceReasoningProposalId: row.sourceReasoningProposalId,
    reasoningProposalContextFingerprint: row.reasoningProposalContextFingerprint,
    plan,
    status: row.status,
    readiness: row.readiness,
    professionalOverrides: Array.isArray(professionalOverrides) ? professionalOverrides : [],
    confirmedByUserId: row.confirmedByUserId,
    confirmedAt: row.confirmedAt ? row.confirmedAt.toISOString() : null,
    supersededByPlanId: row.supersededByPlanId,
    supersededAt: row.supersededAt ? row.supersededAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
