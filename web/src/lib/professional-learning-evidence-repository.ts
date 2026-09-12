import { createHash, randomUUID } from "crypto";

import { Prisma } from "@prisma/client";

import { isDatabaseConfigured, prisma } from "@/lib/prisma";
import {
  isValidCreateProfessionalLearningEvidenceInput,
  requiredAssetPointerKindForEvidenceType,
  type CreateProfessionalLearningEvidenceInput,
  type ProfessionalLearningEvidenceAssetPointerKind,
  type ProfessionalLearningEvidenceRightsClassification,
  type ProfessionalLearningEvidenceStatus,
  type ProfessionalLearningEvidenceType,
  type ProfessionalLearningEvidenceVisibilityScope,
} from "@/lib/professional-learning-evidence-validators";

// AI Hair Architect, Professional Skill Engine Stage 8.5L2 -- PROFESSIONAL
// LEARNING EVIDENCE, the durable repository layer. Mirrors this repo's
// own established conventions exactly: capture-set-repository.ts's
// ownership-check style (owner-scoped findFirst INSIDE the transaction,
// never trusting a bare id) and professional-memory-repository.ts's
// soft-revoke discipline (status flip only, row never deleted).
//
// OWNERSHIP IS FAIL-CLOSED (Stage 8.5L2 Part 5): every read/write below
// is scoped by ownerUserId in the WHERE clause itself, never filtered
// after the fact -- a row belonging to a different user is
// indistinguishable from a row that does not exist at all, from the
// caller's point of view (404-equivalent "not found", never a 403 that
// would confirm the row's existence to an unauthorized caller).
//
// NO HARD DELETE anywhere in this file (Stage 8.5L2 Part 18) -- only
// create, owner-scoped reads, and two independent soft lifecycle
// transitions (revoke, mark-source-media-deleted). Neither transition
// ever removes the row or its provenance.
//
// ZERO AI, ZERO analysis, ZERO Skill Registry comparison, ZERO
// ProfessionalLearningDraft creation anywhere in this file (Stage 8.5L2
// Part 15) -- this is evidence persistence only.

export const PROFESSIONAL_LEARNING_EVIDENCE_PERSISTENCE_ERROR_CODE = "PROFESSIONAL_LEARNING_EVIDENCE_PERSISTENCE_UNAVAILABLE";

export class ProfessionalLearningEvidencePersistenceError extends Error {
  readonly code = PROFESSIONAL_LEARNING_EVIDENCE_PERSISTENCE_ERROR_CODE;
  readonly httpStatus = 503;

  constructor() {
    super("Professional learning evidence data is temporarily unavailable.");
    this.name = "ProfessionalLearningEvidencePersistenceError";
  }
}

export function isProfessionalLearningEvidencePersistenceError(error: unknown): error is ProfessionalLearningEvidencePersistenceError {
  return error instanceof ProfessionalLearningEvidencePersistenceError;
}

// Same convention as professionalMemoryPersistenceUnavailableResponse
// (professional-memory-repository.ts) -- one shared response shape for
// every API route that surfaces this exact error.
export function professionalLearningEvidencePersistenceUnavailableResponse(): Response {
  return Response.json(
    { error: PROFESSIONAL_LEARNING_EVIDENCE_PERSISTENCE_ERROR_CODE, message: "Professional learning evidence data is temporarily unavailable." },
    { status: 503, headers: { "Cache-Control": "no-store" } },
  );
}

export class ProfessionalLearningEvidenceValidationError extends Error {
  readonly code = "PROFESSIONAL_LEARNING_EVIDENCE_VALIDATION_FAILED";
  readonly httpStatus = 400;

  constructor(message: string) {
    super(message);
    this.name = "ProfessionalLearningEvidenceValidationError";
  }
}

