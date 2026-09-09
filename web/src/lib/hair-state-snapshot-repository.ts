import { randomUUID } from "crypto";

import { Prisma, type HairStateSnapshot as PrismaHairStateSnapshotRow } from "@prisma/client";

import { isDatabaseConfigured, prisma } from "@/lib/prisma";
import { assembleCurrentHairStateFromAnalysis, assembleTargetHairStateFromTechnicalVisualMap, HAIR_STATE_SNAPSHOT_ASSEMBLER_VERSION } from "@/lib/hair-state-snapshot-assembler";
import { isHairStateSnapshotPayload, isHairStateSnapshotRole, type HairStateSnapshotPayload, type HairStateSnapshotRole } from "@/lib/hair-state-snapshot-validators";
import { isTechnicalVisualMapPayload } from "@/lib/technical-visual-map-validators";

// Professional Skill Engine, Stage 2 -- HAIR STATE SNAPSHOT domain/repository
// layer. Mirrors technical-visual-map-repository.ts's own conventions
// exactly: the runSerializableTransaction retry-on-conflict helper, the
// runXQuery fail-closed wrapper, the ownership-check style (owner-scoped
// findFirst inside the transaction), the typed-error taxonomy, and the
// exact confirm-time optimistic-concurrency CAS shape (expectedCurrent*Id).
//
// ARCHITECTURE DECISION LOCK (Stage 1) + Stage 2 task: HairStateSnapshot is
// a STANDALONE, client-scoped authority -- not nested under one
// AnalysisProposal the way TechnicalVisualMap is. Version scope is
// (ownerUserId, clientId, role) only; analysisId/analysisProposalId/
// technicalVisualMapId/sourceImageAssetId are informative SOFT pointers,
// never part of that scope (see the Prisma model's own header comment).
//
// NO READINESS/COHERENCE ENGINE HERE (task's own explicit "do not
// generalize readiness/coherence yet" boundary) -- confirm below is a bare
// structural-validity + DRAFT-state gate only, mirroring
// confirmDraftMap's own identical scope (TechnicalVisualMap's own confirm
// also performs no separate readiness check).
//
// NO ADJUSTMENT-APPLICATION LOGIC IN STAGE 2 -- deliberately. The
// `professionalAdjustments` column exists on the Prisma model (same "a
// later stage has somewhere to write additively from day one" precedent
// as TechnicalVisualMap's own), but no adjustment-target vocabulary was
// requested by this stage's own task, and inventing one now would be
// exactly the "speculative architecture unrelated to current scope" the
// task explicitly forbids.

export const HAIR_STATE_SNAPSHOT_SCHEMA_VERSION = "1.0.0-hss2";
const MAX_TRANSACTION_ATTEMPTS = 3;

export class HairStateSnapshotPersistenceError extends Error {
  readonly code = "HAIR_STATE_SNAPSHOT_PERSISTENCE_UNAVAILABLE";
  readonly httpStatus = 503;

  constructor() {
    super("Hair State Snapshot data is temporarily unavailable.");
    this.name = "HairStateSnapshotPersistenceError";
  }
}

export class HairStateSnapshotDependencyError extends Error {
  constructor(
    readonly code:
      | "HAIR_STATE_SNAPSHOT_CLIENT_NOT_FOUND"
      | "HAIR_STATE_SNAPSHOT_ANALYSIS_NOT_FOUND"
      | "HAIR_STATE_SNAPSHOT_ANALYSIS_CLIENT_MISMATCH"
      | "HAIR_STATE_SNAPSHOT_TECHNICAL_VISUAL_MAP_NOT_FOUND"
      | "HAIR_STATE_SNAPSHOT_TECHNICAL_VISUAL_MAP_CLIENT_MISMATCH"
      | "HAIR_STATE_SNAPSHOT_TECHNICAL_VISUAL_MAP_NOT_CONFIRMED",
    readonly httpStatus: 404 | 409 | 422,
    message: string,
  ) {
    super(message);
    this.name = "HairStateSnapshotDependencyError";
  }
}

export class HairStateSnapshotValidationError extends Error {
  readonly httpStatus = 422;

  constructor(
    readonly code: "HAIR_STATE_SNAPSHOT_INVALID_ROLE" | "HAIR_STATE_SNAPSHOT_INVALID_PAYLOAD",
    message: string,
  ) {
    super(message);
    this.name = "HairStateSnapshotValidationError";
  }
}

