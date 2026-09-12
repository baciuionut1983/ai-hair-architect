import { randomUUID } from "crypto";

import { Prisma, type CaptureSet as PrismaCaptureSetRow, type CaptureSetImage as PrismaCaptureSetImageRow } from "@prisma/client";

import { isDatabaseConfigured, prisma } from "@/lib/prisma";
import {
  findDuplicateCaptureSetViewLabels,
  isCaptureSetPurpose,
  isCaptureSetViewLabel,
  isValidCaptureSetImageInput,
  type CaptureSetImageInput,
  type CaptureSetPurpose,
  type CaptureSetViewLabel,
} from "@/lib/capture-set-validators";

// AI Hair Architect, Stage 2.5.i.21b -- CAPTURE SET, the domain/
// repository layer. Deliberately mirrors technical-visual-map-
// repository.ts's own conventions exactly: the runSerializableTransaction
// retry-on-conflict helper, the runXQuery fail-closed wrapper, the
// ownership-check style (owner-scoped findFirst inside the transaction),
// and the typed-error taxonomy.
//
// LOCKED (Stage 2.5.i.21a audit): a Capture Set groups already-existing
// ImageAsset rows by semantic view (FRONT/LEFT/BACK/RIGHT) -- it NEVER
// duplicates image bytes, storage, or metadata (no imageAssetId here is
// ever anything but a validated reference to an existing, owned
// ImageAsset row). It creates NO provider/consent authority of its own;
// Stage 2.5.i.20's external-provider consent gate remains entirely
// separate and untouched by this file.
//
// VERSIONING mirrors TechnicalVisualMap.mapVersion /
// supersededByMapId exactly: a replacement NEVER mutates an existing
// CaptureSet or CaptureSetImage row (createReplacementCaptureSet only
// ever INSERTs a new CaptureSet + new CaptureSetImage rows, then sets
// the base row's own supersededByCaptureSetId -- the base row's images,
// and any historical reference elsewhere to those specific
// CaptureSetImage/ImageAsset ids, are never touched). "Current" for one
// client is the single row with supersededByCaptureSetId IS NULL;
// "history" is simply every row for that client ordered by
// captureSetVersion -- there is no separate "Visual History" model or
// function (Stage 2.5.i.21a Section 6).
//
// NO CAMERA, NO UI, NO API ROUTE, NO QUALITY/CONSENT LOGIC anywhere in
// this file -- Stage 2.5.i.21b's own explicit non-goal list.

export const CAPTURE_SET_PERSISTENCE_ERROR_CODE = "CAPTURE_SET_PERSISTENCE_UNAVAILABLE";
const MAX_TRANSACTION_ATTEMPTS = 3;

export class CaptureSetPersistenceError extends Error {
  readonly code = CAPTURE_SET_PERSISTENCE_ERROR_CODE;
  readonly httpStatus = 503;

  constructor() {
    super("Capture Set data is temporarily unavailable.");
    this.name = "CaptureSetPersistenceError";
  }
}

export class CaptureSetDependencyError extends Error {
  constructor(
    readonly code:
      | "CAPTURE_SET_CLIENT_NOT_FOUND"
      | "CAPTURE_SET_IMAGE_ASSET_NOT_FOUND"
      | "CAPTURE_SET_BASE_NOT_FOUND"
      | "CAPTURE_SET_BASE_ALREADY_SUPERSEDED",
    readonly httpStatus: 404 | 409,
    message: string,
  ) {
    super(message);
    this.name = "CaptureSetDependencyError";
  }
}

export class CaptureSetValidationError extends Error {
  readonly httpStatus = 422;

  constructor(
    readonly code: "CAPTURE_SET_EMPTY_IMAGES" | "CAPTURE_SET_INVALID_IMAGE" | "CAPTURE_SET_DUPLICATE_VIEW",
    message: string,
  ) {
    super(message);
    this.name = "CaptureSetValidationError";
  }
}

export class CaptureSetConcurrencyError extends Error {
  readonly code = "CAPTURE_SET_CONCURRENCY_CONFLICT";
  readonly httpStatus = 409;

  constructor() {
    super("Capture Set could not be created because of a concurrent write.");
    this.name = "CaptureSetConcurrencyError";
  }
}

