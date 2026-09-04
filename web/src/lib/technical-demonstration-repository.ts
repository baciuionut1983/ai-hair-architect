import { randomUUID } from "crypto";

import { Prisma, type TechnicalDemonstrationPlan as PrismaTechnicalDemonstrationPlanRow, type TechnicalDemonstrationStep as PrismaTechnicalDemonstrationStepRow } from "@prisma/client";

import type { TechnicalCutPlan } from "@/lib/contracts";
import { isDatabaseConfigured, prisma } from "@/lib/prisma";
import { isProposalStatus, isProposalVertical, isTechnicalCutPlanShape, type ProposalEditEntry } from "@/lib/proposal-validators";
import { computeEffectiveTechnicalCutPlan, EDITABLE_TECHNIQUE_FIELDS } from "@/lib/technical-visual-map-assembler";
import {
  computeTechnicalDemonstrationPlanRequestFingerprint,
  isTechnicalDemonstrationPlanStatus,
  isTechnicalDemonstrationVertical,
  TECHNICAL_DEMONSTRATION_PLAN_STATUSES,
  type TechnicalDemonstrationPlanRecord,
  type TechnicalDemonstrationPlanStatus,
  type TechnicalDemonstrationStepRecord,
  type TechnicalDemonstrationVertical,
} from "@/lib/technical-demonstration-contracts";
import {
  CUTTING_DEMONSTRATION_STEP_SCHEMA_VERSION,
  isValidCuttingDemonstrationStepPayload,
  isValidCuttingExecutionPhaseSequence,
  type CuttingDemonstrationStepPayload,
} from "@/lib/technical-demonstration-cutting-contracts";
import {
  deriveCuttingDemonstrationSteps,
  TECHNICAL_DEMONSTRATION_CUTTING_GENERATOR_VERSION,
} from "@/lib/technical-demonstration-derivation";

// Technical Demonstration, Stage 1 ("cutting plan foundation only") -- the
// domain/repository layer. Deliberately mirrors
// technical-visual-map-repository.ts's own conventions exactly: the
// runSerializableTransaction retry-on-conflict helper, the runXQuery
// fail-closed wrapper, the ownership-check style (owner-scoped findFirst
// inside the transaction), and the typed-error taxonomy. No I/O beyond
// Postgres -- no provider call, no image/video generation anywhere in this
// file (Stage 1's own explicit scope).

const MAX_TRANSACTION_ATTEMPTS = 3;

export const TECHNICAL_DEMONSTRATION_PERSISTENCE_ERROR_CODE = "TECHNICAL_DEMONSTRATION_PERSISTENCE_UNAVAILABLE";

export class TechnicalDemonstrationPersistenceError extends Error {
  readonly code = TECHNICAL_DEMONSTRATION_PERSISTENCE_ERROR_CODE;
  readonly httpStatus = 503;

  constructor() {
    super("Technical Demonstration data is temporarily unavailable.");
    this.name = "TechnicalDemonstrationPersistenceError";
  }
}

export class TechnicalDemonstrationDependencyError extends Error {
  constructor(
    readonly code:
      | "TECHNICAL_DEMONSTRATION_CLIENT_NOT_FOUND"
      | "TECHNICAL_DEMONSTRATION_PROPOSAL_NOT_FOUND"
      | "TECHNICAL_DEMONSTRATION_PROPOSAL_CLIENT_MISMATCH"
      | "TECHNICAL_DEMONSTRATION_PROPOSAL_NOT_CONFIRMED"
      | "TECHNICAL_DEMONSTRATION_VERTICAL_NOT_SUPPORTED"
      | "TECHNICAL_DEMONSTRATION_DEPENDENCY_CHANGED",
    readonly httpStatus: 404 | 409 | 422,
    message: string,
  ) {
    super(message);
    this.name = "TechnicalDemonstrationDependencyError";
  }
}

// The deterministic derivation itself produced a payload that fails its
// own vertical-specific validator -- "should be impossible" (Stage 1's own
// derivation is pure and fully tested), but the repository never persists
// unvalidated JSON regardless, mirroring createProposalForOwner's own
// "validate everything that does not need the database FIRST" discipline.
export class TechnicalDemonstrationValidationError extends Error {
  readonly code = "TECHNICAL_DEMONSTRATION_INVALID_DERIVED_PAYLOAD";
  readonly httpStatus = 500;

  constructor(message: string) {
    super(message);
    this.name = "TechnicalDemonstrationValidationError";
  }
}

