import { randomUUID } from "crypto";

import { Prisma, type TechnicalVisualMapSpatialBinding as PrismaSpatialBindingRow } from "@prisma/client";

import { isDatabaseConfigured, prisma } from "@/lib/prisma";
import {
  applySpatialBindingEditOperations,
  buildInitialSpatialPayload,
  isSpatialBindingEditOperationArray,
  isTechnicalVisualMapSpatialPayload,
  isViewLabel,
  type SpatialBindingEditOperation,
  type TechnicalVisualMapSpatialPayload,
} from "@/lib/technical-visual-map-spatial-validators";

// Technical Visual Map, Stage 5B -- the durable domain/repository layer for
// image-bound spatial geometry. Mirrors technical-visual-map-repository.ts's
// own conventions exactly: the runXQuery fail-closed wrapper, the
// runSerializableTransaction retry-on-conflict helper, the ownership-check
// style (owner-scoped findFirst inside the transaction, raw rows read
// INSIDE the same transaction the write happens in to avoid a TOCTOU race
// against a parent that could change status concurrently), and the typed-
// error taxonomy.
//
// Stage 5 Decision Lock 14 note: unlike TechnicalVisualMap (frozen baseline
// + a separate additive professionalAdjustments ledger), a spatial binding
// has NO separate baseline/adjustment stack. Its `payload` column IS the
// single source of truth at every point in its life: DRAFT edits update it
// in place (applySpatialBindingEditOperations), and confirmation simply
// freezes whatever it currently holds. There is therefore no "effective
// payload" resolver here distinct from `record.payload` itself -- inventing
// one would be exactly the un-asked-for ledger the Decision Lock's own §14
// warned against building without a genuine requirement.

export const TECHNICAL_VISUAL_MAP_SPATIAL_GEOMETRY_SCHEMA_VERSION = "1.0.0";
const MAX_TRANSACTION_ATTEMPTS = 3;

export class TechnicalVisualMapSpatialBindingPersistenceError extends Error {
  readonly code = "TECHNICAL_VISUAL_MAP_SPATIAL_BINDING_PERSISTENCE_UNAVAILABLE";
  readonly httpStatus = 503;

  constructor() {
    super("Technical Visual Map spatial binding data is temporarily unavailable.");
    this.name = "TechnicalVisualMapSpatialBindingPersistenceError";
  }
}

export class TechnicalVisualMapSpatialBindingDependencyError extends Error {
  constructor(
    readonly code:
      | "TECHNICAL_VISUAL_MAP_SPATIAL_BINDING_CLIENT_NOT_FOUND"
      | "TECHNICAL_VISUAL_MAP_SPATIAL_BINDING_MAP_NOT_FOUND"
      | "TECHNICAL_VISUAL_MAP_SPATIAL_BINDING_MAP_CLIENT_MISMATCH"
      | "TECHNICAL_VISUAL_MAP_SPATIAL_BINDING_PARENT_MAP_NOT_CONFIRMED"
      | "TECHNICAL_VISUAL_MAP_SPATIAL_BINDING_PARENT_MAP_UNSUPPORTED_VERTICAL"
      | "TECHNICAL_VISUAL_MAP_SPATIAL_BINDING_PARENT_MAP_INELIGIBLE"
      | "TECHNICAL_VISUAL_MAP_SPATIAL_SOURCE_ASSET_NOT_FOUND"
      | "TECHNICAL_VISUAL_MAP_SPATIAL_SOURCE_ASSET_CLIENT_MISMATCH"
      | "TECHNICAL_VISUAL_MAP_SPATIAL_SOURCE_DIMENSIONS_UNAVAILABLE"
      | "TECHNICAL_VISUAL_MAP_SPATIAL_BINDING_DEPENDENCY_CHANGED",
    readonly httpStatus: 404 | 409 | 422,
    message: string,
  ) {
    super(message);
    this.name = "TechnicalVisualMapSpatialBindingDependencyError";
  }
}

export class TechnicalVisualMapSpatialBindingValidationError extends Error {
  readonly httpStatus = 422;

  constructor(
    readonly code: "TECHNICAL_VISUAL_MAP_SPATIAL_BINDING_INVALID_VIEW_LABEL" | "TECHNICAL_VISUAL_MAP_SPATIAL_BINDING_INVALID_EDIT_OPERATION",
    message: string,
  ) {
    super(message);
    this.name = "TechnicalVisualMapSpatialBindingValidationError";
  }
}