export class ProfessionalLearningEvidenceDependencyError extends Error {
  constructor(
    readonly code: "PROFESSIONAL_LEARNING_EVIDENCE_IMAGE_ASSET_NOT_FOUND" | "PROFESSIONAL_LEARNING_EVIDENCE_CAPTURE_SET_NOT_FOUND" | "PROFESSIONAL_LEARNING_EVIDENCE_VIDEO_ASSET_NOT_FOUND",
    readonly httpStatus: 404,
    message: string,
  ) {
    super(message);
    this.name = "ProfessionalLearningEvidenceDependencyError";
  }
}

export interface ProfessionalLearningEvidenceRecord {
  readonly id: string;
  readonly ownerUserId: string;
  readonly evidenceType: ProfessionalLearningEvidenceType;
  readonly vertical: string;
  readonly visibilityScope: ProfessionalLearningEvidenceVisibilityScope;
  readonly status: ProfessionalLearningEvidenceStatus;
  readonly title: string | null;
  readonly originalText: string | null;
  readonly contentSha256: string | null;
  readonly imageAssetId: string | null;
  readonly captureSetId: string | null;
  readonly videoAssetId: string | null;
  readonly provenance: Record<string, unknown>;
  readonly sourceMetadata: Record<string, unknown> | null;
  readonly rightsClassification: ProfessionalLearningEvidenceRightsClassification;
  readonly parentEvidenceId: string | null;
  readonly createdByUserId: string;
  readonly revokedAt: string | null;
  readonly sourceMediaDeletedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

type LearningEvidenceTransaction = Pick<Prisma.TransactionClient, "professionalLearningEvidence" | "imageAsset" | "captureSet" | "videoAsset">;

async function runLearningEvidenceQuery<T>(operation: () => Promise<T>): Promise<T> {
  if (!isDatabaseConfigured()) throw new ProfessionalLearningEvidencePersistenceError();

  try {
    return await operation();
  } catch (error) {
    if (
      error instanceof ProfessionalLearningEvidencePersistenceError ||
      error instanceof ProfessionalLearningEvidenceValidationError ||
      error instanceof ProfessionalLearningEvidenceDependencyError
    ) {
      throw error;
    }
    throw new ProfessionalLearningEvidencePersistenceError();
  }
}

// Every referenced asset must already exist, be owned by exactly this
// ownerUserId, and (for ImageAsset/VideoAsset, which have a soft-delete
// lifecycle) not be soft-deleted -- read fresh, INSIDE the caller's own
// transaction, never via a separate pre-transaction call (mirrors
// capture-set-repository.ts's own assertImagesOwnedByClient discipline).
// CaptureSet rows are never soft-deleted (capture-set-repository.ts's own
// header comment: "never deleted by any production code path today"), so
// no deletedAt check applies to that branch.
async function assertAssetPointerOwnedByUser(
  tx: LearningEvidenceTransaction,
  ownerUserId: string,
  pointerKind: ProfessionalLearningEvidenceAssetPointerKind,
  assetId: string,
): Promise<void> {
  if (pointerKind === "imageAssetId") {
    const asset = await tx.imageAsset.findFirst({ where: { id: assetId, ownerUserId, deletedAt: null }, select: { id: true } });
    if (!asset) {
      throw new ProfessionalLearningEvidenceDependencyError(
        "PROFESSIONAL_LEARNING_EVIDENCE_IMAGE_ASSET_NOT_FOUND",
        404,
        `ImageAsset ${assetId} was not found for this owner.`,
      );
    }
    return;
  }
  if (pointerKind === "captureSetId") {
    const asset = await tx.captureSet.findFirst({ where: { id: assetId, ownerUserId }, select: { id: true } });
    if (!asset) {
      throw new ProfessionalLearningEvidenceDependencyError(
        "PROFESSIONAL_LEARNING_EVIDENCE_CAPTURE_SET_NOT_FOUND",
        404,
        `CaptureSet ${assetId} was not found for this owner.`,
      );
    }
    return;
  }
  if (pointerKind === "videoAssetId") {
    const asset = await tx.videoAsset.findFirst({ where: { id: assetId, ownerUserId, deletedAt: null }, select: { id: true } });
    if (!asset) {
      throw new ProfessionalLearningEvidenceDependencyError(
        "PROFESSIONAL_LEARNING_EVIDENCE_VIDEO_ASSET_NOT_FOUND",
        404,
        `VideoAsset ${assetId} was not found for this owner.`,
      );
    }
  }
}

function computeTextContentSha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

// Creates one immutable evidence row. Structural shape is validated first
// (professional-learning-evidence-validators.ts); ownership of any
// referenced asset is verified INSIDE the same transaction as the insert,
// so a foreign/nonexistent asset id can never slip through a race. Never
// duplicates the referenced asset's own bytes, metadata, or hash.
//
// Stage 8.5L3 -- SUBMISSION IDEMPOTENCY (Part 13): `options.submissionId`,
// when provided by the caller, becomes this row's own primary key --
// identical precedent to voice-transcript/route.ts's own
// VoiceTranscript.id = attemptId idiom. A double-click or a browser/network
// retry of the exact same logical submission reuses the same
// submissionId, so the resulting P2002 conflict below is recognized and
// answered with the ALREADY-persisted row instead of a duplicate or an
// error. This is deliberately narrower than content-hash dedup (Part 13:
// "same bytes" and "same submission" are different questions) -- the same
// photo/video submitted twice with two different submissionIds still
// legitimately creates two separate evidence rows.
export async function createLearningEvidence(
  ownerUserId: string,
  input: CreateProfessionalLearningEvidenceInput,
  options?: { readonly submissionId?: string },
): Promise<ProfessionalLearningEvidenceRecord> {
  if (!isValidCreateProfessionalLearningEvidenceInput(input)) {
    throw new ProfessionalLearningEvidenceValidationError("Professional learning evidence input is not structurally valid.");
  }

  const pointerKind = requiredAssetPointerKindForEvidenceType(input.evidenceType);
  const pointerId = pointerKind ? (input[pointerKind] as string | null | undefined) ?? null : null;

  const contentSha256 =
    (input.evidenceType === "TEXT" || input.evidenceType === "VOICE_TRANSCRIPT") && input.originalText
      ? computeTextContentSha256(input.originalText)
      : null;

  const id = options?.submissionId?.trim() || randomUUID();

  return runLearningEvidenceQuery(async () => {
    try {
      return await prisma.$transaction(async (tx) => {
        if (pointerKind && pointerId) {
          await assertAssetPointerOwnedByUser(tx, ownerUserId, pointerKind, pointerId);
        }

        const row = await tx.professionalLearningEvidence.create({
          data: {
            id,
            ownerUserId,
            evidenceType: input.evidenceType,
            vertical: input.vertical,
            title: input.title ?? null,
            originalText: input.originalText ?? null,
            contentSha256,
            imageAssetId: pointerKind === "imageAssetId" ? pointerId : null,
            captureSetId: pointerKind === "captureSetId" ? pointerId : null,
            videoAssetId: pointerKind === "videoAssetId" ? pointerId : null,
            provenance: input.provenance as never,
            sourceMetadata: (input.sourceMetadata ?? null) as never,
            rightsClassification: input.rightsClassification,
            createdByUserId: ownerUserId,
          },
        });

        return toRecord(row);
      });
    } catch (error) {
      // A P2002 on the create above aborts the whole transaction at the
      // Postgres level (25P02 -- no further command, not even a SELECT,
      // may run on that same transaction) -- the recovery lookup below
      // MUST use the plain `prisma` client, outside any transaction,
      // never `tx`. Only a genuine replay of THIS owner's own prior
      // submission is treated as idempotent success -- an id collision
      // against a different owner's row (astronomically unlikely, never
      // trusted blindly) still surfaces as a real error, matching
      // voice-transcript/route.ts's identical ownership re-check.
      if (options?.submissionId && error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const existing = await prisma.professionalLearningEvidence.findFirst({ where: { id, ownerUserId } });
        if (existing) return toRecord(existing);
      }
      throw error;
    }
  });
}

// Owner-scoped lookup. Returns null when the row does not exist or is not
// owned by this user -- a not-found read is never an error, and never
// distinguishable from "belongs to someone else" (Stage 8.5L2 Part 5/21).
export async function findLearningEvidenceForOwner(ownerUserId: string, id: string): Promise<ProfessionalLearningEvidenceRecord | null> {
  return runLearningEvidenceQuery(async () => {
    const row = await prisma.professionalLearningEvidence.findFirst({ where: { id, ownerUserId } });
    return row ? toRecord(row) : null;
  });
}

export interface ListLearningEvidenceFilter {
  readonly evidenceType?: ProfessionalLearningEvidenceType;
  readonly status?: ProfessionalLearningEvidenceStatus;
}

// Bounded, owner-scoped listing, newest first -- never a cross-owner
// query, regardless of filter.
export async function listLearningEvidenceForOwner(
  ownerUserId: string,
  filter: ListLearningEvidenceFilter = {},
): Promise<ProfessionalLearningEvidenceRecord[]> {
  return runLearningEvidenceQuery(async () => {
    const rows = await prisma.professionalLearningEvidence.findMany({
      where: { ownerUserId, ...(filter.evidenceType ? { evidenceType: filter.evidenceType } : {}), ...(filter.status ? { status: filter.status } : {}) },
      orderBy: { createdAt: "desc" },
    });
    return rows.map(toRecord);
  });
}

// REVOKE (Stage 8.5L2 Part 10): evidence must no longer influence future
// learning/reasoning. Only ever flips status ACTIVE -> REVOKED (never
// deletes the row, so provenance and any later source-media-deletion
// history survive) and only for a row this exact owner already has
// ACTIVE -- revoking a foreign, already-revoked, or already-
// source-deleted row is a no-op (false), never a 500 or a silent success
// on the wrong row. Never touches the referenced ImageAsset/CaptureSet/
// VideoAsset row -- revocation is a statement about the EVIDENCE's
// authority, not a request to delete the underlying media (see
// markLearningEvidenceSourceMediaDeleted for that, a separate action).
export async function revokeLearningEvidence(ownerUserId: string, id: string): Promise<boolean> {
  return runLearningEvidenceQuery(async () => {
    const changed = await prisma.professionalLearningEvidence.updateMany({
      where: { id, ownerUserId, status: "ACTIVE" },
      data: { status: "REVOKED", revokedAt: new Date() },
    });
    return changed.count > 0;
  });
}

// DELETE SOURCE MEDIA persistence piece (Stage 8.5L2 Part 10) -- records
// that the original bytes behind this evidence were removed, independent
// of whether the evidence was ever revoked. This function does NOT
// perform any real media deletion itself (that remains the referenced
// ImageAsset/VideoAsset's own retention/purge lifecycle, entirely
// separate systems); it only lets that future event be honestly recorded
// here once it happens. sourceMediaDeletedAt is the permanent, never-
// cleared proof this transition occurred; status becomes DELETED_SOURCE
// as the current-lifecycle label, but revokedAt (if already set) is never
// cleared -- so "revoked, and its source media was later deleted" remains
// reconstructible from the two independent timestamps even though status
// itself only ever shows one label at a time.
export async function markLearningEvidenceSourceMediaDeleted(ownerUserId: string, id: string): Promise<boolean> {
  return runLearningEvidenceQuery(async () => {
    const changed = await prisma.professionalLearningEvidence.updateMany({
      where: { id, ownerUserId, sourceMediaDeletedAt: null },
      data: { status: "DELETED_SOURCE", sourceMediaDeletedAt: new Date() },
    });
    return changed.count > 0;
  });
}

export interface LearningEvidenceSourceLinkage {
  readonly evidenceId: string;
  readonly evidenceType: ProfessionalLearningEvidenceType;
  readonly assetPointerKind: ProfessionalLearningEvidenceAssetPointerKind;
  readonly assetId: string | null;
  // null when this evidence type carries no asset pointer at all
  // (TEXT/VOICE_TRANSCRIPT/EXTERNAL_RESEARCH/MANUFACTURER_SOURCE/
  // TREND_SOURCE); otherwise true/false based on the referenced row's own
  // current deletedAt (ImageAsset/VideoAsset) -- a CaptureSet is never
  // soft-deleted (capture-set-repository.ts), so a captureSetId pointer
  // is always reported available once found.
  readonly sourceAssetStillAvailable: boolean | null;
}

// "Inspect source linkage" (Stage 8.5L2 Part 18) -- an owner-scoped,
// read-only report of which real asset (if any) backs one evidence row,
// and whether that asset is still available. Never mutates anything.
export async function getLearningEvidenceSourceLinkage(ownerUserId: string, id: string): Promise<LearningEvidenceSourceLinkage | null> {
  return runLearningEvidenceQuery(async () => {
    const row = await prisma.professionalLearningEvidence.findFirst({ where: { id, ownerUserId } });
    if (!row) return null;

    const assetPointerKind = requiredAssetPointerKindForEvidenceType(row.evidenceType as ProfessionalLearningEvidenceType);
    if (!assetPointerKind) {
      return { evidenceId: row.id, evidenceType: row.evidenceType as ProfessionalLearningEvidenceType, assetPointerKind: null, assetId: null, sourceAssetStillAvailable: null };
    }

    const assetId = (row[assetPointerKind] as string | null) ?? null;
    if (!assetId) {
      return { evidenceId: row.id, evidenceType: row.evidenceType as ProfessionalLearningEvidenceType, assetPointerKind, assetId: null, sourceAssetStillAvailable: null };
    }

    let sourceAssetStillAvailable: boolean;
    if (assetPointerKind === "imageAssetId") {
      const asset = await prisma.imageAsset.findFirst({ where: { id: assetId, ownerUserId, deletedAt: null }, select: { id: true } });
      sourceAssetStillAvailable = asset !== null;
    } else if (assetPointerKind === "videoAssetId") {
      const asset = await prisma.videoAsset.findFirst({ where: { id: assetId, ownerUserId, deletedAt: null }, select: { id: true } });
      sourceAssetStillAvailable = asset !== null;
    } else {
      const asset = await prisma.captureSet.findFirst({ where: { id: assetId, ownerUserId }, select: { id: true } });
      sourceAssetStillAvailable = asset !== null;
    }

    return { evidenceId: row.id, evidenceType: row.evidenceType as ProfessionalLearningEvidenceType, assetPointerKind, assetId, sourceAssetStillAvailable };
  });
}

function toRecord(row: {
  id: string;
  ownerUserId: string;
  evidenceType: string;
  vertical: string;
  visibilityScope: string;
  status: string;
  title: string | null;
  originalText: string | null;
  contentSha256: string | null;
  imageAssetId: string | null;
  captureSetId: string | null;
  videoAssetId: string | null;
  provenance: unknown;
  sourceMetadata: unknown;
  rightsClassification: string;
  parentEvidenceId: string | null;
  createdByUserId: string;
  revokedAt: Date | null;
  sourceMediaDeletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): ProfessionalLearningEvidenceRecord {
  return {
    id: row.id,
    ownerUserId: row.ownerUserId,
    evidenceType: row.evidenceType as ProfessionalLearningEvidenceType,
    vertical: row.vertical,
    visibilityScope: row.visibilityScope as ProfessionalLearningEvidenceVisibilityScope,
    status: row.status as ProfessionalLearningEvidenceStatus,
    title: row.title,
    originalText: row.originalText,
    contentSha256: row.contentSha256,
    imageAssetId: row.imageAssetId,
    captureSetId: row.captureSetId,
    videoAssetId: row.videoAssetId,
    provenance: (row.provenance ?? {}) as Record<string, unknown>,
    sourceMetadata: row.sourceMetadata as Record<string, unknown> | null,
    rightsClassification: row.rightsClassification as ProfessionalLearningEvidenceRightsClassification,
    parentEvidenceId: row.parentEvidenceId,
    createdByUserId: row.createdByUserId,
    revokedAt: row.revokedAt ? row.revokedAt.toISOString() : null,
    sourceMediaDeletedAt: row.sourceMediaDeletedAt ? row.sourceMediaDeletedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
