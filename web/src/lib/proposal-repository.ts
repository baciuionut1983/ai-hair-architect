import { randomUUID } from "crypto";

import { Prisma, type AnalysisProposal as PrismaAnalysisProposalRow } from "@prisma/client";

import type { TechnicalCutPlan } from "@/lib/contracts";
import { isDatabaseConfigured, prisma } from "@/lib/prisma";
import {
  isConsideredMemoryEntry,
  isLegalProposalStatusTransition,
  isNonEmptyString,
  isProposalEditEntry,
  isProposalStatus,
  isProposalVertical,
  isPromotedConsultationSourceEntry,
  isRecord,
  isValidProposalPayload,
  PROPOSAL_VERTICALS,
  type ConsideredMemoryEntry,
  type ProposalEditEntry,
  type ProposalStatus,
  type ProposalVertical,
  type PromotedConsultationSourceEntry,
} from "@/lib/proposal-validators";

// AI Proposed Look (Phase 2), Stage 2 -- the domain/repository layer for
// AnalysisProposal. Deliberately mirrors analysis-repository.ts's own
// conventions: the runSerializableTransaction retry-on-conflict helper, the
// runXQuery fail-closed wrapper, the ownership-check style (owner-scoped
// findFirst inside the transaction, exactly like createAnalysisForOwner), and
// the typed-error taxonomy (a persistence error, a dependency error, a
// concurrency error, a validation error).
//
// No API routes, no UI, no Consult AI hook -- see the Stage 2 task scope.

export const PROPOSAL_PERSISTENCE_ERROR_CODE = "PROPOSAL_PERSISTENCE_UNAVAILABLE";
const MAX_PROPOSAL_TRANSACTION_ATTEMPTS = 3;

// The hand-authored partial unique index from the Stage 1 migration
// (migrations/20260827_analysis_proposal/migration.sql). It is the real
// backstop against a race producing two CONFIRMED rows for one
// (ownerUserId, clientId, vertical); confirmProposal treats a write that
// trips it as an expected, retryable conflict outcome.
const CONFIRMED_UNIQUE_INDEX = "AnalysisProposal_one_confirmed_per_owner_client_vertical";

// ---------------------------------------------------------------------------
// Typed errors (shape-matched to analysis-repository.ts)
// ---------------------------------------------------------------------------

export class ProposalPersistenceError extends Error {
  readonly code = PROPOSAL_PERSISTENCE_ERROR_CODE;
  readonly httpStatus = 503;

  constructor() {
    super("Proposal data is temporarily unavailable.");
    this.name = "ProposalPersistenceError";
  }
}

export class ProposalDependencyError extends Error {
  constructor(
    readonly code:
      | "PROPOSAL_CLIENT_NOT_FOUND"
      | "PROPOSAL_ANALYSIS_NOT_FOUND"
      | "PROPOSAL_ANALYSIS_CLIENT_MISMATCH"
      | "PROPOSAL_DEPENDENCY_CHANGED",
    readonly httpStatus: 404 | 409,
    message: string,
  ) {
    super(message);
    this.name = "ProposalDependencyError";
  }
}

export class ProposalValidationError extends Error {
  readonly httpStatus = 422;

  constructor(
    readonly code:
      | "PROPOSAL_INVALID_VERTICAL"
      | "PROPOSAL_INVALID_PAYLOAD"
      | "PROPOSAL_INVALID_EVIDENCE"
      | "PROPOSAL_INVALID_EDIT"
      | "PROPOSAL_INVALID_PROVENANCE",
    message: string,
  ) {
    super(message);
    this.name = "ProposalValidationError";
  }
}

// A lifecycle rule was broken: edit / reject / confirm attempted on a row that
// is not currently DRAFT (or any other move outside the four legal
// transitions). Always thrown BEFORE any write -- never a partial write, never
// a silent no-op.
export class ProposalStateError extends Error {
  readonly code = "PROPOSAL_ILLEGAL_STATE_TRANSITION";
  readonly httpStatus = 409;

  constructor(
    readonly fromStatus: string,
    readonly attempted: "edit" | "reject" | "confirm" | "promote",
    message: string,
  ) {
    super(message);
    this.name = "ProposalStateError";
  }
}