export class TechnicalVisualMapSpatialBindingStateError extends Error {
  readonly code = "TECHNICAL_VISUAL_MAP_SPATIAL_BINDING_ILLEGAL_STATE_TRANSITION";
  readonly httpStatus = 409;

  constructor(
    readonly fromStatus: string,
    readonly attempted: "adjust" | "confirm",
    message: string,
  ) {
    super(message);
    this.name = "TechnicalVisualMapSpatialBindingStateError";
  }
}

// Exact name and public code locked at the Stage 5 Decision Lock (Lock 15).
export class TechnicalVisualMapSpatialBindingConcurrencyError extends Error {
  readonly code = "TECHNICAL_VISUAL_MAP_SPATIAL_BINDING_CONFIRMATION_CONFLICT";
  readonly httpStatus = 409;

  constructor() {
    super("Spatial binding could not be confirmed because of a concurrent confirmation.");
    this.name = "TechnicalVisualMapSpatialBindingConcurrencyError";
  }
}

export class TechnicalVisualMapSpatialBindingInvariantError extends Error {
  readonly code = "TECHNICAL_VISUAL_MAP_SPATIAL_BINDING_CONFIRMED_INVARIANT_VIOLATED";
  readonly httpStatus = 500;

  constructor(message: string) {
    super(message);
    this.name = "TechnicalVisualMapSpatialBindingInvariantError";
  }
}

// ---------------------------------------------------------------------------
// Record shape
// ---------------------------------------------------------------------------

export interface TechnicalVisualMapSpatialBindingRecord {
  id: string;
  ownerUserId: string;
  clientId: string;
  technicalVisualMapId: string;
  sourceImageAssetId: string;
  sourceImageAnalysisId: string | null;
  viewLabel: string;
  status: "DRAFT" | "CONFIRMED" | "SUPERSEDED";
  spatialVersion: number;
  geometrySchemaVersion: string;
  payload: TechnicalVisualMapSpatialPayload;
  frozenWidth: number;
  frozenHeight: number;
  frozenOrientation: number;
  frozenContentSha256: string | null;
  frozenStorageVersionId: string | null;
  supersededBySpatialBindingId: string | null;
  confirmedAt: string | null;
  supersededAt: string | null;
  createdAt: string;
  updatedAt: string;
}

type SpatialBindingTransaction = Pick<
  Prisma.TransactionClient,
  "technicalVisualMapSpatialBinding" | "client" | "technicalVisualMap" | "imageAsset"
>;

// ---------------------------------------------------------------------------
// createDraftSpatialBinding
// ---------------------------------------------------------------------------

