import { randomUUID } from "crypto";

import { Prisma, type TechnicalVisualMap as PrismaTechnicalVisualMapRow } from "@prisma/client";

import type { ProposalEditEntry, ProposalStatus, ProposalVertical } from "@/lib/proposal-validators";
import { isDatabaseConfigured, prisma } from "@/lib/prisma";
import {
  assembleCuttingTechnicalVisualMap,
  type TechnicalVisualMapAssemblerInput,
} from "@/lib/technical-visual-map-assembler";
import {
  isMapAdjustmentEntry,
  isTechnicalVisualMapPayload,
  resolveEffectiveTechnicalVisualMap,
  type MapAdjustmentEntry,
  type TechnicalVisualMapPayload,
} from "@/lib/technical-visual-map-validators";

// Technical Visual Map, Stage 2 -- the domain/repository layer. Deliberately
// mirrors proposal-repository.ts's own conventions: the
// runSerializableTransaction retry-on-conflict helper, the runXQuery
// fail-closed wrapper, the ownership-check style (owner-scoped findFirst
// inside the transaction), and the typed-error taxonomy.

export const TECHNICAL_VISUAL_MAP_PERSISTENCE_ERROR_CODE = "TECHNICAL_VISUAL_MAP_PERSISTENCE_UNAVAILABLE";
const MAX_TRANSACTION_ATTEMPTS = 3;

export class TechnicalVisualMapPersistenceError extends Error {
  readonly code = TECHNICAL_VISUAL_MAP_PERSISTENCE_ERROR_CODE;
  readonly httpStatus = 503;

  constructor() {
    super("Technical Visual Map data is temporarily unavailable.");
    this.name = "TechnicalVisualMapPersistenceError";
  }
}

export class TechnicalVisualMapDependencyError extends Error {
  constructor(
    readonly code:
      | "TECHNICAL_VISUAL_MAP_CLIENT_NOT_FOUND"
      | "TECHNICAL_VISUAL_MAP_PROPOSAL_NOT_FOUND"
      | "TECHNICAL_VISUAL_MAP_PROPOSAL_CLIENT_MISMATCH"
      | "TECHNICAL_VISUAL_MAP_DEPENDENCY_CHANGED",
    readonly httpStatus: 404 | 409,
    message: string,
  ) {
    super(message);
    this.name = "TechnicalVisualMapDependencyError";
  }
}

export class TechnicalVisualMapValidationError extends Error {
  readonly httpStatus = 422;

  constructor(
    readonly code: "TECHNICAL_VISUAL_MAP_INVALID_ADJUSTMENT",
    message: string,
  ) {
    super(message);
    this.name = "TechnicalVisualMapValidationError";
  }
}

// A lifecycle rule was broken (adjust/confirm attempted on a row that is not
// currently DRAFT). Always thrown BEFORE any write.
export class TechnicalVisualMapStateError extends Error {
  readonly code = "TECHNICAL_VISUAL_MAP_ILLEGAL_STATE_TRANSITION";
  readonly httpStatus = 409;

  constructor(
    readonly fromStatus: string,
    readonly attempted: "adjust" | "confirm",
    message: string,
  ) {
    super(message);
    this.name = "TechnicalVisualMapStateError";
  }
}

export class TechnicalVisualMapConcurrencyError extends Error {
  readonly code = "TECHNICAL_VISUAL_MAP_CONCURRENCY_CONFLICT";
  readonly httpStatus = 409;

  constructor() {
    super("Technical Visual Map could not be confirmed because of a concurrent confirmation.");
    this.name = "TechnicalVisualMapConcurrencyError";
  }
}

// "This should be impossible" -- the persisted data violates the single
// CONFIRMED-per-(owner, client, proposal, vertical) invariant the partial
// unique index exists to enforce.
export class TechnicalVisualMapInvariantError extends Error {
  readonly code = "TECHNICAL_VISUAL_MAP_CONFIRMED_INVARIANT_VIOLATED";
  readonly httpStatus = 500;