export class TechnicalDemonstrationStateError extends Error {
  readonly code = "TECHNICAL_DEMONSTRATION_ILLEGAL_STATE_TRANSITION";
  readonly httpStatus = 409;

  constructor(
    readonly fromStatus: string,
    readonly attempted: "confirm",
    message: string,
  ) {
    super(message);
    this.name = "TechnicalDemonstrationStateError";
  }
}

export class TechnicalDemonstrationConcurrencyError extends Error {
  readonly code = "TECHNICAL_DEMONSTRATION_CONCURRENCY_CONFLICT";
  readonly httpStatus = 409;

  constructor() {
    super("Technical Demonstration Plan could not be confirmed because of a concurrent confirmation.");
    this.name = "TechnicalDemonstrationConcurrencyError";
  }
}

export class TechnicalDemonstrationInvariantError extends Error {
  readonly code = "TECHNICAL_DEMONSTRATION_INVARIANT_VIOLATED";
  readonly httpStatus = 500;

  constructor(message: string) {
    super(message);
    this.name = "TechnicalDemonstrationInvariantError";
  }
}

type TechnicalDemonstrationTransaction = Pick<
  Prisma.TransactionClient,
  "technicalDemonstrationPlan" | "technicalDemonstrationStep" | "client" | "analysisProposal"
>;

export interface CreateTechnicalDemonstrationPlanOutcome {
  plan: TechnicalDemonstrationPlanRecord;
  steps: TechnicalDemonstrationStepRecord[];
  created: boolean;
}

// ---------------------------------------------------------------------------
// createTechnicalDemonstrationPlanFromProposal
// ---------------------------------------------------------------------------