export class ProposalConcurrencyError extends Error {
  readonly code = "PROPOSAL_CONCURRENCY_CONFLICT";
  readonly httpStatus = 409;

  constructor() {
    super("Proposal could not be confirmed because of a concurrent confirmation.");
    this.name = "ProposalConcurrencyError";
  }
}

// "This should be impossible" -- the persisted data violates the single
// CONFIRMED-per-(owner, client, vertical) invariant the partial unique index
// exists to enforce. Distinct from ProposalPersistenceError (503, "try again
// later"): this is a 500-class integrity bug to catch, never to paper over by
// silently picking one row.
export class ProposalInvariantError extends Error {
  readonly code = "PROPOSAL_CONFIRMED_INVARIANT_VIOLATED";
  readonly httpStatus = 500;

  constructor(message: string) {
    super(message);
    this.name = "ProposalInvariantError";
  }
}

// ---------------------------------------------------------------------------
// Record shape returned to callers
// ---------------------------------------------------------------------------

export interface ProposalRecord {
  id: string;
  ownerUserId: string;
  clientId: string;
  analysisId: string;
  vertical: ProposalVertical;
  status: ProposalStatus;
  /** The source Analysis.updatedAt, frozen at creation time (ISO 8601). */
  analysisSnapshotAt: string;
  sourceImageAssetId: string | null;
  sourceImageAnalysisId: string | null;
  engineVersion: string;
  /** Frozen INPUT evidence read from the source Analysis at creation time. */
  evidenceSnapshot: Record<string, unknown>;
  /** Frozen deterministic-engine OUTPUT. For vertical='cutting': a TechnicalCutPlan. */
  payload: TechnicalCutPlan;
  /** Additive provenance layered on top of `payload` -- never an overwrite. `[]` when the DRAFT was never edited. */
  edits: ProposalEditEntry[];
  /** Frozen content snapshots of every ProfessionalMemory row used to resolve this proposal. `[]` when none. */
  consideredMemory: ConsideredMemoryEntry[];
  primaryConsultationMessageId: string | null;
  /** Frozen snapshots of every explicitly-promoted consultation insight. `[]` when none. */
  promotedConsultationSources: PromotedConsultationSourceEntry[];
  supersededByProposalId: string | null;
  confirmedByUserId: string | null;
  confirmedAt: string | null;
  rejectedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// Optional tail of createProposalForOwner -- soft ID pointers and frozen
// provenance arrays. Kept as a trailing options object so the required
// positional arguments still read like the Stage 2 spec's signature.
export interface CreateProposalExtras {
  sourceImageAssetId?: string | null;
  sourceImageAnalysisId?: string | null;
  consideredMemory?: ConsideredMemoryEntry[];
  primaryConsultationMessageId?: string | null;
  promotedConsultationSources?: PromotedConsultationSourceEntry[];
}

type ProposalTransaction = Pick<Prisma.TransactionClient, "analysisProposal" | "client" | "analysis">;

// ---------------------------------------------------------------------------
// createProposalForOwner
// ---------------------------------------------------------------------------

export async function createProposalForOwner(
  ownerUserId: string,
  clientId: string,
  analysisId: string,
  vertical: string,
  payload: unknown,
  evidenceSnapshot: unknown,
  engineVersion: string,
  extras: CreateProposalExtras = {},
): Promise<ProposalRecord> {
  // Validate everything that does not need the database FIRST, and reject
  // before opening a transaction -- never insert a row that fails a check
  // (mirrors applyAnalysisCorrection validating `value` up front).
  if (!isProposalVertical(vertical)) {
    throw new ProposalValidationError(
      "PROPOSAL_INVALID_VERTICAL",
      `"${vertical}" is not one of the supported proposal verticals (${PROPOSAL_VERTICALS.join(", ")}).`,
    );
  }
  if (!isNonEmptyString(engineVersion)) {
    throw new ProposalValidationError("PROPOSAL_INVALID_PAYLOAD", "engineVersion is required.");
  }
  if (!isRecord(evidenceSnapshot)) {
    throw new ProposalValidationError("PROPOSAL_INVALID_EVIDENCE", "evidenceSnapshot must be a JSON object.");
  }
  if (!isValidProposalPayload(vertical, payload)) {
    throw new ProposalValidationError(
      "PROPOSAL_INVALID_PAYLOAD",
      `payload is not a structurally valid "${vertical}" plan.`,
    );
  }
  const consideredMemory = normalizeConsideredMemory(extras.consideredMemory);
  const promotedConsultationSources = normalizePromotedConsultationSources(extras.promotedConsultationSources);

  return runProposalQuery(() =>
    runSerializableTransaction(async (tx) => {
      // (1) The client must belong to this owner (findClientForOwner-style
      // check, done inline in the transaction exactly like
      // createAnalysisForOwner does).
      const client = await tx.client.findFirst({
        where: { id: clientId, ownerUserId, deletedAt: null },
        select: { id: true },
      });
      if (!client) {
        throw new ProposalDependencyError("PROPOSAL_CLIENT_NOT_FOUND", 404, "Client not found.");
      }

      // (2) The analysis must belong to the SAME owner AND the SAME client.
      // Verified as two explicit checks -- owner-scoped lookup, then an
      // explicit clientId equality -- never assuming transitive trust.
      const analysis = await tx.analysis.findFirst({
        where: { id: analysisId, ownerUserId },
        select: { id: true, clientId: true, updatedAt: true, imageAssetId: true, imageAnalysisId: true },
      });
      if (!analysis) {
        throw new ProposalDependencyError("PROPOSAL_ANALYSIS_NOT_FOUND", 404, "Analysis not found.");
      }
      if (analysis.clientId !== clientId) {
        throw new ProposalDependencyError(
          "PROPOSAL_ANALYSIS_CLIENT_MISMATCH",
          404,
          "Analysis does not belong to this client.",
        );
      }

      const row = await tx.analysisProposal.create({
        data: {
          id: randomUUID(),
          ownerUserId,
          clientId,
          analysisId,
          vertical,
          status: "DRAFT",
          // Frozen from the source Analysis's own updatedAt.
          analysisSnapshotAt: analysis.updatedAt,
          sourceImageAssetId:
            extras.sourceImageAssetId !== undefined
              ? extras.sourceImageAssetId
              : analysis.imageAssetId ?? null,
          sourceImageAnalysisId:
            extras.sourceImageAnalysisId !== undefined
              ? extras.sourceImageAnalysisId
              : analysis.imageAnalysisId ?? null,
          engineVersion,
          evidenceSnapshot: evidenceSnapshot as unknown as Prisma.InputJsonValue,
          payload: payload as unknown as Prisma.InputJsonValue,
          // A brand-new DRAFT has never been edited -- `edits` stays null
          // until editDraftProposal appends to it.
          edits: Prisma.JsonNull,
          consideredMemory:
            consideredMemory.length > 0
              ? (consideredMemory as unknown as Prisma.InputJsonValue)
              : Prisma.JsonNull,
          primaryConsultationMessageId: extras.primaryConsultationMessageId ?? null,
          promotedConsultationSources:
            promotedConsultationSources.length > 0
              ? (promotedConsultationSources as unknown as Prisma.InputJsonValue)
              : Prisma.JsonNull,
        },
      });

      return toProposalRecord(row);
    }),
  );
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

// Owner-scoped lookup. Returns null when the proposal does not exist or is not
// owned by this user -- mirrors findAnalysisForOwner's null-vs-throw contract
// exactly (a not-found read is never an error).
export async function findProposalForOwner(
  ownerUserId: string,
  proposalId: string,
): Promise<ProposalRecord | null> {
  return runProposalQuery(async () => {
    const row = await prisma.analysisProposal.findFirst({ where: { id: proposalId, ownerUserId } });
    return row ? toProposalRecord(row) : null;
  });
}

// Full history for one client + vertical, newest first, owner-scoped.
export async function listProposalsForOwner(
  ownerUserId: string,
  clientId: string,
  vertical: string,
): Promise<ProposalRecord[]> {
  return runProposalQuery(async () => {
    const rows = await prisma.analysisProposal.findMany({
      where: { ownerUserId, clientId, vertical },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    return rows.map(toProposalRecord);
  });
}

// The single CONFIRMED proposal (if any) for this exact
// (ownerUserId, clientId, vertical) triple. Given the partial unique index
// there can structurally never be more than one -- if two are ever found that
// is a real integrity bug, surfaced as ProposalInvariantError, never silently
// resolved by picking one.
export async function findCurrentConfirmedProposal(
  ownerUserId: string,
  clientId: string,
  vertical: string,
): Promise<ProposalRecord | null> {
  return runProposalQuery(async () => {
    const rows = await prisma.analysisProposal.findMany({
      where: { ownerUserId, clientId, vertical, status: "CONFIRMED" },
      orderBy: [{ confirmedAt: "desc" }, { id: "desc" }],
    });
    if (rows.length > 1) {
      throw new ProposalInvariantError(
        `Found ${rows.length} CONFIRMED "${vertical}" proposals for one client ` +
          `(owner ${ownerUserId}, client ${clientId}) -- the partial unique index should make this impossible.`,
      );
    }
    return rows[0] ? toProposalRecord(rows[0]) : null;
  });
}

// ---------------------------------------------------------------------------
// editDraftProposal
// ---------------------------------------------------------------------------

// Legal only while the row is DRAFT. Appends the given entries to (or seeds)
// the `edits` Json array -- one entry per changed field, shape
// { field, previousValue, newValue, source, reason? }. Never mutates
// `payload` (the frozen AI/engine baseline). Rejects with a typed error and
// writes nothing if the row is not currently DRAFT.
export async function editDraftProposal(
  ownerUserId: string,
  proposalId: string,
  edits: ProposalEditEntry[],
): Promise<ProposalRecord | null> {
  if (!Array.isArray(edits) || edits.length === 0) {
    throw new ProposalValidationError("PROPOSAL_INVALID_EDIT", "edits must be a non-empty array.");
  }
  const normalizedEdits = edits.map((edit, index) => {
    if (!isProposalEditEntry(edit)) {
      throw new ProposalValidationError(
        "PROPOSAL_INVALID_EDIT",
        `edits[${index}] must be { field, previousValue, newValue, source } with a valid source.`,
      );
    }
    return sanitizeEditEntry(edit);
  });

  return runProposalQuery(() =>
    runSerializableTransaction(async (tx) => {
      const row = await tx.analysisProposal.findFirst({ where: { id: proposalId, ownerUserId } });
      if (!row) return null;

      // Editing keeps the row in DRAFT (it is not a status transition), so it
      // is gated on the current status being DRAFT rather than on the
      // transition matrix.
      if (row.status !== "DRAFT") {
        throw new ProposalStateError(
          row.status,
          "edit",
          `Proposal ${proposalId} is ${row.status}; only a DRAFT proposal can be edited.`,
        );
      }

      const existing = parseEdits(row.edits);
      const nextEdits = [...existing, ...normalizedEdits];

      const updated = await tx.analysisProposal.update({
        where: { id: row.id },
        data: {
          edits: nextEdits as unknown as Prisma.InputJsonValue,
          // `payload` is deliberately absent from this data block: the frozen
          // engine baseline is never overwritten by an edit.
        },
      });
      return toProposalRecord(updated);
    }),
  );
}

// ---------------------------------------------------------------------------
// rejectProposal
// ---------------------------------------------------------------------------

// Legal only from DRAFT. Sets status REJECTED + rejectedAt. Rejects with a
// typed error (no write) from any other status.
export async function rejectProposal(
  ownerUserId: string,
  proposalId: string,
): Promise<ProposalRecord | null> {
  return runProposalQuery(() =>
    runSerializableTransaction(async (tx) => {
      const row = await tx.analysisProposal.findFirst({ where: { id: proposalId, ownerUserId } });
      if (!row) return null;

      if (!isLegalProposalStatusTransition(row.status, "REJECTED")) {
        throw new ProposalStateError(
          row.status,
          "reject",
          `Proposal ${proposalId} is ${row.status}; only a DRAFT proposal can be rejected.`,
        );
      }

      const updated = await tx.analysisProposal.update({
        where: { id: row.id },
        data: { status: "REJECTED", rejectedAt: new Date() },
      });
      return toProposalRecord(updated);
    }),
  );
}

// ---------------------------------------------------------------------------
// promoteConsultationSourceToDraft
// ---------------------------------------------------------------------------

// AI Proposed Look (Phase 2), Stage 5 -- attaches one explicitly-promoted
// Consult AI source to a DRAFT's provenance. Legal only on DRAFT (same
// lifecycle guard as every other mutation here). Idempotent on
// `consultationMessageId`: re-promoting the same source is a true no-op --
// no duplicate entry, no update to the existing entry's snapshot/timestamp,
// and no write at all (so `updatedAt` does not change), because the
// original snapshot is what stays authoritative. Every other column
// (edits, payload, evidenceSnapshot, status, ...) is left untouched.
export async function promoteConsultationSourceToDraft(
  ownerUserId: string,
  proposalId: string,
  source: PromotedConsultationSourceEntry,
): Promise<ProposalRecord | null> {
  if (!isPromotedConsultationSourceEntry(source)) {
    throw new ProposalValidationError(
      "PROPOSAL_INVALID_PROVENANCE",
      "source must be { consultationMessageId, snapshotContent, promotedAt }.",
    );
  }

  return runProposalQuery(() =>
    runSerializableTransaction(async (tx) => {
      const row = await tx.analysisProposal.findFirst({ where: { id: proposalId, ownerUserId } });
      if (!row) return null;

      if (row.status !== "DRAFT") {
        throw new ProposalStateError(
          row.status,
          "promote",
          `Proposal ${proposalId} is ${row.status}; only a DRAFT proposal can have a consultation source promoted onto it.`,
        );
      }

      const existing = parsePromotedConsultationSources(row.promotedConsultationSources);
      const alreadyPromoted = existing.some((entry) => entry.consultationMessageId === source.consultationMessageId);
      if (alreadyPromoted) {
        return toProposalRecord(row);
      }

      const nextSources = [...existing, source];
      const updated = await tx.analysisProposal.update({
        where: { id: row.id },
        data: { promotedConsultationSources: nextSources as unknown as Prisma.InputJsonValue },
      });
      return toProposalRecord(updated);
    }),
  );
}

// ---------------------------------------------------------------------------
// confirmProposal -- the one operation with a real concurrency requirement
// ---------------------------------------------------------------------------

// Legal only from DRAFT. Uses explicit optimistic concurrency control: the
// caller MUST pass `expectedCurrentConfirmedProposalId` -- the id it most
// recently observed to be the authoritative CONFIRMED proposal for this
// proposal's (ownerUserId, clientId, vertical) triple (typically from a prior
// findCurrentConfirmedProposal), or null if it observed none. The function
// never infers or re-derives this on its own; it is a stated expected-version,
// exactly like any other optimistic-concurrency check.
//
// Inside ONE serializable transaction (with the same retry-on-conflict policy
// as analysis-repository.ts):
//   (1) verify the target row is DRAFT and owned;
//   (2) read the REAL, current CONFIRMED row for the SAME
//       (ownerUserId, clientId, vertical) triple -- fresh, from inside the
//       transaction -- and compare `existingConfirmed?.id ?? null` against
//       `expectedCurrentConfirmedProposalId`. On a mismatch the triple moved
//       under the caller's feet (another confirmation committed since they
//       last looked): throw ProposalConcurrencyError BEFORE any write -- the
//       target row stays exactly DRAFT and no partial state is written;
//   (3) on a match: if a CONFIRMED row exists, set it to SUPERSEDED with
//       supersededByProposalId = the target's id (the intentional-replacement
//       path), then set the target row to CONFIRMED + confirmedByUserId +
//       confirmedAt.
//
// The DB partial unique index remains the hard backstop against a race
// producing two CONFIRMED rows. A write that trips it (P2002) -- or a
// serialization failure (P2034) -- is retried within the documented policy; on
// the retry the fresh in-transaction read now sees the proposal that won the
// race, the comparison in (2) mismatches, and the loser gets a clean
// ProposalConcurrencyError instead of silently superseding the winner.
export async function confirmProposal(
  ownerUserId: string,
  proposalId: string,
  confirmedByUserId: string,
  expectedCurrentConfirmedProposalId: string | null,
): Promise<ProposalRecord | null> {
  return runProposalQuery(async () => {
    const preflight = await prisma.analysisProposal.findFirst({
      where: { id: proposalId, ownerUserId },
      select: { id: true, status: true },
    });
    if (!preflight) return null;
    if (!isLegalProposalStatusTransition(preflight.status, "CONFIRMED")) {
      throw new ProposalStateError(
        preflight.status,
        "confirm",
        `Proposal ${proposalId} is ${preflight.status}; only a DRAFT proposal can be confirmed.`,
      );
    }

    return runSerializableTransaction(async (tx) => {
      const target = await tx.analysisProposal.findFirst({ where: { id: proposalId, ownerUserId } });
      if (!target) return null;

      if (!isLegalProposalStatusTransition(target.status, "CONFIRMED")) {
        throw new ProposalStateError(
          target.status,
          "confirm",
          `Proposal ${proposalId} is ${target.status}; only a DRAFT proposal can be confirmed.`,
        );
      }

      // The REAL, current CONFIRMED row for this triple, read fresh inside the
      // serializable transaction.
      const existingConfirmed = await tx.analysisProposal.findFirst({
        where: {
          ownerUserId,
          clientId: target.clientId,
          vertical: target.vertical,
          status: "CONFIRMED",
        },
        select: { id: true },
      });

      // Optimistic-concurrency check. The caller stated, via
      // expectedCurrentConfirmedProposalId, what it last observed to be the
      // authoritative CONFIRMED proposal for this triple (or null). If the
      // freshly-read reality does not match, another confirmation committed
      // since the caller last looked -- this attempt is racing. Reject it
      // cleanly, before any write: the target row stays exactly DRAFT and
      // nothing (not the target, not any sibling) is modified.
      if ((existingConfirmed?.id ?? null) !== expectedCurrentConfirmedProposalId) {
        throw new ProposalConcurrencyError();
      }

      if (existingConfirmed) {
        // The one explicit CONFIRMED -> SUPERSEDED transition, in the SAME
        // transaction as the new confirmation. Reached only when the caller
        // correctly expected THIS row to be the one it is replacing.
        await tx.analysisProposal.update({
          where: { id: existingConfirmed.id },
          data: { status: "SUPERSEDED", supersededByProposalId: target.id },
        });
      }

      const updated = await tx.analysisProposal.update({
        where: { id: target.id },
        data: {
          status: "CONFIRMED",
          confirmedByUserId,
          confirmedAt: new Date(),
        },
      });
      return toProposalRecord(updated);
    });
  });
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

async function runProposalQuery<T>(operation: () => Promise<T>): Promise<T> {
  if (!isDatabaseConfigured()) throw new ProposalPersistenceError();

  try {
    return await operation();
  } catch (error) {
    if (
      error instanceof ProposalPersistenceError ||
      error instanceof ProposalDependencyError ||
      error instanceof ProposalConcurrencyError ||
      error instanceof ProposalValidationError ||
      error instanceof ProposalStateError ||
      error instanceof ProposalInvariantError
    ) {
      throw error;
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") {
      throw new ProposalDependencyError("PROPOSAL_DEPENDENCY_CHANGED", 409, "Proposal dependencies changed.");
    }
    throw new ProposalPersistenceError();
  }
}

async function runSerializableTransaction<T>(operation: (tx: ProposalTransaction) => Promise<T>): Promise<T> {
  for (let attempt = 1; attempt <= MAX_PROPOSAL_TRANSACTION_ATTEMPTS; attempt += 1) {
    try {
      return await prisma.$transaction(operation, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error) {
      if (!isRetryableConcurrencyError(error)) throw error;
      if (attempt === MAX_PROPOSAL_TRANSACTION_ATTEMPTS) throw new ProposalConcurrencyError();
    }
  }

  throw new ProposalConcurrencyError();
}

function isRetryableConcurrencyError(error: unknown): boolean {
  // Our own typed errors are terminal decisions -- never retry them.
  if (
    error instanceof ProposalConcurrencyError ||
    error instanceof ProposalStateError ||
    error instanceof ProposalDependencyError ||
    error instanceof ProposalValidationError ||
    error instanceof ProposalInvariantError ||
    error instanceof ProposalPersistenceError
  ) {
    return false;
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    // P2034: transaction write conflict / deadlock (Postgres 40001 / 40P01).
    if (error.code === "P2034") return true;
    // P2002 on the partial unique index specifically: another transaction
    // confirmed a sibling proposal first. Retryable -- on the next attempt the
    // re-read sees the winner and surfaces a ProposalConcurrencyError.
    if (error.code === "P2002" && hitsConfirmedUniqueIndex(error)) return true;
    return false;
  }

  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return message.includes("deadlock") || message.includes("serialization");
}

function hitsConfirmedUniqueIndex(error: Prisma.PrismaClientKnownRequestError): boolean {
  const meta = (error.meta ?? {}) as Record<string, unknown>;
  const target = meta.target;
  const targetText =
    typeof target === "string"
      ? target
      : Array.isArray(target)
        ? target.filter((entry): entry is string => typeof entry === "string").join(",")
        : "";

  if (targetText.includes(CONFIRMED_UNIQUE_INDEX) || error.message.includes(CONFIRMED_UNIQUE_INDEX)) {
    return true;
  }

  // AnalysisProposal has exactly two unique constraints: the primary key (a
  // generated UUID -- practically never collides) and the partial unique
  // index enforcing one CONFIRMED per (ownerUserId, clientId, vertical). So a
  // P2002 that names this model and is not an "id"/pkey collision is that
  // index -- treat it as the expected race outcome even if this Prisma
  // version reports the constraint by column list rather than by name.
  const modelName = typeof meta.modelName === "string" ? meta.modelName : "";
  const namesModel = modelName === "AnalysisProposal" || error.message.includes("AnalysisProposal");
  const isPrimaryKey = targetText === "id" || targetText.includes("_pkey");
  return namesModel && !isPrimaryKey;
}

function sanitizeEditEntry(entry: ProposalEditEntry): ProposalEditEntry {
  // Canonical shape only -- strip any extra keys, and coerce an explicit
  // `undefined` previousValue/newValue to null so the entry survives a JSON
  // round-trip with the required keys intact.
  const sanitized: ProposalEditEntry = {
    field: entry.field,
    previousValue: entry.previousValue === undefined ? null : entry.previousValue,
    newValue: entry.newValue === undefined ? null : entry.newValue,
    source: entry.source,
  };
  if (typeof entry.reason === "string") sanitized.reason = entry.reason;
  return sanitized;
}

function normalizeConsideredMemory(entries: ConsideredMemoryEntry[] | undefined): ConsideredMemoryEntry[] {
  if (entries === undefined) return [];
  if (!Array.isArray(entries)) {
    throw new ProposalValidationError("PROPOSAL_INVALID_PROVENANCE", "consideredMemory must be an array.");
  }
  return entries.map((entry, index): ConsideredMemoryEntry => {
    const candidate: unknown = isRecord(entry) ? { ...entry, snapshotAt: toIsoString(entry.snapshotAt) } : entry;
    if (!isConsideredMemoryEntry(candidate)) {
      throw new ProposalValidationError(
        "PROPOSAL_INVALID_PROVENANCE",
        `consideredMemory[${index}] must have { memoryId, content, kind, scope, confidence, snapshotAt }.`,
      );
    }
    return candidate;
  });
}

function normalizePromotedConsultationSources(
  entries: PromotedConsultationSourceEntry[] | undefined,
): PromotedConsultationSourceEntry[] {
  if (entries === undefined) return [];
  if (!Array.isArray(entries)) {
    throw new ProposalValidationError(
      "PROPOSAL_INVALID_PROVENANCE",
      "promotedConsultationSources must be an array.",
    );
  }
  return entries.map((entry, index): PromotedConsultationSourceEntry => {
    const candidate: unknown = isRecord(entry) ? { ...entry, promotedAt: toIsoString(entry.promotedAt) } : entry;
    if (!isPromotedConsultationSourceEntry(candidate)) {
      throw new ProposalValidationError(
        "PROPOSAL_INVALID_PROVENANCE",
        `promotedConsultationSources[${index}] must have { consultationMessageId, snapshotContent, promotedAt }.`,
      );
    }
    return candidate;
  });
}

// A caller may hand us a Date for a *At field; the stored (and validated) form
// is always an ISO 8601 string.
function toIsoString(value: unknown): unknown {
  return value instanceof Date ? value.toISOString() : value;
}

// ---------------------------------------------------------------------------
// Row -> record parsing (fails closed on malformed / invariant-violating data,
// exactly like analysis-repository.ts's toAnalysisState)
// ---------------------------------------------------------------------------

function toProposalRecord(row: PrismaAnalysisProposalRow): ProposalRecord {
  if (
    !isProposalVertical(row.vertical) ||
    !isProposalStatus(row.status) ||
    !isNonEmptyString(row.engineVersion) ||
    !isValidDate(row.analysisSnapshotAt) ||
    !isValidDate(row.createdAt) ||
    !isValidDate(row.updatedAt) ||
    row.updatedAt < row.createdAt ||
    (row.confirmedAt !== null && !isValidDate(row.confirmedAt)) ||
    (row.rejectedAt !== null && !isValidDate(row.rejectedAt))
  ) {
    throw new ProposalPersistenceError();
  }

  // Lifecycle invariants the repository layer itself guarantees on write. A
  // persisted row that violates them is corrupt -- fail closed rather than
  // hand back a nonsensical record.
  if (row.status === "CONFIRMED" && (row.confirmedAt === null || !isNonEmptyString(row.confirmedByUserId))) {
    throw new ProposalPersistenceError();
  }
  if (row.status === "REJECTED" && row.rejectedAt === null) {
    throw new ProposalPersistenceError();
  }
  if (row.status === "SUPERSEDED" && !isNonEmptyString(row.supersededByProposalId)) {
    throw new ProposalPersistenceError();
  }

  // The guard above has already thrown for any value outside the allowlists;
  // narrow explicitly here, exactly as toAnalysisState re-casts row.goal etc.
  const vertical = row.vertical as ProposalVertical;
  const status = row.status as ProposalStatus;

  return {
    id: row.id,
    ownerUserId: row.ownerUserId,
    clientId: row.clientId,
    analysisId: row.analysisId,
    vertical,
    status,
    analysisSnapshotAt: row.analysisSnapshotAt.toISOString(),
    sourceImageAssetId: row.sourceImageAssetId,
    sourceImageAnalysisId: row.sourceImageAnalysisId,
    engineVersion: row.engineVersion,
    evidenceSnapshot: parseEvidenceSnapshot(row.evidenceSnapshot),
    payload: parseProposalPayload(vertical, row.payload),
    edits: parseEdits(row.edits),
    consideredMemory: parseConsideredMemory(row.consideredMemory),
    primaryConsultationMessageId: row.primaryConsultationMessageId,
    promotedConsultationSources: parsePromotedConsultationSources(row.promotedConsultationSources),
    supersededByProposalId: row.supersededByProposalId,
    confirmedByUserId: row.confirmedByUserId,
    confirmedAt: row.confirmedAt ? row.confirmedAt.toISOString() : null,
    rejectedAt: row.rejectedAt ? row.rejectedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function parseProposalPayload(vertical: ProposalVertical, value: Prisma.JsonValue): TechnicalCutPlan {
  if (!isValidProposalPayload(vertical, value)) throw new ProposalPersistenceError();
  return value as unknown as TechnicalCutPlan;
}

function parseEvidenceSnapshot(value: Prisma.JsonValue): Record<string, unknown> {
  if (!isRecord(value)) throw new ProposalPersistenceError();
  return value as Record<string, unknown>;
}

function parseEdits(value: Prisma.JsonValue | null): ProposalEditEntry[] {
  if (value === null) return [];
  if (!Array.isArray(value) || !value.every(isProposalEditEntry)) throw new ProposalPersistenceError();
  return value as unknown as ProposalEditEntry[];
}

function parseConsideredMemory(value: Prisma.JsonValue | null): ConsideredMemoryEntry[] {
  if (value === null) return [];
  if (!Array.isArray(value) || !value.every(isConsideredMemoryEntry)) throw new ProposalPersistenceError();
  return value as unknown as ConsideredMemoryEntry[];
}

function parsePromotedConsultationSources(value: Prisma.JsonValue | null): PromotedConsultationSourceEntry[] {
  if (value === null) return [];
  if (!Array.isArray(value) || !value.every(isPromotedConsultationSourceEntry)) {
    throw new ProposalPersistenceError();
  }
  return value as unknown as PromotedConsultationSourceEntry[];
}

function isValidDate(value: Date): boolean {
  return !Number.isNaN(value.getTime());
}