// A lifecycle rule was broken (confirm attempted on a row that is not
// currently DRAFT). Always thrown BEFORE any write.
export class HairStateSnapshotStateError extends Error {
  readonly code = "HAIR_STATE_SNAPSHOT_ILLEGAL_STATE_TRANSITION";
  readonly httpStatus = 409;

  constructor(
    readonly fromStatus: string,
    message: string,
  ) {
    super(message);
    this.name = "HairStateSnapshotStateError";
  }
}

export class HairStateSnapshotConcurrencyError extends Error {
  readonly code = "HAIR_STATE_SNAPSHOT_CONCURRENCY_CONFLICT";
  readonly httpStatus = 409;

  constructor() {
    super("Hair State Snapshot could not be confirmed because of a concurrent confirmation.");
    this.name = "HairStateSnapshotConcurrencyError";
  }
}

// "This should be impossible" -- the persisted data violates the single
// CONFIRMED-per-(owner, client, role) invariant this domain's own partial
// unique index (see the migration) exists to enforce.
export class HairStateSnapshotInvariantError extends Error {
  readonly code = "HAIR_STATE_SNAPSHOT_CONFIRMED_INVARIANT_VIOLATED";
  readonly httpStatus = 500;

  constructor(message: string) {
    super(message);
    this.name = "HairStateSnapshotInvariantError";
  }
}

// ---------------------------------------------------------------------------
// Record shape returned to callers
// ---------------------------------------------------------------------------

export interface HairStateSnapshotRecord {
  id: string;
  ownerUserId: string;
  clientId: string;
  role: HairStateSnapshotRole;
  status: "DRAFT" | "CONFIRMED" | "SUPERSEDED";
  snapshotVersion: number;
  schemaVersion: string;
  payload: HairStateSnapshotPayload;
  analysisId: string | null;
  analysisProposalId: string | null;
  technicalVisualMapId: string | null;
  sourceImageAssetId: string | null;
  generatorVersion: string | null;
  professionalAdjustments: unknown[] | null;
  supersededBySnapshotId: string | null;
  confirmedAt: string | null;
  supersededAt: string | null;
  createdAt: string;
  updatedAt: string;
}

type HairStateSnapshotTransaction = Pick<Prisma.TransactionClient, "hairStateSnapshot" | "client" | "analysis" | "technicalVisualMap">;

// ---------------------------------------------------------------------------
// createCurrentSnapshotFromAnalysis
// ---------------------------------------------------------------------------

// Creates a DRAFT CURRENT snapshot from the exact, real Analysis identified
// by (ownerUserId, clientId, analysisId) -- never from caller-authored JSON.
// The baseline always comes from assembleCurrentHairStateFromAnalysis,
// never anything else (mirrors createDraftFromConfirmedProposal's own
// "never trust a caller-supplied payload" discipline).
export async function createCurrentSnapshotFromAnalysis(ownerUserId: string, clientId: string, analysisId: string): Promise<HairStateSnapshotRecord> {
  return runHairStateSnapshotQuery(() =>
    runSerializableTransaction(async (tx) => {
      const client = await tx.client.findFirst({ where: { id: clientId, ownerUserId, deletedAt: null }, select: { id: true } });
      if (!client) {
        throw new HairStateSnapshotDependencyError("HAIR_STATE_SNAPSHOT_CLIENT_NOT_FOUND", 404, "Client not found.");
      }

      const analysisRow = await tx.analysis.findFirst({ where: { id: analysisId, ownerUserId } });
      if (!analysisRow) {
        throw new HairStateSnapshotDependencyError("HAIR_STATE_SNAPSHOT_ANALYSIS_NOT_FOUND", 404, "Analysis not found.");
      }
      if (analysisRow.clientId !== clientId) {
        throw new HairStateSnapshotDependencyError("HAIR_STATE_SNAPSHOT_ANALYSIS_CLIENT_MISMATCH", 404, "Analysis does not belong to this client.");
      }

      const payload = assembleCurrentHairStateFromAnalysis({
        hairType: analysisRow.hairType,
        density: analysisRow.density,
        hairLength: analysisRow.hairLength,
        hairTexture: analysisRow.hairTexture,
        hairCondition: analysisRow.hairCondition,
      });

      return createSnapshotRow(tx, {
        ownerUserId,
        clientId,
        role: "CURRENT",
        payload,
        analysisId: analysisRow.id,
        analysisProposalId: null,
        technicalVisualMapId: null,
        sourceImageAssetId: analysisRow.imageAssetId,
        generatorVersion: HAIR_STATE_SNAPSHOT_ASSEMBLER_VERSION,
      });
    }),
  );
}