  constructor(message: string) {
    super(message);
    this.name = "TechnicalVisualMapInvariantError";
  }
}

// ---------------------------------------------------------------------------
// Record shape returned to callers
// ---------------------------------------------------------------------------

export interface TechnicalVisualMapRecord {
  id: string;
  ownerUserId: string;
  clientId: string;
  analysisProposalId: string;
  vertical: string;
  status: "DRAFT" | "CONFIRMED" | "SUPERSEDED";
  mapVersion: number;
  schemaVersion: string;
  payload: TechnicalVisualMapPayload;
  sourceImageAssetId: string | null;
  sourceImageAnalysisId: string | null;
  generatorVersion: string;
  professionalAdjustments: MapAdjustmentEntry[];
  supersededByMapId: string | null;
  confirmedAt: string | null;
  supersededAt: string | null;
  createdAt: string;
  updatedAt: string;
}

type TechnicalVisualMapTransaction = Pick<Prisma.TransactionClient, "technicalVisualMap" | "client" | "analysisProposal">;

// ---------------------------------------------------------------------------
// createDraftFromConfirmedProposal
// ---------------------------------------------------------------------------

// Creates a DRAFT map from the EXACT CONFIRMED AnalysisProposal identified by
// (ownerUserId, clientId, analysisProposalId) -- never from caller-authored
// JSON. The baseline always comes from assembleCuttingTechnicalVisualMap,
// never anything else. mapVersion is allocated transaction-safely (read
// MAX(mapVersion) for this exact locked scope, +1) inside the SAME
// serializable transaction that performs the insert, so a concurrent create
// cannot silently duplicate a version number -- and if it somehow races past
// that, the DB-level ordinary unique index on
// (analysisProposalId, ownerUserId, clientId, vertical, mapVersion) is the
// final backstop, surfaced as a retry (see isRetryableConcurrencyError).
export async function createDraftFromConfirmedProposal(
  ownerUserId: string,
  clientId: string,
  analysisProposalId: string,
): Promise<TechnicalVisualMapRecord> {
  return runTechnicalVisualMapQuery(() =>
    runSerializableTransaction(async (tx) => {
      const client = await tx.client.findFirst({
        where: { id: clientId, ownerUserId, deletedAt: null },
        select: { id: true },
      });
      if (!client) {
        throw new TechnicalVisualMapDependencyError("TECHNICAL_VISUAL_MAP_CLIENT_NOT_FOUND", 404, "Client not found.");
      }

      // Owner-scoped lookup, then an explicit clientId equality check --
      // never assuming transitive trust, exactly mirroring
      // createProposalForOwner's own analysis lookup.
      const proposalRow = await tx.analysisProposal.findFirst({ where: { id: analysisProposalId, ownerUserId } });
      if (!proposalRow) {
        throw new TechnicalVisualMapDependencyError("TECHNICAL_VISUAL_MAP_PROPOSAL_NOT_FOUND", 404, "Proposal not found.");
      }
      if (proposalRow.clientId !== clientId) {
        throw new TechnicalVisualMapDependencyError(
          "TECHNICAL_VISUAL_MAP_PROPOSAL_CLIENT_MISMATCH",
          404,
          "Proposal does not belong to this client.",
        );
      }

      // A minimal, assembler-input-shaped view of the raw row -- read fresh,
      // INSIDE this transaction (never via a separate, pre-transaction
      // repository call), because a CONFIRMED proposal's own status can
      // still change to SUPERSEDED later (when a newer proposal is
      // confirmed) -- reading it outside the transaction would reopen
      // exactly the kind of race this domain has already been careful to
      // close once (AnalysisProposal's own confirm CAS).
      const assemblerInput: TechnicalVisualMapAssemblerInput = {
        id: proposalRow.id,
        vertical: proposalRow.vertical as ProposalVertical,
        status: proposalRow.status as ProposalStatus,
        payload: proposalRow.payload as unknown as TechnicalVisualMapAssemblerInput["payload"],
        edits: (proposalRow.edits ?? []) as unknown as ProposalEditEntry[],
        evidenceSnapshot: proposalRow.evidenceSnapshot as unknown as Record<string, unknown>,
        sourceImageAssetId: proposalRow.sourceImageAssetId,
        sourceImageAnalysisId: proposalRow.sourceImageAnalysisId,
      };

      // Throws TechnicalVisualMapAssemblyError (unsupported vertical, proposal
      // not CONFIRMED, malformed effective plan) -- propagated as-is, never
      // wrapped, so a caller can distinguish it precisely.
      const assembled = assembleCuttingTechnicalVisualMap(assemblerInput);

      const maxVersion = await tx.technicalVisualMap.aggregate({
        where: { ownerUserId, clientId, analysisProposalId, vertical: assemblerInput.vertical },
        _max: { mapVersion: true },
      });
      const nextMapVersion = (maxVersion._max.mapVersion ?? 0) + 1;

      const row = await tx.technicalVisualMap.create({
        data: {
          id: randomUUID(),
          ownerUserId,
          clientId,
          analysisProposalId,
          vertical: assemblerInput.vertical,
          status: "DRAFT",
          mapVersion: nextMapVersion,
          schemaVersion: assembled.schemaVersion,
          payload: assembled.payload as unknown as Prisma.InputJsonValue,
          sourceImageAssetId: assembled.sourceImageAssetId,
          sourceImageAnalysisId: assembled.sourceImageAnalysisId,
          generatorVersion: assembled.generatorVersion,
          professionalAdjustments: Prisma.JsonNull,
        },
      });
      return toTechnicalVisualMapRecord(row);
    }),
  );
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

// Owner-scoped lookup. Returns null when the map does not exist or is not
// owned by this user -- a not-found read is never an error.
export async function findMapForOwner(ownerUserId: string, mapId: string): Promise<TechnicalVisualMapRecord | null> {
  return runTechnicalVisualMapQuery(async () => {
    const row = await prisma.technicalVisualMap.findFirst({ where: { id: mapId, ownerUserId } });
    return row ? toTechnicalVisualMapRecord(row) : null;
  });
}

// Full history for one proposal + vertical, newest-version-first, owner-scoped.
export async function listMapsForProposal(
  ownerUserId: string,
  clientId: string,
  analysisProposalId: string,
  vertical: string,
): Promise<TechnicalVisualMapRecord[]> {
  return runTechnicalVisualMapQuery(async () => {
    const rows = await prisma.technicalVisualMap.findMany({
      where: { ownerUserId, clientId, analysisProposalId, vertical },
      orderBy: [{ mapVersion: "desc" }, { id: "desc" }],
    });
    return rows.map(toTechnicalVisualMapRecord);
  });
}

// The single CONFIRMED map (if any) for this exact
// (ownerUserId, clientId, analysisProposalId, vertical) scope. Given the
// partial unique index there can structurally never be more than one -- if
// two are ever found that is a real integrity bug, surfaced as
// TechnicalVisualMapInvariantError, never silently resolved by picking one.
export async function findCurrentConfirmedMap(
  ownerUserId: string,
  clientId: string,
  analysisProposalId: string,
  vertical: string,
): Promise<TechnicalVisualMapRecord | null> {
  return runTechnicalVisualMapQuery(async () => {
    const rows = await prisma.technicalVisualMap.findMany({
      where: { ownerUserId, clientId, analysisProposalId, vertical, status: "CONFIRMED" },
      orderBy: [{ confirmedAt: "desc" }, { id: "desc" }],
    });
    if (rows.length > 1) {
      throw new TechnicalVisualMapInvariantError(
        `Found ${rows.length} CONFIRMED maps for one (owner ${ownerUserId}, client ${clientId}, proposal ` +
          `${analysisProposalId}, vertical ${vertical}) -- the partial unique index should make this impossible.`,
      );
    }
    return rows[0] ? toTechnicalVisualMapRecord(rows[0]) : null;
  });
}

// ---------------------------------------------------------------------------
// applyAdjustmentsToDraft
// ---------------------------------------------------------------------------

// Legal only while the row is DRAFT. Appends the given entries to (or seeds)
// the `professionalAdjustments` array -- never mutates `payload`, the frozen
// generator baseline. Each adjustment is independently validated (structural
// shape AND that any zone it references is one of the six real zones already
// present on this map's own baseline) before any write. Rejects with a typed
// error and writes nothing if the row is not currently DRAFT.
export async function applyAdjustmentsToDraft(
  ownerUserId: string,
  mapId: string,
  adjustments: MapAdjustmentEntry[],
): Promise<TechnicalVisualMapRecord | null> {
  if (!Array.isArray(adjustments) || adjustments.length === 0) {
    throw new TechnicalVisualMapValidationError("TECHNICAL_VISUAL_MAP_INVALID_ADJUSTMENT", "adjustments must be a non-empty array.");
  }
  const normalized = adjustments.map((adjustment, index) => {
    if (!isMapAdjustmentEntry(adjustment)) {
      throw new TechnicalVisualMapValidationError(
        "TECHNICAL_VISUAL_MAP_INVALID_ADJUSTMENT",
        `adjustments[${index}] is not a structurally valid MapAdjustmentEntry.`,
      );
    }
    return adjustment;
  });

  return runTechnicalVisualMapQuery(() =>
    runSerializableTransaction(async (tx) => {
      const row = await tx.technicalVisualMap.findFirst({ where: { id: mapId, ownerUserId } });
      if (!row) return null;

      if (row.status !== "DRAFT") {
        throw new TechnicalVisualMapStateError(
          row.status,
          "adjust",
          `Map ${mapId} is ${row.status}; only a DRAFT map can receive professional adjustments.`,
        );
      }

      const existingAdjustments = parseProfessionalAdjustments(row.professionalAdjustments);
      const nextAdjustments = [...existingAdjustments, ...normalized];

      const updated = await tx.technicalVisualMap.update({
        where: { id: row.id },
        data: {
          professionalAdjustments: nextAdjustments as unknown as Prisma.InputJsonValue,
          // `payload` is deliberately absent from this data block: the frozen
          // generator baseline is never overwritten by an adjustment.
        },
      });
      return toTechnicalVisualMapRecord(updated);
    }),
  );
}

// ---------------------------------------------------------------------------
// confirmDraftMap -- the one operation with a real concurrency requirement
// ---------------------------------------------------------------------------

// Legal only from DRAFT. Uses explicit optimistic concurrency control,
// following AnalysisProposal's own confirmProposal CAS semantics exactly:
// the caller MUST pass `expectedCurrentConfirmedMapId` -- the id it most
// recently observed to be the authoritative CONFIRMED map for this map's
// (ownerUserId, clientId, analysisProposalId, vertical) scope (typically
// from a prior findCurrentConfirmedMap), or null if it observed none. Never
// inferred or re-derived internally.
//
// Inside ONE serializable transaction:
//   (1) verify the target row is DRAFT and owned;
//   (2) read the REAL, current CONFIRMED row for the SAME scope -- fresh,
//       from inside the transaction -- and compare against
//       expectedCurrentConfirmedMapId. On a mismatch: throw
//       TechnicalVisualMapConcurrencyError BEFORE any write -- the target
//       row stays exactly DRAFT and no partial state is written;
//   (3) on a match: if a CONFIRMED row exists, set it to SUPERSEDED with
//       supersededByMapId + supersededAt = the target's id/now (the
//       intentional-replacement path), then set the target row to CONFIRMED
//       + confirmedAt.
//
// The DB partial unique index remains the hard backstop against a race
// producing two CONFIRMED rows -- a write that trips it is retried within
// the documented policy; on the retry the fresh in-transaction read now sees
// the proposal that won the race, the comparison in (2) mismatches, and the
// loser gets a clean TechnicalVisualMapConcurrencyError instead of silently
// superseding the winner.
export async function confirmDraftMap(
  ownerUserId: string,
  mapId: string,
  expectedCurrentConfirmedMapId: string | null,
): Promise<TechnicalVisualMapRecord | null> {
  return runTechnicalVisualMapQuery(async () => {
    const preflight = await prisma.technicalVisualMap.findFirst({
      where: { id: mapId, ownerUserId },
      select: { id: true, status: true },
    });
    if (!preflight) return null;
    if (preflight.status !== "DRAFT") {
      throw new TechnicalVisualMapStateError(
        preflight.status,
        "confirm",
        `Map ${mapId} is ${preflight.status}; only a DRAFT map can be confirmed.`,
      );
    }

    return runSerializableTransaction(async (tx) => {
      const target = await tx.technicalVisualMap.findFirst({ where: { id: mapId, ownerUserId } });
      if (!target) return null;

      if (target.status !== "DRAFT") {
        throw new TechnicalVisualMapStateError(
          target.status,
          "confirm",
          `Map ${mapId} is ${target.status}; only a DRAFT map can be confirmed.`,
        );
      }

      const existingConfirmed = await tx.technicalVisualMap.findFirst({
        where: {
          ownerUserId,
          clientId: target.clientId,
          analysisProposalId: target.analysisProposalId,
          vertical: target.vertical,
          status: "CONFIRMED",
        },
        select: { id: true },
      });

      if ((existingConfirmed?.id ?? null) !== expectedCurrentConfirmedMapId) {
        throw new TechnicalVisualMapConcurrencyError();
      }

      const now = new Date();

      if (existingConfirmed) {
        await tx.technicalVisualMap.update({
          where: { id: existingConfirmed.id },
          data: { status: "SUPERSEDED", supersededByMapId: target.id, supersededAt: now },
        });
      }

      const updated = await tx.technicalVisualMap.update({
        where: { id: target.id },
        data: { status: "CONFIRMED", confirmedAt: now },
      });
      return toTechnicalVisualMapRecord(updated);
    });
  });
}

// ---------------------------------------------------------------------------
// Effective map (baseline + professional adjustments) for callers that need
// the fully-resolved current state of a map without re-deriving the merge
// themselves.
// ---------------------------------------------------------------------------

export function resolveEffectiveMapForRecord(record: TechnicalVisualMapRecord): TechnicalVisualMapPayload {
  return resolveEffectiveTechnicalVisualMap(record.payload, record.professionalAdjustments);
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

async function runTechnicalVisualMapQuery<T>(operation: () => Promise<T>): Promise<T> {
  if (!isDatabaseConfigured()) throw new TechnicalVisualMapPersistenceError();

  try {
    return await operation();
  } catch (error) {
    if (
      error instanceof TechnicalVisualMapPersistenceError ||
      error instanceof TechnicalVisualMapDependencyError ||
      error instanceof TechnicalVisualMapConcurrencyError ||
      error instanceof TechnicalVisualMapValidationError ||
      error instanceof TechnicalVisualMapStateError ||
      error instanceof TechnicalVisualMapInvariantError
    ) {
      throw error;
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") {
      throw new TechnicalVisualMapDependencyError(
        "TECHNICAL_VISUAL_MAP_DEPENDENCY_CHANGED",
        409,
        "Technical Visual Map dependencies changed.",
      );
    }
    // Let TechnicalVisualMapAssemblyError (from the assembler) and any other
    // typed/unexpected error propagate as-is -- only genuinely-unexpected
    // Prisma/runtime failures fall through to the generic 503, matching
    // proposal-repository.ts's own runProposalQuery precedent exactly.
    if ((error as { name?: string })?.name === "TechnicalVisualMapAssemblyError") {
      throw error;
    }
    throw new TechnicalVisualMapPersistenceError();
  }
}

async function runSerializableTransaction<T>(
  operation: (tx: TechnicalVisualMapTransaction) => Promise<T>,
): Promise<T> {
  for (let attempt = 1; attempt <= MAX_TRANSACTION_ATTEMPTS; attempt += 1) {
    try {
      return await prisma.$transaction(operation, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error) {
      if (!isRetryableConcurrencyError(error)) throw error;
      if (attempt === MAX_TRANSACTION_ATTEMPTS) throw new TechnicalVisualMapConcurrencyError();
    }
  }

  throw new TechnicalVisualMapConcurrencyError();
}

function isRetryableConcurrencyError(error: unknown): boolean {
  // Our own typed errors (including the assembler's) are terminal decisions
  // -- never retry them.
  if (
    error instanceof TechnicalVisualMapConcurrencyError ||
    error instanceof TechnicalVisualMapStateError ||
    error instanceof TechnicalVisualMapDependencyError ||
    error instanceof TechnicalVisualMapValidationError ||
    error instanceof TechnicalVisualMapInvariantError ||
    error instanceof TechnicalVisualMapPersistenceError
  ) {
    return false;
  }
  if ((error as { name?: string })?.name === "TechnicalVisualMapAssemblyError") return false;

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    // P2034: transaction write conflict / deadlock (Postgres 40001 / 40P01).
    if (error.code === "P2034") return true;
    // P2002 on TechnicalVisualMap's own non-primary-key unique constraints
    // (either the ordinary mapVersion uniqueness, hit by two concurrent
    // creates computing the same next version, or the partial CONFIRMED-only
    // index, hit by two concurrent confirmations) -- both represent "another
    // transaction committed first, re-read fresh data and try again", which
    // is exactly what retrying this same operation does: createDraft
    // recomputes MAX(mapVersion) again, confirmDraftMap re-reads
    // existingConfirmed again and correctly reports a clean concurrency
    // error to the loser instead of a raw constraint violation.
    if (error.code === "P2002" && hitsTechnicalVisualMapUniqueIndex(error)) return true;
    return false;
  }

  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return message.includes("deadlock") || message.includes("serialization");
}

function hitsTechnicalVisualMapUniqueIndex(error: Prisma.PrismaClientKnownRequestError): boolean {
  const meta = (error.meta ?? {}) as Record<string, unknown>;
  const target = meta.target;
  const targetText =
    typeof target === "string"
      ? target
      : Array.isArray(target)
        ? target.filter((entry): entry is string => typeof entry === "string").join(",")
        : "";

  const modelName = typeof meta.modelName === "string" ? meta.modelName : "";
  const namesModel = modelName === "TechnicalVisualMap" || error.message.includes("TechnicalVisualMap");
  const isPrimaryKey = targetText === "id" || targetText.includes("_pkey");
  return namesModel && !isPrimaryKey;
}

function parseProfessionalAdjustments(value: Prisma.JsonValue | null): MapAdjustmentEntry[] {
  if (value === null) return [];
  if (!Array.isArray(value) || !value.every(isMapAdjustmentEntry)) throw new TechnicalVisualMapPersistenceError();
  return value as unknown as MapAdjustmentEntry[];
}

function parsePayload(value: Prisma.JsonValue): TechnicalVisualMapPayload {
  if (!isTechnicalVisualMapPayload(value)) throw new TechnicalVisualMapPersistenceError();
  return value;
}

function toTechnicalVisualMapRecord(row: PrismaTechnicalVisualMapRow): TechnicalVisualMapRecord {
  return {
    id: row.id,
    ownerUserId: row.ownerUserId,
    clientId: row.clientId,
    analysisProposalId: row.analysisProposalId,
    vertical: row.vertical,
    status: row.status as TechnicalVisualMapRecord["status"],
    mapVersion: row.mapVersion,
    schemaVersion: row.schemaVersion,
    payload: parsePayload(row.payload),
    sourceImageAssetId: row.sourceImageAssetId,
    sourceImageAnalysisId: row.sourceImageAnalysisId,
    generatorVersion: row.generatorVersion,
    professionalAdjustments: parseProfessionalAdjustments(row.professionalAdjustments),
    supersededByMapId: row.supersededByMapId,
    confirmedAt: row.confirmedAt ? row.confirmedAt.toISOString() : null,
    supersededAt: row.supersededAt ? row.supersededAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