// "This should be impossible" -- the persisted data violates the single
// non-superseded-per-(owner, client) invariant createReplacementCaptureSet
// exists to maintain.
export class CaptureSetInvariantError extends Error {
  readonly code = "CAPTURE_SET_CURRENT_INVARIANT_VIOLATED";
  readonly httpStatus = 500;

  constructor(message: string) {
    super(message);
    this.name = "CaptureSetInvariantError";
  }
}

// ---------------------------------------------------------------------------
// Record shapes returned to callers
// ---------------------------------------------------------------------------

export interface CaptureSetImageRecord {
  id: string;
  captureSetId: string;
  ownerUserId: string;
  clientId: string;
  imageAssetId: string;
  viewLabel: CaptureSetViewLabel;
  ordinalPosition: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface CaptureSetRecord {
  id: string;
  ownerUserId: string;
  clientId: string;
  captureSetVersion: number;
  purpose: CaptureSetPurpose;
  supersededByCaptureSetId: string | null;
  images: readonly CaptureSetImageRecord[];
  createdAt: string;
  updatedAt: string;
}

type CaptureSetTransaction = Pick<Prisma.TransactionClient, "captureSet" | "captureSetImage" | "client" | "imageAsset">;
type PrismaCaptureSetWithImages = PrismaCaptureSetRow & { images: PrismaCaptureSetImageRow[] };

// ---------------------------------------------------------------------------
// createCaptureSet
// ---------------------------------------------------------------------------

// Creates a brand-new CaptureSet for a client, from an explicit,
// caller-selected list of (viewLabel, imageAssetId) pairs -- never fewer
// than one image, never a duplicate view within the same call (both
// checked before any write; the DB unique index on
// (captureSetId, viewLabel) is the final backstop). Does NOT require all
// four views -- a set may be built incrementally (Stage 2.5.i.21b §4).
// Every referenced ImageAsset is verified, INSIDE the transaction, to
// already exist, belong to this exact (ownerUserId, clientId), and not
// be soft-deleted -- this function never creates, copies, or moves an
// ImageAsset; it only references existing rows.
// captureSetVersion is allocated transaction-safely (read
// MAX(captureSetVersion) for this (ownerUserId, clientId) scope, +1)
// inside the SAME serializable transaction that performs the insert, so
// a concurrent create cannot silently duplicate a version number -- the
// DB-level unique index on (clientId, ownerUserId, captureSetVersion) is
// the final backstop, surfaced as a retry.
// Stage 8.5L3.1 -- `purpose` defaults to "CLIENT_MULTIVIEW", preserving
// every existing call site's exact current behavior with zero change
// (see this stage's own schema.prisma header comment on CaptureSet.purpose).
// Only Learning Evidence's own image-set route passes
// "PROFESSIONAL_LEARNING_SET" explicitly.
export async function createCaptureSet(
  ownerUserId: string,
  clientId: string,
  images: readonly CaptureSetImageInput[],
  purpose: CaptureSetPurpose = "CLIENT_MULTIVIEW",
): Promise<CaptureSetRecord> {
  validateImagesOrThrow(images);

  return runCaptureSetQuery(() =>
    runSerializableTransaction(async (tx) => {
      const client = await tx.client.findFirst({ where: { id: clientId, ownerUserId, deletedAt: null }, select: { id: true } });
      if (!client) {
        throw new CaptureSetDependencyError("CAPTURE_SET_CLIENT_NOT_FOUND", 404, "Client not found.");
      }

      await assertImagesOwnedByClient(tx, ownerUserId, clientId, images);

      const nextVersion = await nextCaptureSetVersion(tx, ownerUserId, clientId);

      const row = await tx.captureSet.create({
        data: { id: randomUUID(), ownerUserId, clientId, captureSetVersion: nextVersion, purpose },
      });
      const createdImages = await createImageRows(tx, ownerUserId, clientId, row.id, images);
      return toCaptureSetRecord({ ...row, images: createdImages });
    }),
  );
}

// ---------------------------------------------------------------------------
// createReplacementCaptureSet
// ---------------------------------------------------------------------------

// Builds a NEW CaptureSet starting from an existing (base) one, with one
// or more views overridden by `replacementImages` -- views not named in
// `replacementImages` carry forward the base set's own existing
// (imageAssetId, viewLabel) pairs UNCHANGED. The base row and its own
// images are NEVER mutated -- this function only INSERTs new rows, then
// sets the base CaptureSet's own supersededByCaptureSetId to the new
// row's id, inside one transaction (Stage 2.5.i.21b §5/§6: historical
// truth -- e.g. any artifact already referencing the base set's own
// BACK image -- must remain intact and unaffected).
// `baseCaptureSetId` must be the CURRENT (non-superseded) set for this
// client -- replacing from an already-superseded historical set is
// rejected, avoiding ambiguous branching this stage does not need.
export async function createReplacementCaptureSet(
  ownerUserId: string,
  clientId: string,
  baseCaptureSetId: string,
  replacementImages: readonly CaptureSetImageInput[],
): Promise<CaptureSetRecord> {
  validateImagesOrThrow(replacementImages);

  return runCaptureSetQuery(() =>
    runSerializableTransaction(async (tx) => {
      const client = await tx.client.findFirst({ where: { id: clientId, ownerUserId, deletedAt: null }, select: { id: true } });
      if (!client) {
        throw new CaptureSetDependencyError("CAPTURE_SET_CLIENT_NOT_FOUND", 404, "Client not found.");
      }

      const base = (await tx.captureSet.findFirst({
        where: { id: baseCaptureSetId, ownerUserId, clientId },
        include: { images: true },
      })) as PrismaCaptureSetWithImages | null;
      if (!base) {
        throw new CaptureSetDependencyError("CAPTURE_SET_BASE_NOT_FOUND", 404, "Base Capture Set not found.");
      }
      if (base.supersededByCaptureSetId !== null) {
        throw new CaptureSetDependencyError(
          "CAPTURE_SET_BASE_ALREADY_SUPERSEDED",
          409,
          `Capture Set ${baseCaptureSetId} is already superseded; replace from the current set instead.`,
        );
      }

      const merged = new Map<CaptureSetViewLabel, CaptureSetImageInput>();
      for (const baseImage of base.images) {
        if (!isCaptureSetViewLabel(baseImage.viewLabel)) throw new CaptureSetPersistenceError();
        merged.set(baseImage.viewLabel, { viewLabel: baseImage.viewLabel, imageAssetId: baseImage.imageAssetId });
      }
      for (const replacement of replacementImages) {
        merged.set(replacement.viewLabel, replacement);
      }
      const mergedImages = [...merged.values()];

      await assertImagesOwnedByClient(tx, ownerUserId, clientId, mergedImages);

      const nextVersion = await nextCaptureSetVersion(tx, ownerUserId, clientId);

      // Stage 8.5L3.1 -- a replacement inherits the BASE row's own
      // purpose (a learning-set replacement stays a learning set; a
      // client-multiview replacement stays client-multiview). Every
      // existing row's purpose is "CLIENT_MULTIVIEW" (the only value
      // that existed before this stage), so this preserves exact current
      // behavior for every existing call site with zero change.
      const purpose = isCaptureSetPurpose(base.purpose) ? base.purpose : "CLIENT_MULTIVIEW";

      const newRow = await tx.captureSet.create({
        data: { id: randomUUID(), ownerUserId, clientId, captureSetVersion: nextVersion, purpose },
      });
      const createdImages = await createImageRows(tx, ownerUserId, clientId, newRow.id, mergedImages);

      await tx.captureSet.update({
        where: { id: base.id },
        data: { supersededByCaptureSetId: newRow.id },
      });

      return toCaptureSetRecord({ ...newRow, images: createdImages });
    }),
  );
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

// Owner-scoped lookup. Returns null when the set does not exist or is
// not owned by this user -- a not-found read is never an error.
export async function findCaptureSetForOwner(ownerUserId: string, captureSetId: string): Promise<CaptureSetRecord | null> {
  return runCaptureSetQuery(async () => {
    const row = await prisma.captureSet.findFirst({ where: { id: captureSetId, ownerUserId }, include: { images: true } });
    return row ? toCaptureSetRecord(row) : null;
  });
}

// The single current (non-superseded) Capture Set for this client, if
// any. Given the versioning invariant createReplacementCaptureSet
// maintains, there can structurally never be more than one -- if two are
// ever found that is a real integrity bug, surfaced as
// CaptureSetInvariantError, never silently resolved by picking one.
export async function getCurrentCaptureSetForClient(ownerUserId: string, clientId: string): Promise<CaptureSetRecord | null> {
  return runCaptureSetQuery(async () => {
    const rows = await prisma.captureSet.findMany({
      where: { ownerUserId, clientId, supersededByCaptureSetId: null },
      include: { images: true },
    });
    if (rows.length > 1) {
      throw new CaptureSetInvariantError(
        `Found ${rows.length} current (non-superseded) Capture Sets for (owner ${ownerUserId}, client ${clientId}) -- there should never be more than one.`,
      );
    }
    return rows[0] ? toCaptureSetRecord(rows[0]) : null;
  });
}

// Full history for one client, newest-version-first, owner-scoped. This
// IS the client's visual history -- no separate "VisualHistory" entity
// or function exists (Stage 2.5.i.21a Section 6).
export async function listCaptureSetHistory(ownerUserId: string, clientId: string): Promise<CaptureSetRecord[]> {
  return runCaptureSetQuery(async () => {
    const rows = await prisma.captureSet.findMany({
      where: { ownerUserId, clientId },
      include: { images: true },
      orderBy: [{ captureSetVersion: "desc" }, { id: "desc" }],
    });
    return rows.map(toCaptureSetRecord);
  });
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function validateImagesOrThrow(images: readonly CaptureSetImageInput[]): void {
  if (!Array.isArray(images) || images.length === 0) {
    throw new CaptureSetValidationError("CAPTURE_SET_EMPTY_IMAGES", "At least one image is required.");
  }
  if (!images.every(isValidCaptureSetImageInput)) {
    throw new CaptureSetValidationError("CAPTURE_SET_INVALID_IMAGE", "One or more images are not structurally valid.");
  }
  const duplicates = findDuplicateCaptureSetViewLabels(images);
  if (duplicates.length > 0) {
    throw new CaptureSetValidationError("CAPTURE_SET_DUPLICATE_VIEW", `Duplicate view label(s) in the same request: ${duplicates.join(", ")}.`);
  }
}

// Every referenced ImageAsset must already exist, be owned by exactly
// this (ownerUserId, clientId), and not be soft-deleted -- read fresh,
// INSIDE the caller's own transaction, never via a separate pre-
// transaction call (mirrors createDraftFromConfirmedProposal's own
// discipline in technical-visual-map-repository.ts).
async function assertImagesOwnedByClient(
  tx: CaptureSetTransaction,
  ownerUserId: string,
  clientId: string,
  images: readonly CaptureSetImageInput[],
): Promise<void> {
  for (const image of images) {
    const asset = await tx.imageAsset.findFirst({
      where: { id: image.imageAssetId, ownerUserId, clientId, deletedAt: null },
      select: { id: true },
    });
    if (!asset) {
      throw new CaptureSetDependencyError(
        "CAPTURE_SET_IMAGE_ASSET_NOT_FOUND",
        404,
        `ImageAsset ${image.imageAssetId} was not found for this client.`,
      );
    }
  }
}

async function nextCaptureSetVersion(tx: CaptureSetTransaction, ownerUserId: string, clientId: string): Promise<number> {
  const maxVersion = await tx.captureSet.aggregate({
    where: { ownerUserId, clientId },
    _max: { captureSetVersion: true },
  });
  return (maxVersion._max.captureSetVersion ?? 0) + 1;
}

// Explicit, top-level creates -- one per image, never a nested write
// through CaptureSet's own `images` relation. CaptureSetImage's
// `ownerUserId`/`clientId` scalars are shared by TWO relations at once
// (the direct `owner`/`client` FKs, and the composite `captureSet` FK) --
// a nested `captureSet.create({ data: { images: { create: [...] } } })`
// leaves Prisma unable to resolve those scalars unambiguously. Explicit,
// independent creates sidestep the ambiguity entirely and match this
// domain's own general preference for explicit writes over nested nested
// relation magic.
async function createImageRows(
  tx: CaptureSetTransaction,
  ownerUserId: string,
  clientId: string,
  captureSetId: string,
  images: readonly CaptureSetImageInput[],
): Promise<PrismaCaptureSetImageRow[]> {
  const created: PrismaCaptureSetImageRow[] = [];
  for (const image of images) {
    const row = await tx.captureSetImage.create({
      data: {
        id: randomUUID(),
        ownerUserId,
        clientId,
        captureSetId,
        imageAssetId: image.imageAssetId,
        viewLabel: image.viewLabel,
        ordinalPosition: image.ordinalPosition ?? null,
      },
    });
    created.push(row);
  }
  return created;
}

async function runCaptureSetQuery<T>(operation: () => Promise<T>): Promise<T> {
  if (!isDatabaseConfigured()) throw new CaptureSetPersistenceError();

  try {
    return await operation();
  } catch (error) {
    if (
      error instanceof CaptureSetPersistenceError ||
      error instanceof CaptureSetDependencyError ||
      error instanceof CaptureSetConcurrencyError ||
      error instanceof CaptureSetValidationError ||
      error instanceof CaptureSetInvariantError
    ) {
      throw error;
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") {
      throw new CaptureSetDependencyError("CAPTURE_SET_IMAGE_ASSET_NOT_FOUND", 404, "Capture Set dependencies changed.");
    }
    throw new CaptureSetPersistenceError();
  }
}

async function runSerializableTransaction<T>(operation: (tx: CaptureSetTransaction) => Promise<T>): Promise<T> {
  for (let attempt = 1; attempt <= MAX_TRANSACTION_ATTEMPTS; attempt += 1) {
    try {
      return await prisma.$transaction(operation, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error) {
      if (!isRetryableConcurrencyError(error)) throw error;
      if (attempt === MAX_TRANSACTION_ATTEMPTS) throw new CaptureSetConcurrencyError();
    }
  }

  throw new CaptureSetConcurrencyError();
}

function isRetryableConcurrencyError(error: unknown): boolean {
  if (
    error instanceof CaptureSetConcurrencyError ||
    error instanceof CaptureSetDependencyError ||
    error instanceof CaptureSetValidationError ||
    error instanceof CaptureSetInvariantError ||
    error instanceof CaptureSetPersistenceError
  ) {
    return false;
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    // P2034: transaction write conflict / deadlock (Postgres 40001 / 40P01).
    if (error.code === "P2034") return true;
    // P2002 on CaptureSet's own non-primary-key unique constraints (the
    // ordinary captureSetVersion uniqueness, hit by two concurrent creates
    // computing the same next version) -- represents "another transaction
    // committed first, re-read fresh data and try again", which is exactly
    // what retrying this same operation does.
    if (error.code === "P2002" && hitsCaptureSetUniqueIndex(error)) return true;
    return false;
  }

  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return message.includes("deadlock") || message.includes("serialization");
}

function hitsCaptureSetUniqueIndex(error: Prisma.PrismaClientKnownRequestError): boolean {
  const meta = (error.meta ?? {}) as Record<string, unknown>;
  const target = meta.target;
  const targetText =
    typeof target === "string" ? target : Array.isArray(target) ? target.filter((entry): entry is string => typeof entry === "string").join(",") : "";

  const modelName = typeof meta.modelName === "string" ? meta.modelName : "";
  const namesModel = modelName === "CaptureSet" || error.message.includes("CaptureSet");
  const isPrimaryKey = targetText === "id" || targetText.includes("_pkey");
  return namesModel && !isPrimaryKey;
}

function toCaptureSetRecord(row: PrismaCaptureSetWithImages): CaptureSetRecord {
  if (!isCaptureSetPurpose(row.purpose)) throw new CaptureSetPersistenceError();
  return {
    id: row.id,
    ownerUserId: row.ownerUserId,
    clientId: row.clientId,
    captureSetVersion: row.captureSetVersion,
    purpose: row.purpose,
    supersededByCaptureSetId: row.supersededByCaptureSetId,
    images: row.images.map(toCaptureSetImageRecord),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toCaptureSetImageRecord(row: PrismaCaptureSetImageRow): CaptureSetImageRecord {
  if (!isCaptureSetViewLabel(row.viewLabel)) throw new CaptureSetPersistenceError();
  return {
    id: row.id,
    captureSetId: row.captureSetId,
    ownerUserId: row.ownerUserId,
    clientId: row.clientId,
    imageAssetId: row.imageAssetId,
    viewLabel: row.viewLabel,
    ordinalPosition: row.ordinalPosition,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