// ---------------------------------------------------------------------------
// createTargetSnapshotFromTechnicalVisualMap
// ---------------------------------------------------------------------------

// Creates a DRAFT TARGET snapshot from the exact, real, CONFIRMED
// TechnicalVisualMap identified by (ownerUserId, clientId,
// technicalVisualMapId). Fails closed if the map is not CONFIRMED --
// mirrors the Video Demonstration Decision Lock's own "authority must be
// CONFIRMED right now" precedent exactly (video-generation-repository.ts).
export async function createTargetSnapshotFromTechnicalVisualMap(ownerUserId: string, clientId: string, technicalVisualMapId: string): Promise<HairStateSnapshotRecord> {
  return runHairStateSnapshotQuery(() =>
    runSerializableTransaction(async (tx) => {
      const client = await tx.client.findFirst({ where: { id: clientId, ownerUserId, deletedAt: null }, select: { id: true } });
      if (!client) {
        throw new HairStateSnapshotDependencyError("HAIR_STATE_SNAPSHOT_CLIENT_NOT_FOUND", 404, "Client not found.");
      }

      const mapRow = await tx.technicalVisualMap.findFirst({ where: { id: technicalVisualMapId, ownerUserId } });
      if (!mapRow) {
        throw new HairStateSnapshotDependencyError("HAIR_STATE_SNAPSHOT_TECHNICAL_VISUAL_MAP_NOT_FOUND", 404, "Technical Visual Map not found.");
      }
      if (mapRow.clientId !== clientId) {
        throw new HairStateSnapshotDependencyError(
          "HAIR_STATE_SNAPSHOT_TECHNICAL_VISUAL_MAP_CLIENT_MISMATCH",
          404,
          "Technical Visual Map does not belong to this client.",
        );
      }
      if (mapRow.status !== "CONFIRMED") {
        throw new HairStateSnapshotDependencyError(
          "HAIR_STATE_SNAPSHOT_TECHNICAL_VISUAL_MAP_NOT_CONFIRMED",
          422,
          `Technical Visual Map ${mapRow.id} is ${mapRow.status}; a TARGET Hair State Snapshot can only be created from a CONFIRMED map.`,
        );
      }

      const mapPayload = mapRow.payload;
      if (!isTechnicalVisualMapPayload(mapPayload)) {
        throw new HairStateSnapshotPersistenceError();
      }

      const payload = assembleTargetHairStateFromTechnicalVisualMap(mapPayload);

      return createSnapshotRow(tx, {
        ownerUserId,
        clientId,
        role: "TARGET",
        payload,
        analysisId: null,
        analysisProposalId: mapRow.analysisProposalId,
        technicalVisualMapId: mapRow.id,
        sourceImageAssetId: mapRow.sourceImageAssetId,
        generatorVersion: HAIR_STATE_SNAPSHOT_ASSEMBLER_VERSION,
      });
    }),
  );
}

// ---------------------------------------------------------------------------
// createManualSnapshot -- a professional-authored snapshot (typically
// RESULT role, or a hand-built CURRENT/TARGET when no Analysis/
// TechnicalVisualMap exists yet), never assembled from a live source.
// `generatorVersion` is always null here -- see the Prisma model's own
// field comment.
// ---------------------------------------------------------------------------