// Derives (or idempotently resolves an already-derived) DRAFT Technical
// Demonstration Plan + its ordered Steps from the EXACT CONFIRMED
// AnalysisProposal identified by (ownerUserId, clientId,
// analysisProposalId). Stage 1 supports vertical="cutting" only -- any
// other proposal vertical is rejected (TECHNICAL_DEMONSTRATION_VERTICAL_NOT_SUPPORTED),
// never silently ignored or defaulted.
//
// Idempotent by construction (Stage 1's own explicit requirement):
// requestFingerprint is deterministically derived from
// (ownerUserId, clientId, analysisProposalId, proposal.confirmedAt,
// vertical, generatorVersion) -- a repeated call for the SAME confirmed
// proposal, before or after that proposal is later superseded, always
// resolves to the SAME already-created plan (created: false), never a
// duplicate. A newer confirmed proposal is a different row (different id
// and/or confirmedAt), so it naturally produces a different fingerprint --
// this is also what makes "a plan derived from proposal version N must
// never silently mutate if the proposal later changes" true by
// construction, with no active supersession logic required for that
// specific guarantee.
export async function createTechnicalDemonstrationPlanFromProposal(
  ownerUserId: string,
  clientId: string,
  analysisProposalId: string,
): Promise<CreateTechnicalDemonstrationPlanOutcome> {
  return runTechnicalDemonstrationQuery(() =>
    runSerializableTransaction(async (tx) => {
      const client = await tx.client.findFirst({ where: { id: clientId, ownerUserId, deletedAt: null }, select: { id: true } });
      if (!client) {
        throw new TechnicalDemonstrationDependencyError("TECHNICAL_DEMONSTRATION_CLIENT_NOT_FOUND", 404, "Client not found.");
      }

      // Owner-scoped lookup, then an explicit clientId equality check --
      // never assuming transitive trust, mirroring
      // createDraftFromConfirmedProposal's own identical proposal lookup.
      const proposalRow = await tx.analysisProposal.findFirst({ where: { id: analysisProposalId, ownerUserId } });
      if (!proposalRow) {
        throw new TechnicalDemonstrationDependencyError("TECHNICAL_DEMONSTRATION_PROPOSAL_NOT_FOUND", 404, "Proposal not found.");
      }
      if (proposalRow.clientId !== clientId) {
        throw new TechnicalDemonstrationDependencyError(
          "TECHNICAL_DEMONSTRATION_PROPOSAL_CLIENT_MISMATCH",
          404,
          "Proposal does not belong to this client.",
        );
      }
      if (!isProposalStatus(proposalRow.status) || proposalRow.status !== "CONFIRMED") {
        throw new TechnicalDemonstrationDependencyError(
          "TECHNICAL_DEMONSTRATION_PROPOSAL_NOT_CONFIRMED",
          422,
          "Only a CONFIRMED proposal can produce a Technical Demonstration Plan.",
        );
      }
      if (!isProposalVertical(proposalRow.vertical) || !isTechnicalDemonstrationVertical(proposalRow.vertical)) {
        throw new TechnicalDemonstrationDependencyError(
          "TECHNICAL_DEMONSTRATION_VERTICAL_NOT_SUPPORTED",
          422,
          `Technical Demonstration does not yet support the "${proposalRow.vertical}" vertical.`,
        );
      }
      if (proposalRow.confirmedAt === null) {
        // Structurally unreachable given the CONFIRMED check above (the
        // repository layer that confirms a proposal always sets
        // confirmedAt in the same write) -- defended anyway, never
        // trusted implicitly.
        throw new TechnicalDemonstrationInvariantError("A CONFIRMED proposal is missing its own confirmedAt timestamp.");
      }

      const vertical: TechnicalDemonstrationVertical = proposalRow.vertical;
      const analysisProposalConfirmedAt = proposalRow.confirmedAt;
      const generatorVersion = TECHNICAL_DEMONSTRATION_CUTTING_GENERATOR_VERSION;

      const requestFingerprint = computeTechnicalDemonstrationPlanRequestFingerprint({
        ownerUserId,
        clientId,
        analysisProposalId,
        analysisProposalConfirmedAt: analysisProposalConfirmedAt.toISOString(),
        vertical,
        generatorVersion,
      });

      const existingPlan = await tx.technicalDemonstrationPlan.findFirst({ where: { requestFingerprint } });
      if (existingPlan) {
        const steps = await tx.technicalDemonstrationStep.findMany({
          where: { planId: existingPlan.id, ownerUserId, clientId },
          orderBy: { stepNumber: "asc" },
        });
        return { plan: toTechnicalDemonstrationPlanRecord(existingPlan), steps: steps.map(toTechnicalDemonstrationStepRecord), created: false };
      }

      // RELEASE-BLOCKER FIX: proposal.payload ALONE is only ever the
      // engine's frozen baseline -- a professional's edit before
      // confirmation lives separately, in proposal.edits, and is NEVER
      // merged back into payload (same fact TechnicalVisualMap's own
      // createDraftFromConfirmedProposal already has to account for).
      // Reuses that exact same, already-proven merge function -- never a
      // second, competing implementation of "what did the professional
      // actually approve".
      const cuttingPlan = proposalRow.payload as unknown as TechnicalCutPlan;
      const edits = (proposalRow.edits ?? []) as unknown as ProposalEditEntry[];
      const effectivePlan = computeEffectiveTechnicalCutPlan(cuttingPlan, edits);

      // Defensive re-validation of the EFFECTIVE (post-merge) plan --
      // mirrors assembleCuttingTechnicalVisualMap's own identical guard
      // exactly (reuses the same shared isTechnicalCutPlanShape validator,
      // never a second copy): the effective plan is a newly-derived object
      // (an edit's own newValue is never independently re-validated at
      // write time beyond ProposalEditEntry's own generic shape), so it
      // must be proven structurally sound before anything is derived from
      // it -- fail safely rather than persist malformed data.
      if (!isTechnicalCutPlanShape(effectivePlan)) {
        throw new TechnicalDemonstrationValidationError(
          `Proposal ${analysisProposalId}'s effective technical cut plan (baseline + edits merged) failed structural validation; refusing to derive a Technical Demonstration Plan from malformed data.`,
        );
      }

      // Which of the editable technique fields did a real edit actually
      // touch -- provenance-only (see deriveCuttingDemonstrationSteps's own
      // header comment): never affects the VALUE (effectivePlan already
      // has the right value either way), only whether that value's own
      // derived step fields are tagged PROFESSIONAL_OVERRIDE instead of a
      // generic INFERRED.
      const editableFieldNames: readonly string[] = EDITABLE_TECHNIQUE_FIELDS;
      const editedFields = new Set(edits.map((edit) => edit.field).filter((field) => editableFieldNames.includes(field)));

      // Pure derivation -- no I/O, no provider call. Runs against the
      // EFFECTIVE plan (baseline + edits already merged above), never the
      // raw frozen baseline alone.
      const derivedSteps = deriveCuttingDemonstrationSteps(effectivePlan, editedFields);

      for (const derivedStep of derivedSteps) {
        if (!isValidCuttingDemonstrationStepPayload(derivedStep.payload)) {
          throw new TechnicalDemonstrationValidationError(
            `Derived step ${derivedStep.stepNumber} produced a structurally invalid payload -- refusing to persist.`,
          );
        }
      }

      // Stage 2.5.a defensive check: the derived steps' own resolved
      // execution phases must never regress (see
      // isValidCuttingExecutionPhaseSequence's own header comment) --
      // "should be impossible" given the pure, order-preserving derivation
      // above, but the repository never persists unvalidated structure
      // regardless, mirroring this exact file's own established discipline
      // for every other defensive re-check above.
      const phaseSequence = derivedSteps.map((derivedStep) => (derivedStep.payload as CuttingDemonstrationStepPayload).phase.value);
      if (!isValidCuttingExecutionPhaseSequence(phaseSequence)) {
        throw new TechnicalDemonstrationValidationError(
          `Derived steps for proposal ${analysisProposalId} report execution phases out of canonical order -- refusing to persist.`,
        );
      }

      const maxVersion = await tx.technicalDemonstrationPlan.aggregate({
        where: { ownerUserId, clientId, analysisProposalId, vertical },
        _max: { planVersion: true },
      });
      const nextPlanVersion = (maxVersion._max.planVersion ?? 0) + 1;

      const planRow = await tx.technicalDemonstrationPlan.create({
        data: {
          id: randomUUID(),
          ownerUserId,
          clientId,
          analysisProposalId,
          analysisProposalConfirmedAt,
          vertical,
          status: "DRAFT",
          planVersion: nextPlanVersion,
          schemaVersion: CUTTING_DEMONSTRATION_STEP_SCHEMA_VERSION,
          generatorVersion,
          requestFingerprint,
        },
      });

      const stepRows = await Promise.all(
        derivedSteps.map((derivedStep) =>
          tx.technicalDemonstrationStep.create({
            data: {
              id: randomUUID(),
              ownerUserId,
              clientId,
              planId: planRow.id,
              vertical,
              stepNumber: derivedStep.stepNumber,
              stepSchemaVersion: CUTTING_DEMONSTRATION_STEP_SCHEMA_VERSION,
              payload: derivedStep.payload as unknown as Prisma.InputJsonValue,
              explanation: derivedStep.explanation,
            },
          }),
        ),
      );

      return {
        plan: toTechnicalDemonstrationPlanRecord(planRow),
        steps: stepRows.map(toTechnicalDemonstrationStepRecord),
        created: true,
      };
    }),
  );
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function findTechnicalDemonstrationPlanForOwner(
  ownerUserId: string,
  planId: string,
): Promise<TechnicalDemonstrationPlanRecord | null> {
  return runTechnicalDemonstrationQuery(async () => {
    const row = await prisma.technicalDemonstrationPlan.findFirst({ where: { id: planId, ownerUserId } });
    return row ? toTechnicalDemonstrationPlanRecord(row) : null;
  });
}

// Stage 2 -- full version history for this exact owned (client, proposal,
// vertical) scope, newest planVersion first. Mirrors listMapsForProposal
// (technical-visual-map-repository.ts) exactly. Bare metadata only (no
// steps) -- the same "history rows don't need full detail" precedent
// listMapsForProposal's own list response already establishes; a caller
// that needs one specific historical plan's steps uses
// findTechnicalDemonstrationPlanForOwner + listTechnicalDemonstrationStepsForPlan
// for that one plan.
export async function listTechnicalDemonstrationPlansForProposal(
  ownerUserId: string,
  clientId: string,
  analysisProposalId: string,
  vertical: string,
): Promise<TechnicalDemonstrationPlanRecord[]> {
  return runTechnicalDemonstrationQuery(async () => {
    const rows = await prisma.technicalDemonstrationPlan.findMany({
      where: { ownerUserId, clientId, analysisProposalId, vertical },
      orderBy: [{ planVersion: "desc" }, { id: "desc" }],
    });
    return rows.map(toTechnicalDemonstrationPlanRecord);
  });
}

export async function listTechnicalDemonstrationStepsForPlan(
  ownerUserId: string,
  clientId: string,
  planId: string,
): Promise<TechnicalDemonstrationStepRecord[]> {
  return runTechnicalDemonstrationQuery(async () => {
    const rows = await prisma.technicalDemonstrationStep.findMany({
      where: { planId, ownerUserId, clientId },
      orderBy: { stepNumber: "asc" },
    });
    return rows.map(toTechnicalDemonstrationStepRecord);
  });
}

// The single CONFIRMED plan (if any) for this exact
// (ownerUserId, clientId, analysisProposalId, vertical) scope -- mirrors
// findCurrentConfirmedMap exactly, including its own
// "more than one is a real integrity bug, never silently resolved"
// guarantee.
export async function findCurrentConfirmedTechnicalDemonstrationPlan(
  ownerUserId: string,
  clientId: string,
  analysisProposalId: string,
  vertical: string,
): Promise<TechnicalDemonstrationPlanRecord | null> {
  return runTechnicalDemonstrationQuery(async () => {
    const rows = await prisma.technicalDemonstrationPlan.findMany({
      where: { ownerUserId, clientId, analysisProposalId, vertical, status: "CONFIRMED" },
    });
    if (rows.length === 0) return null;
    if (rows.length > 1) {
      throw new TechnicalDemonstrationInvariantError(
        `Found ${rows.length} CONFIRMED Technical Demonstration Plans for the same (owner, client, proposal, vertical) scope -- expected at most 1.`,
      );
    }
    return toTechnicalDemonstrationPlanRecord(rows[0]);
  });
}

// ---------------------------------------------------------------------------
// confirmTechnicalDemonstrationPlan
// ---------------------------------------------------------------------------

// Professional-approval gate -- mirrors confirmDraftMap
// (technical-visual-map-repository.ts) exactly, including its own
// optimistic-concurrency compare-and-swap against
// expectedCurrentConfirmedPlanId and its own automatic supersession of
// whatever WAS confirmed for this exact scope.
export async function confirmTechnicalDemonstrationPlan(
  ownerUserId: string,
  planId: string,
  expectedCurrentConfirmedPlanId: string | null,
): Promise<TechnicalDemonstrationPlanRecord | null> {
  return runTechnicalDemonstrationQuery(async () => {
    const preflight = await prisma.technicalDemonstrationPlan.findFirst({
      where: { id: planId, ownerUserId },
      select: { id: true, status: true },
    });
    if (!preflight) return null;
    if (preflight.status !== "DRAFT") {
      throw new TechnicalDemonstrationStateError(
        preflight.status,
        "confirm",
        `Technical Demonstration Plan ${planId} is ${preflight.status}; only a DRAFT plan can be confirmed.`,
      );
    }

    return runSerializableTransaction(async (tx) => {
      const target = await tx.technicalDemonstrationPlan.findFirst({ where: { id: planId, ownerUserId } });
      if (!target) return null;

      if (target.status !== "DRAFT") {
        throw new TechnicalDemonstrationStateError(
          target.status,
          "confirm",
          `Technical Demonstration Plan ${planId} is ${target.status}; only a DRAFT plan can be confirmed.`,
        );
      }

      const existingConfirmed = await tx.technicalDemonstrationPlan.findFirst({
        where: {
          ownerUserId,
          clientId: target.clientId,
          analysisProposalId: target.analysisProposalId,
          vertical: target.vertical,
          status: "CONFIRMED",
        },
        select: { id: true },
      });

      if ((existingConfirmed?.id ?? null) !== expectedCurrentConfirmedPlanId) {
        throw new TechnicalDemonstrationConcurrencyError();
      }

      const now = new Date();

      if (existingConfirmed) {
        await tx.technicalDemonstrationPlan.update({
          where: { id: existingConfirmed.id },
          data: { status: "SUPERSEDED", supersededByPlanId: target.id, supersededAt: now },
        });
      }

      const updated = await tx.technicalDemonstrationPlan.update({
        where: { id: target.id },
        data: { status: "CONFIRMED", confirmedAt: now },
      });
      return toTechnicalDemonstrationPlanRecord(updated);
    });
  });
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

async function runTechnicalDemonstrationQuery<T>(operation: () => Promise<T>): Promise<T> {
  if (!isDatabaseConfigured()) throw new TechnicalDemonstrationPersistenceError();

  try {
    return await operation();
  } catch (error) {
    if (
      error instanceof TechnicalDemonstrationPersistenceError ||
      error instanceof TechnicalDemonstrationDependencyError ||
      error instanceof TechnicalDemonstrationConcurrencyError ||
      error instanceof TechnicalDemonstrationValidationError ||
      error instanceof TechnicalDemonstrationStateError ||
      error instanceof TechnicalDemonstrationInvariantError
    ) {
      throw error;
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") {
      throw new TechnicalDemonstrationDependencyError(
        "TECHNICAL_DEMONSTRATION_DEPENDENCY_CHANGED",
        409,
        "Technical Demonstration dependencies changed.",
      );
    }
    throw new TechnicalDemonstrationPersistenceError();
  }
}

async function runSerializableTransaction<T>(operation: (tx: TechnicalDemonstrationTransaction) => Promise<T>): Promise<T> {
  for (let attempt = 1; attempt <= MAX_TRANSACTION_ATTEMPTS; attempt += 1) {
    try {
      return await prisma.$transaction(operation, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (!isRetryableConcurrencyError(error)) throw error;
      if (attempt === MAX_TRANSACTION_ATTEMPTS) throw new TechnicalDemonstrationConcurrencyError();
    }
  }

  throw new TechnicalDemonstrationConcurrencyError();
}

function isRetryableConcurrencyError(error: unknown): boolean {
  if (
    error instanceof TechnicalDemonstrationConcurrencyError ||
    error instanceof TechnicalDemonstrationStateError ||
    error instanceof TechnicalDemonstrationDependencyError ||
    error instanceof TechnicalDemonstrationValidationError ||
    error instanceof TechnicalDemonstrationInvariantError ||
    error instanceof TechnicalDemonstrationPersistenceError
  ) {
    return false;
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    // P2034: transaction write conflict / deadlock (Postgres 40001 / 40P01).
    if (error.code === "P2034") return true;
    // P2002 on this table's own non-primary-key unique constraints (either
    // the ordinary planVersion uniqueness, hit by two concurrent creates
    // computing the same next version, the requestFingerprint uniqueness,
    // hit by two concurrent idempotent create attempts, or the confirmed-
    // plan race, hit by two concurrent confirmations) -- all represent
    // "another transaction committed first, re-read fresh data and try
    // again", exactly like TechnicalVisualMap's own identical precedent.
    if (error.code === "P2002" && hitsTechnicalDemonstrationUniqueIndex(error)) return true;
    return false;
  }

  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return message.includes("deadlock") || message.includes("serialization");
}

function hitsTechnicalDemonstrationUniqueIndex(error: Prisma.PrismaClientKnownRequestError): boolean {
  const meta = (error.meta ?? {}) as Record<string, unknown>;
  const target = meta.target;
  const targetText = Array.isArray(target) ? target.join(",") : String(target ?? "");
  return targetText.includes("TechnicalDemonstrationPlan") || targetText.includes("planVersion") || targetText.includes("requestFingerprint");
}

function toTechnicalDemonstrationPlanRecord(row: PrismaTechnicalDemonstrationPlanRow): TechnicalDemonstrationPlanRecord {
  if (!isTechnicalDemonstrationVertical(row.vertical) || !isTechnicalDemonstrationPlanStatus(row.status)) {
    throw new TechnicalDemonstrationPersistenceError();
  }
  const status: TechnicalDemonstrationPlanStatus = row.status;
  if (!(TECHNICAL_DEMONSTRATION_PLAN_STATUSES as readonly string[]).includes(status)) {
    throw new TechnicalDemonstrationPersistenceError();
  }

  return {
    id: row.id,
    ownerUserId: row.ownerUserId,
    clientId: row.clientId,
    analysisProposalId: row.analysisProposalId,
    analysisProposalConfirmedAt: row.analysisProposalConfirmedAt.toISOString(),
    vertical: row.vertical,
    status,
    planVersion: row.planVersion,
    schemaVersion: row.schemaVersion,
    generatorVersion: row.generatorVersion,
    requestFingerprint: row.requestFingerprint,
    supersededByPlanId: row.supersededByPlanId,
    confirmedAt: row.confirmedAt ? row.confirmedAt.toISOString() : null,
    supersededAt: row.supersededAt ? row.supersededAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toTechnicalDemonstrationStepRecord(row: PrismaTechnicalDemonstrationStepRow): TechnicalDemonstrationStepRecord {
  if (!isTechnicalDemonstrationVertical(row.vertical)) {
    throw new TechnicalDemonstrationPersistenceError();
  }

  return {
    id: row.id,
    ownerUserId: row.ownerUserId,
    clientId: row.clientId,
    planId: row.planId,
    vertical: row.vertical,
    stepNumber: row.stepNumber,
    stepSchemaVersion: row.stepSchemaVersion,
    payload: row.payload as unknown as Record<string, unknown>,
    explanation: row.explanation,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