// Creates a DRAFT spatial binding for the exact owned (client, map, source
// image, view) combination. The caller supplies ONLY identity (never
// coordinates, never frozen fields, never version/schema/status) --
// everything else is derived server-side, inside one transaction, from raw
// rows read fresh in that same transaction (never via a separate
// pre-transaction repository call) to close the same TOCTOU window Stage 2
// already identified and closed for the semantic map itself.
export async function createDraftSpatialBinding(
  ownerUserId: string,
  clientId: string,
  technicalVisualMapId: string,
  sourceImageAssetId: string,
  viewLabel: string,
): Promise<TechnicalVisualMapSpatialBindingRecord> {
  if (!isViewLabel(viewLabel)) {
    throw new TechnicalVisualMapSpatialBindingValidationError(
      "TECHNICAL_VISUAL_MAP_SPATIAL_BINDING_INVALID_VIEW_LABEL",
      `"${viewLabel}" is not a supported view label.`,
    );
  }

  return runSpatialBindingQuery(() =>
    runSerializableTransaction(async (tx) => {
      const client = await tx.client.findFirst({ where: { id: clientId, ownerUserId, deletedAt: null }, select: { id: true } });
      if (!client) {
        throw new TechnicalVisualMapSpatialBindingDependencyError(
          "TECHNICAL_VISUAL_MAP_SPATIAL_BINDING_CLIENT_NOT_FOUND",
          404,
          "Client not found.",
        );
      }

      const map = await tx.technicalVisualMap.findFirst({ where: { id: technicalVisualMapId, ownerUserId } });
      if (!map) {
        throw new TechnicalVisualMapSpatialBindingDependencyError(
          "TECHNICAL_VISUAL_MAP_SPATIAL_BINDING_MAP_NOT_FOUND",
          404,
          "Technical Visual Map not found.",
        );
      }
      if (map.clientId !== clientId) {
        throw new TechnicalVisualMapSpatialBindingDependencyError(
          "TECHNICAL_VISUAL_MAP_SPATIAL_BINDING_MAP_CLIENT_MISMATCH",
          404,
          "Technical Visual Map does not belong to this client.",
        );
      }
      // Only "cutting" is a supported vertical anywhere in this domain today
      // -- defensive, since nothing can currently produce a TechnicalVisualMap
      // with any other vertical, but cheap and future-proofs the check.
      if (map.vertical !== "cutting") {
        throw new TechnicalVisualMapSpatialBindingDependencyError(
          "TECHNICAL_VISUAL_MAP_SPATIAL_BINDING_PARENT_MAP_UNSUPPORTED_VERTICAL",
          422,
          `Technical Visual Map ${map.id} has vertical "${map.vertical}"; spatial binding Stage 5B only supports "cutting".`,
        );
      }
      // A spatial binding may only be CREATED from a CONFIRMED semantic map
      // (Stage 5B requirement #19 / Decision Lock) -- never a DRAFT or
      // SUPERSEDED one.
      if (map.status !== "CONFIRMED") {
        throw new TechnicalVisualMapSpatialBindingDependencyError(
          "TECHNICAL_VISUAL_MAP_SPATIAL_BINDING_PARENT_MAP_NOT_CONFIRMED",
          422,
          `Technical Visual Map ${map.id} is ${map.status}; a spatial binding can only be created from a CONFIRMED map.`,
        );
      }

      const asset = await tx.imageAsset.findFirst({ where: { id: sourceImageAssetId, ownerUserId, deletedAt: null } });
      if (!asset) {
        throw new TechnicalVisualMapSpatialBindingDependencyError(
          "TECHNICAL_VISUAL_MAP_SPATIAL_SOURCE_ASSET_NOT_FOUND",
          404,
          "Source image not found.",
        );
      }
      if (asset.clientId !== clientId) {
        throw new TechnicalVisualMapSpatialBindingDependencyError(
          "TECHNICAL_VISUAL_MAP_SPATIAL_SOURCE_ASSET_CLIENT_MISMATCH",
          404,
          "Source image does not belong to this client.",
        );
      }
      if (asset.width == null || asset.height == null) {
        throw new TechnicalVisualMapSpatialBindingDependencyError(
          "TECHNICAL_VISUAL_MAP_SPATIAL_SOURCE_DIMENSIONS_UNAVAILABLE",
          422,
          `Image asset ${asset.id} has no recorded dimensions; a spatial binding cannot be created until they are available.`,
        );
      }

      const maxVersion = await tx.technicalVisualMapSpatialBinding.aggregate({
        where: { ownerUserId, clientId, technicalVisualMapId, sourceImageAssetId, viewLabel },
        _max: { spatialVersion: true },
      });
      const nextSpatialVersion = (maxVersion._max.spatialVersion ?? 0) + 1;

      const row = await tx.technicalVisualMapSpatialBinding.create({
        data: {
          id: randomUUID(),
          ownerUserId,
          clientId,
          technicalVisualMapId,
          sourceImageAssetId,
          sourceImageAnalysisId: null,
          viewLabel,
          status: "DRAFT",
          spatialVersion: nextSpatialVersion,
          geometrySchemaVersion: TECHNICAL_VISUAL_MAP_SPATIAL_GEOMETRY_SCHEMA_VERSION,
          payload: buildInitialSpatialPayload() as unknown as Prisma.InputJsonValue,
          frozenWidth: asset.width,
          frozenHeight: asset.height,
          frozenOrientation: asset.normalizedOrientation,
          frozenContentSha256: asset.contentSha256,
          frozenStorageVersionId: asset.storageVersionId,
        },
      });
      return toSpatialBindingRecord(row);
    }),
  );
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function findSpatialBindingForOwner(
  ownerUserId: string,
  bindingId: string,
): Promise<TechnicalVisualMapSpatialBindingRecord | null> {
  return runSpatialBindingQuery(async () => {
    const row = await prisma.technicalVisualMapSpatialBinding.findFirst({ where: { id: bindingId, ownerUserId } });
    return row ? toSpatialBindingRecord(row) : null;
  });
}

// Full history for one map, across every source image and view -- newest
// created first. Multiple independent (image, view) scopes can coexist
// under one map (Decision Lock 17/multi-view), so ordering by spatialVersion
// alone would not be meaningful across scopes; creation time is.
export async function listSpatialBindingsForMap(
  ownerUserId: string,
  clientId: string,
  technicalVisualMapId: string,
): Promise<TechnicalVisualMapSpatialBindingRecord[]> {
  return runSpatialBindingQuery(async () => {
    const rows = await prisma.technicalVisualMapSpatialBinding.findMany({
      where: { ownerUserId, clientId, technicalVisualMapId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    return rows.map(toSpatialBindingRecord);
  });
}

// The single CONFIRMED binding (if any) for this exact (owner, client, map,
// source image, view) scope. The partial unique index makes more than one
// structurally impossible -- if it ever happens anyway, that is a real
// integrity bug, surfaced as an Invariant error, never silently resolved.
export async function findCurrentConfirmedSpatialBinding(
  ownerUserId: string,
  clientId: string,
  technicalVisualMapId: string,
  sourceImageAssetId: string,
  viewLabel: string,
): Promise<TechnicalVisualMapSpatialBindingRecord | null> {
  return runSpatialBindingQuery(async () => {
    const rows = await prisma.technicalVisualMapSpatialBinding.findMany({
      where: { ownerUserId, clientId, technicalVisualMapId, sourceImageAssetId, viewLabel, status: "CONFIRMED" },
      orderBy: [{ confirmedAt: "desc" }, { id: "desc" }],
    });
    if (rows.length > 1) {
      throw new TechnicalVisualMapSpatialBindingInvariantError(
        `Found ${rows.length} CONFIRMED spatial bindings for one (owner ${ownerUserId}, client ${clientId}, map ` +
          `${technicalVisualMapId}, image ${sourceImageAssetId}, view ${viewLabel}) -- the partial unique index should make this impossible.`,
      );
    }
    return rows[0] ? toSpatialBindingRecord(rows[0]) : null;
  });
}

// ---------------------------------------------------------------------------
// applySpatialBindingEdits
// ---------------------------------------------------------------------------

// Legal only while DRAFT. Every operation is validated (closed, typed shape
// -- see isSpatialBindingEditOperation) before any write; there is no
// generic JSON Patch surface. Applies all operations to the CURRENT payload
// in place (Decision Lock 14 -- no separate baseline/ledger) and persists
// the resulting new payload as the row's own `payload`.
export async function applySpatialBindingEdits(
  ownerUserId: string,
  bindingId: string,
  operations: SpatialBindingEditOperation[],
): Promise<TechnicalVisualMapSpatialBindingRecord | null> {
  if (!Array.isArray(operations) || operations.length === 0) {
    throw new TechnicalVisualMapSpatialBindingValidationError(
      "TECHNICAL_VISUAL_MAP_SPATIAL_BINDING_INVALID_EDIT_OPERATION",
      "operations must be a non-empty array.",
    );
  }
  if (!isSpatialBindingEditOperationArray(operations)) {
    throw new TechnicalVisualMapSpatialBindingValidationError(
      "TECHNICAL_VISUAL_MAP_SPATIAL_BINDING_INVALID_EDIT_OPERATION",
      "One or more edit operations are malformed.",
    );
  }

  return runSpatialBindingQuery(() =>
    runSerializableTransaction(async (tx) => {
      const row = await tx.technicalVisualMapSpatialBinding.findFirst({ where: { id: bindingId, ownerUserId } });
      if (!row) return null;

      if (row.status !== "DRAFT") {
        throw new TechnicalVisualMapSpatialBindingStateError(
          row.status,
          "adjust",
          `Spatial binding ${bindingId} is ${row.status}; only a DRAFT binding can be edited.`,
        );
      }

      const currentPayload = parseSpatialPayload(row.payload);
      const nextPayload = applySpatialBindingEditOperations(currentPayload, operations);
      if (!isTechnicalVisualMapSpatialPayload(nextPayload)) {
        // Should be unreachable given validated operations applied to an
        // already-valid payload -- fail safely rather than persist something
        // malformed if it somehow is.
        throw new TechnicalVisualMapSpatialBindingInvariantError(
          `Applying edit operations to spatial binding ${bindingId} produced an invalid payload.`,
        );
      }

      const updated = await tx.technicalVisualMapSpatialBinding.update({
        where: { id: row.id },
        data: { payload: nextPayload as unknown as Prisma.InputJsonValue },
      });
      return toSpatialBindingRecord(updated);
    }),
  );
}

// ---------------------------------------------------------------------------
// confirmSpatialBinding -- CAS confirmation
// ---------------------------------------------------------------------------

// Legal only from DRAFT. `expectedCurrentConfirmedSpatialBindingId` MUST be
// explicitly stated by the caller (typically from a prior
// findCurrentConfirmedSpatialBinding) -- never inferred or re-derived
// internally. Additionally (Stage 5B requirement #19): a spatial binding may
// only be newly CONFIRMED while its parent TechnicalVisualMap is STILL
// CONFIRMED -- if the parent has since become SUPERSEDED, this DRAFT can
// never become authoritative, even though it remains readable as a
// historical DRAFT. This is checked fresh, inside the same transaction,
// before the CAS comparison itself.
export async function confirmSpatialBinding(
  ownerUserId: string,
  bindingId: string,
  expectedCurrentConfirmedSpatialBindingId: string | null,
): Promise<TechnicalVisualMapSpatialBindingRecord | null> {
  return runSpatialBindingQuery(async () => {
    const preflight = await prisma.technicalVisualMapSpatialBinding.findFirst({
      where: { id: bindingId, ownerUserId },
      select: { id: true, status: true },
    });
    if (!preflight) return null;
    if (preflight.status !== "DRAFT") {
      throw new TechnicalVisualMapSpatialBindingStateError(
        preflight.status,
        "confirm",
        `Spatial binding ${bindingId} is ${preflight.status}; only a DRAFT binding can be confirmed.`,
      );
    }

    return runSerializableTransaction(async (tx) => {
      const target = await tx.technicalVisualMapSpatialBinding.findFirst({ where: { id: bindingId, ownerUserId } });
      if (!target) return null;

      if (target.status !== "DRAFT") {
        throw new TechnicalVisualMapSpatialBindingStateError(
          target.status,
          "confirm",
          `Spatial binding ${bindingId} is ${target.status}; only a DRAFT binding can be confirmed.`,
        );
      }

      const parentMap = await tx.technicalVisualMap.findFirst({
        where: { id: target.technicalVisualMapId, ownerUserId },
        select: { status: true },
      });
      if (!parentMap || parentMap.status !== "CONFIRMED") {
        throw new TechnicalVisualMapSpatialBindingDependencyError(
          "TECHNICAL_VISUAL_MAP_SPATIAL_BINDING_PARENT_MAP_INELIGIBLE",
          409,
          `Spatial binding ${bindingId}'s parent Technical Visual Map is no longer CONFIRMED; it can no longer become authoritative.`,
        );
      }

      const existingConfirmed = await tx.technicalVisualMapSpatialBinding.findFirst({
        where: {
          ownerUserId,
          clientId: target.clientId,
          technicalVisualMapId: target.technicalVisualMapId,
          sourceImageAssetId: target.sourceImageAssetId,
          viewLabel: target.viewLabel,
          status: "CONFIRMED",
        },
        select: { id: true },
      });

      if ((existingConfirmed?.id ?? null) !== expectedCurrentConfirmedSpatialBindingId) {
        throw new TechnicalVisualMapSpatialBindingConcurrencyError();
      }

      const now = new Date();

      if (existingConfirmed) {
        await tx.technicalVisualMapSpatialBinding.update({
          where: { id: existingConfirmed.id },
          data: { status: "SUPERSEDED", supersededBySpatialBindingId: target.id, supersededAt: now },
        });
      }

      const updated = await tx.technicalVisualMapSpatialBinding.update({
        where: { id: target.id },
        data: { status: "CONFIRMED", confirmedAt: now },
      });
      return toSpatialBindingRecord(updated);
    });
  });
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

async function runSpatialBindingQuery<T>(operation: () => Promise<T>): Promise<T> {
  if (!isDatabaseConfigured()) throw new TechnicalVisualMapSpatialBindingPersistenceError();

  try {
    return await operation();
  } catch (error) {
    if (
      error instanceof TechnicalVisualMapSpatialBindingPersistenceError ||
      error instanceof TechnicalVisualMapSpatialBindingDependencyError ||
      error instanceof TechnicalVisualMapSpatialBindingConcurrencyError ||
      error instanceof TechnicalVisualMapSpatialBindingValidationError ||
      error instanceof TechnicalVisualMapSpatialBindingStateError ||
      error instanceof TechnicalVisualMapSpatialBindingInvariantError
    ) {
      throw error;
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") {
      throw new TechnicalVisualMapSpatialBindingDependencyError(
        "TECHNICAL_VISUAL_MAP_SPATIAL_BINDING_DEPENDENCY_CHANGED",
        409,
        "Spatial binding dependencies changed.",
      );
    }
    throw new TechnicalVisualMapSpatialBindingPersistenceError();
  }
}

async function runSerializableTransaction<T>(operation: (tx: SpatialBindingTransaction) => Promise<T>): Promise<T> {
  for (let attempt = 1; attempt <= MAX_TRANSACTION_ATTEMPTS; attempt += 1) {
    try {
      return await prisma.$transaction(operation, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (!isRetryableConcurrencyError(error)) throw error;
      if (attempt === MAX_TRANSACTION_ATTEMPTS) throw new TechnicalVisualMapSpatialBindingConcurrencyError();
    }
  }

  throw new TechnicalVisualMapSpatialBindingConcurrencyError();
}

function isRetryableConcurrencyError(error: unknown): boolean {
  if (
    error instanceof TechnicalVisualMapSpatialBindingConcurrencyError ||
    error instanceof TechnicalVisualMapSpatialBindingStateError ||
    error instanceof TechnicalVisualMapSpatialBindingDependencyError ||
    error instanceof TechnicalVisualMapSpatialBindingValidationError ||
    error instanceof TechnicalVisualMapSpatialBindingInvariantError ||
    error instanceof TechnicalVisualMapSpatialBindingPersistenceError
  ) {
    return false;
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    // P2034: transaction write conflict / deadlock (Postgres 40001 / 40P01).
    if (error.code === "P2034") return true;
    // P2002 on this model's own non-primary-key unique constraints (either
    // the ordinary spatialVersion uniqueness, hit by two concurrent creates
    // computing the same next version, or the partial CONFIRMED-only index,
    // hit by two concurrent confirmations) -- both represent "another
    // transaction committed first, re-read fresh data and try again", which
    // is exactly what retrying does.
    if (error.code === "P2002" && hitsSpatialBindingUniqueIndex(error)) return true;
    return false;
  }

  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return message.includes("deadlock") || message.includes("serialization");
}

function hitsSpatialBindingUniqueIndex(error: Prisma.PrismaClientKnownRequestError): boolean {
  const meta = (error.meta ?? {}) as Record<string, unknown>;
  const target = meta.target;
  const targetText =
    typeof target === "string"
      ? target
      : Array.isArray(target)
        ? target.filter((entry): entry is string => typeof entry === "string").join(",")
        : "";

  const modelName = typeof meta.modelName === "string" ? meta.modelName : "";
  const namesModel = modelName === "TechnicalVisualMapSpatialBinding" || error.message.includes("TechnicalVisualMapSpatialBinding");
  const isPrimaryKey = targetText === "id" || targetText.includes("_pkey");
  return namesModel && !isPrimaryKey;
}

function parseSpatialPayload(value: Prisma.JsonValue): TechnicalVisualMapSpatialPayload {
  if (!isTechnicalVisualMapSpatialPayload(value)) throw new TechnicalVisualMapSpatialBindingPersistenceError();
  return value;
}

function toSpatialBindingRecord(row: PrismaSpatialBindingRow): TechnicalVisualMapSpatialBindingRecord {
  return {
    id: row.id,
    ownerUserId: row.ownerUserId,
    clientId: row.clientId,
    technicalVisualMapId: row.technicalVisualMapId,
    sourceImageAssetId: row.sourceImageAssetId,
    sourceImageAnalysisId: row.sourceImageAnalysisId,
    viewLabel: row.viewLabel,
    status: row.status as TechnicalVisualMapSpatialBindingRecord["status"],
    spatialVersion: row.spatialVersion,
    geometrySchemaVersion: row.geometrySchemaVersion,
    payload: parseSpatialPayload(row.payload),
    frozenWidth: row.frozenWidth,
    frozenHeight: row.frozenHeight,
    frozenOrientation: row.frozenOrientation,
    frozenContentSha256: row.frozenContentSha256,
    frozenStorageVersionId: row.frozenStorageVersionId,
    supersededBySpatialBindingId: row.supersededBySpatialBindingId,
    confirmedAt: row.confirmedAt ? row.confirmedAt.toISOString() : null,
    supersededAt: row.supersededAt ? row.supersededAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