export async function createManualSnapshot(
  ownerUserId: string,
  clientId: string,
  role: string,
  payload: unknown,
  provenance: { analysisId?: string | null; analysisProposalId?: string | null; technicalVisualMapId?: string | null; sourceImageAssetId?: string | null } = {},
): Promise<HairStateSnapshotRecord> {
  if (!isHairStateSnapshotRole(role)) {
    throw new HairStateSnapshotValidationError("HAIR_STATE_SNAPSHOT_INVALID_ROLE", `"${role}" is not a recognized Hair State Snapshot role.`);
  }
  if (!isHairStateSnapshotPayload(payload)) {
    throw new HairStateSnapshotValidationError("HAIR_STATE_SNAPSHOT_INVALID_PAYLOAD", "payload is not a structurally valid HairStateSnapshotPayload.");
  }

  return runHairStateSnapshotQuery(() =>
    runSerializableTransaction(async (tx) => {
      const client = await tx.client.findFirst({ where: { id: clientId, ownerUserId, deletedAt: null }, select: { id: true } });
      if (!client) {
        throw new HairStateSnapshotDependencyError("HAIR_STATE_SNAPSHOT_CLIENT_NOT_FOUND", 404, "Client not found.");
      }

      return createSnapshotRow(tx, {
        ownerUserId,
        clientId,
        role,
        payload,
        analysisId: provenance.analysisId ?? null,
        analysisProposalId: provenance.analysisProposalId ?? null,
        technicalVisualMapId: provenance.technicalVisualMapId ?? null,
        sourceImageAssetId: provenance.sourceImageAssetId ?? null,
        generatorVersion: null,
      });
    }),
  );
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

// Owner-scoped lookup. Returns null when the snapshot does not exist or is
// not owned by this user -- a not-found read is never an error.
export async function findSnapshotForOwner(ownerUserId: string, snapshotId: string): Promise<HairStateSnapshotRecord | null> {
  return runHairStateSnapshotQuery(async () => {
    const row = await prisma.hairStateSnapshot.findFirst({ where: { id: snapshotId, ownerUserId } });
    return row ? toHairStateSnapshotRecord(row) : null;
  });
}

// Full version history for one client + role, newest-version-first,
// owner-scoped.
export async function listSnapshotsForClient(ownerUserId: string, clientId: string, role: string): Promise<HairStateSnapshotRecord[]> {
  return runHairStateSnapshotQuery(async () => {
    const rows = await prisma.hairStateSnapshot.findMany({
      where: { ownerUserId, clientId, role },
      orderBy: [{ snapshotVersion: "desc" }, { id: "desc" }],
    });
    return rows.map(toHairStateSnapshotRecord);
  });
}

// The single CONFIRMED snapshot (if any) for this exact
// (ownerUserId, clientId, role) scope. Given the partial unique index there
// can structurally never be more than one -- if two are ever found that is
// a real integrity bug, surfaced as HairStateSnapshotInvariantError, never
// silently resolved by picking one.
export async function findCurrentConfirmedSnapshot(ownerUserId: string, clientId: string, role: string): Promise<HairStateSnapshotRecord | null> {
  return runHairStateSnapshotQuery(async () => {
    const rows = await prisma.hairStateSnapshot.findMany({
      where: { ownerUserId, clientId, role, status: "CONFIRMED" },
      orderBy: [{ confirmedAt: "desc" }, { id: "desc" }],
    });
    if (rows.length > 1) {
      throw new HairStateSnapshotInvariantError(
        `Found ${rows.length} CONFIRMED snapshots for one (owner ${ownerUserId}, client ${clientId}, role ${role}) -- the partial unique index should make this impossible.`,
      );
    }
    return rows[0] ? toHairStateSnapshotRecord(rows[0]) : null;
  });
}

// ---------------------------------------------------------------------------
// confirmDraftSnapshot -- the one operation with a real concurrency
// requirement. Mirrors confirmDraftMap's own exact CAS semantics.
// ---------------------------------------------------------------------------

export async function confirmDraftSnapshot(ownerUserId: string, snapshotId: string, expectedCurrentConfirmedSnapshotId: string | null): Promise<HairStateSnapshotRecord | null> {
  return runHairStateSnapshotQuery(() =>
    runSerializableTransaction(async (tx) => {
      const target = await tx.hairStateSnapshot.findFirst({ where: { id: snapshotId, ownerUserId } });
      if (!target) return null;
      if (target.status !== "DRAFT") {
        throw new HairStateSnapshotStateError(target.status, `Snapshot ${snapshotId} is ${target.status}; only a DRAFT snapshot can be confirmed.`);
      }

      const currentConfirmed = await tx.hairStateSnapshot.findFirst({
        where: { ownerUserId, clientId: target.clientId, role: target.role, status: "CONFIRMED" },
        select: { id: true },
      });
      const actualCurrentId = currentConfirmed?.id ?? null;
      if (actualCurrentId !== expectedCurrentConfirmedSnapshotId) {
        throw new HairStateSnapshotConcurrencyError();
      }

      const now = new Date();
      if (currentConfirmed) {
        await tx.hairStateSnapshot.update({
          where: { id: currentConfirmed.id },
          data: { status: "SUPERSEDED", supersededAt: now, supersededBySnapshotId: target.id },
        });
      }

      const confirmed = await tx.hairStateSnapshot.update({
        where: { id: target.id },
        data: { status: "CONFIRMED", confirmedAt: now },
      });
      return toHairStateSnapshotRecord(confirmed);
    }),
  );
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

interface CreateSnapshotRowInput {
  ownerUserId: string;
  clientId: string;
  role: string;
  payload: HairStateSnapshotPayload;
  analysisId: string | null;
  analysisProposalId: string | null;
  technicalVisualMapId: string | null;
  sourceImageAssetId: string | null;
  generatorVersion: string | null;
}

async function createSnapshotRow(tx: HairStateSnapshotTransaction, input: CreateSnapshotRowInput): Promise<HairStateSnapshotRecord> {
  const maxVersion = await tx.hairStateSnapshot.aggregate({
    where: { ownerUserId: input.ownerUserId, clientId: input.clientId, role: input.role },
    _max: { snapshotVersion: true },
  });
  const nextSnapshotVersion = (maxVersion._max.snapshotVersion ?? 0) + 1;

  const row = await tx.hairStateSnapshot.create({
    data: {
      id: randomUUID(),
      ownerUserId: input.ownerUserId,
      clientId: input.clientId,
      role: input.role,
      status: "DRAFT",
      snapshotVersion: nextSnapshotVersion,
      schemaVersion: HAIR_STATE_SNAPSHOT_SCHEMA_VERSION,
      payload: input.payload as unknown as Prisma.InputJsonValue,
      analysisId: input.analysisId,
      analysisProposalId: input.analysisProposalId,
      technicalVisualMapId: input.technicalVisualMapId,
      sourceImageAssetId: input.sourceImageAssetId,
      generatorVersion: input.generatorVersion,
      professionalAdjustments: Prisma.JsonNull,
    },
  });
  return toHairStateSnapshotRecord(row);
}

async function runHairStateSnapshotQuery<T>(operation: () => Promise<T>): Promise<T> {
  if (!isDatabaseConfigured()) throw new HairStateSnapshotPersistenceError();

  try {
    return await operation();
  } catch (error) {
    if (
      error instanceof HairStateSnapshotPersistenceError ||
      error instanceof HairStateSnapshotDependencyError ||
      error instanceof HairStateSnapshotValidationError ||
      error instanceof HairStateSnapshotStateError ||
      error instanceof HairStateSnapshotConcurrencyError ||
      error instanceof HairStateSnapshotInvariantError
    ) {
      throw error;
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") {
      throw new HairStateSnapshotDependencyError("HAIR_STATE_SNAPSHOT_CLIENT_NOT_FOUND", 404, "Hair State Snapshot dependencies changed.");
    }
    throw new HairStateSnapshotPersistenceError();
  }
}

async function runSerializableTransaction<T>(operation: (tx: HairStateSnapshotTransaction) => Promise<T>): Promise<T> {
  for (let attempt = 1; attempt <= MAX_TRANSACTION_ATTEMPTS; attempt += 1) {
    try {
      return await prisma.$transaction(operation, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (!isRetryableConcurrencyError(error)) throw error;
      if (attempt === MAX_TRANSACTION_ATTEMPTS) throw new HairStateSnapshotConcurrencyError();
    }
  }
  throw new HairStateSnapshotConcurrencyError();
}

function isRetryableConcurrencyError(error: unknown): boolean {
  if (
    error instanceof HairStateSnapshotPersistenceError ||
    error instanceof HairStateSnapshotDependencyError ||
    error instanceof HairStateSnapshotValidationError ||
    error instanceof HairStateSnapshotStateError ||
    error instanceof HairStateSnapshotConcurrencyError ||
    error instanceof HairStateSnapshotInvariantError
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

function toHairStateSnapshotRecord(row: PrismaHairStateSnapshotRow): HairStateSnapshotRecord {
  const payload = row.payload;
  if (!isHairStateSnapshotPayload(payload)) {
    throw new HairStateSnapshotPersistenceError();
  }
  if (!isHairStateSnapshotRole(row.role)) {
    throw new HairStateSnapshotPersistenceError();
  }
  return {
    id: row.id,
    ownerUserId: row.ownerUserId,
    clientId: row.clientId,
    role: row.role,
    status: row.status as HairStateSnapshotRecord["status"],
    snapshotVersion: row.snapshotVersion,
    schemaVersion: row.schemaVersion,
    payload,
    analysisId: row.analysisId,
    analysisProposalId: row.analysisProposalId,
    technicalVisualMapId: row.technicalVisualMapId,
    sourceImageAssetId: row.sourceImageAssetId,
    generatorVersion: row.generatorVersion,
    professionalAdjustments: row.professionalAdjustments as unknown[] | null,
    supersededBySnapshotId: row.supersededBySnapshotId,
    confirmedAt: row.confirmedAt ? row.confirmedAt.toISOString() : null,
    supersededAt: row.supersededAt ? row.supersededAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
