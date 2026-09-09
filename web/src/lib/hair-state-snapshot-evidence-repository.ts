import { randomUUID } from "crypto";

import { Prisma, type HairStateSnapshotEvidence as PrismaHairStateSnapshotEvidenceRow } from "@prisma/client";

import { isDatabaseConfigured, prisma } from "@/lib/prisma";
import { isCaptureSetViewLabel, type CaptureSetViewLabel } from "@/lib/capture-set-validators";
import {
  findDuplicateHairStateSnapshotEvidence,
  isEvidenceRoleValidForSnapshotRole,
  isValidHairStateSnapshotEvidenceInput,
  type HairStateSnapshotEvidenceInput,
  type HairStateSnapshotEvidenceKind,
  type HairStateSnapshotEvidenceRole,
} from "@/lib/hair-state-snapshot-evidence-validators";

// AI Hair Architect, Stage 3 -- VISUAL EVIDENCE BINDING, domain/repository
// layer. Mirrors capture-set-repository.ts's own conventions exactly: the
// ownership-check style (owner-scoped findFirst inside the caller's own
// transaction), the typed-error taxonomy, no separate serializable
// transaction of its own -- evidence rows are ALWAYS created inside the
// SAME transaction as their parent HairStateSnapshot row (see
// hair-state-snapshot-repository.ts's own createSnapshotRow), never as a
// separate write that could observe a half-created snapshot.
//
// IMMUTABLE BY CONSTRUCTION: this file exports no update/delete function
// for an existing evidence row -- once written, a row is never rewritten
// (Stage 3's own "old snapshots must keep pointing to the exact evidence
// used when created" requirement). Replacing a client's CURRENT photos or
// CaptureSet never touches an old evidence row: createReplacementCaptureSet
// (capture-set-repository.ts) never mutates a base CaptureSet or its
// images, so an old evidence row's own captureSetId/imageAssetId keeps
// resolving to the exact same historical images forever.

export class HairStateSnapshotEvidencePersistenceError extends Error {
  readonly code = "HAIR_STATE_SNAPSHOT_EVIDENCE_PERSISTENCE_UNAVAILABLE";
  readonly httpStatus = 503;

  constructor() {
    super("Hair State Snapshot evidence data is temporarily unavailable.");
    this.name = "HairStateSnapshotEvidencePersistenceError";
  }
}

export class HairStateSnapshotEvidenceValidationError extends Error {
  readonly httpStatus = 422;

  constructor(
    readonly code: "HAIR_STATE_SNAPSHOT_EVIDENCE_INVALID_INPUT" | "HAIR_STATE_SNAPSHOT_EVIDENCE_DUPLICATE" | "HAIR_STATE_SNAPSHOT_EVIDENCE_ROLE_MISMATCH",
    message: string,
  ) {
    super(message);
    this.name = "HairStateSnapshotEvidenceValidationError";
  }
}

export class HairStateSnapshotEvidenceDependencyError extends Error {
  constructor(
    readonly code: "HAIR_STATE_SNAPSHOT_EVIDENCE_IMAGE_ASSET_NOT_FOUND" | "HAIR_STATE_SNAPSHOT_EVIDENCE_CAPTURE_SET_NOT_FOUND",
    readonly httpStatus: 404,
    message: string,
  ) {
    super(message);
    this.name = "HairStateSnapshotEvidenceDependencyError";
  }
}

// ---------------------------------------------------------------------------
// Record shapes
// ---------------------------------------------------------------------------

export interface HairStateSnapshotEvidenceRecord {
  id: string;
  ownerUserId: string;
  clientId: string;
  hairStateSnapshotId: string;
  evidenceKind: HairStateSnapshotEvidenceKind;
  evidenceRole: HairStateSnapshotEvidenceRole;
  imageAssetId: string | null;
  captureSetId: string | null;
  viewLabel: CaptureSetViewLabel | null;
  createdAt: string;
  updatedAt: string;
}

// Deterministic retrieval result: snapshot -> evidence set -> exact
// images -> view info. `resolvedImageAssetIds` is the CaptureSet's own
// CaptureSetImage-derived (imageAssetId, viewLabel) pairs when
// evidenceKind is CAPTURE_SET, or the single (imageAssetId, viewLabel)
// pair when IMAGE_ASSET -- either way, the caller never has to branch on
// evidenceKind to reach "which exact images, which exact views".
export interface ResolvedHairStateSnapshotEvidence extends HairStateSnapshotEvidenceRecord {
  resolvedImages: readonly { imageAssetId: string; viewLabel: CaptureSetViewLabel | null }[];
}

type EvidenceCreateTransaction = Pick<Prisma.TransactionClient, "hairStateSnapshotEvidence" | "imageAsset" | "captureSet" | "captureSetImage">;

// ---------------------------------------------------------------------------
// createEvidenceRowsForSnapshot -- internal, called by
// hair-state-snapshot-repository.ts's own createSnapshotRow, INSIDE that
// function's own transaction. Never exported for standalone use: an
// evidence row with no parent snapshot row is meaningless, and creating
// one outside the snapshot's own transaction would risk a half-written
// pair under a concurrent failure.
// ---------------------------------------------------------------------------

export async function createEvidenceRowsForSnapshot(
  tx: EvidenceCreateTransaction,
  ownerUserId: string,
  clientId: string,
  hairStateSnapshotId: string,
  snapshotRole: string,
  evidence: readonly HairStateSnapshotEvidenceInput[],
): Promise<HairStateSnapshotEvidenceRecord[]> {
  if (evidence.length === 0) return [];

  if (!evidence.every(isValidHairStateSnapshotEvidenceInput)) {
    throw new HairStateSnapshotEvidenceValidationError("HAIR_STATE_SNAPSHOT_EVIDENCE_INVALID_INPUT", "One or more evidence entries are not structurally valid.");
  }
  const duplicates = findDuplicateHairStateSnapshotEvidence(evidence);
  if (duplicates.length > 0) {
    throw new HairStateSnapshotEvidenceValidationError("HAIR_STATE_SNAPSHOT_EVIDENCE_DUPLICATE", "Duplicate evidence entries referencing the same image/Capture Set.");
  }
  for (const entry of evidence) {
    if (!isEvidenceRoleValidForSnapshotRole(snapshotRole, entry.evidenceRole)) {
      throw new HairStateSnapshotEvidenceValidationError(
        "HAIR_STATE_SNAPSHOT_EVIDENCE_ROLE_MISMATCH",
        `evidenceRole "${entry.evidenceRole}" is not valid for a ${snapshotRole} snapshot.`,
      );
    }
  }

  const created: HairStateSnapshotEvidenceRecord[] = [];
  for (const entry of evidence) {
    if (entry.evidenceKind === "IMAGE_ASSET") {
      const asset = await tx.imageAsset.findFirst({ where: { id: entry.imageAssetId, ownerUserId, clientId, deletedAt: null }, select: { id: true } });
      if (!asset) {
        throw new HairStateSnapshotEvidenceDependencyError(
          "HAIR_STATE_SNAPSHOT_EVIDENCE_IMAGE_ASSET_NOT_FOUND",
          404,
          `ImageAsset ${entry.imageAssetId} was not found for this client.`,
        );
      }
    } else {
      const captureSet = await tx.captureSet.findFirst({ where: { id: entry.captureSetId, ownerUserId, clientId }, select: { id: true } });
      if (!captureSet) {
        throw new HairStateSnapshotEvidenceDependencyError(
          "HAIR_STATE_SNAPSHOT_EVIDENCE_CAPTURE_SET_NOT_FOUND",
          404,
          `Capture Set ${entry.captureSetId} was not found for this client.`,
        );
      }
    }

    const row = await tx.hairStateSnapshotEvidence.create({
      data: {
        id: randomUUID(),
        ownerUserId,
        clientId,
        hairStateSnapshotId,
        evidenceKind: entry.evidenceKind,
        evidenceRole: entry.evidenceRole,
        imageAssetId: entry.imageAssetId ?? null,
        captureSetId: entry.captureSetId ?? null,
        viewLabel: entry.viewLabel ?? null,
      },
    });
    created.push(toEvidenceRecord(row));
  }
  return created;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

// Deterministic retrieval: snapshot -> evidence set -> exact images ->
// view info. Zero AI/vision call -- every image identity/view is already
// structured data. Owner-scoped; returns [] for an unknown/foreign
// snapshot id rather than throwing (a not-found read is never an error).
export async function listResolvedEvidenceForSnapshot(ownerUserId: string, hairStateSnapshotId: string): Promise<ResolvedHairStateSnapshotEvidence[]> {
  return runEvidenceQuery(async () => {
    const rows = await prisma.hairStateSnapshotEvidence.findMany({
      where: { ownerUserId, hairStateSnapshotId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });

    const resolved: ResolvedHairStateSnapshotEvidence[] = [];
    for (const row of rows) {
      const record = toEvidenceRecord(row);
      if (record.evidenceKind === "IMAGE_ASSET") {
        resolved.push({ ...record, resolvedImages: [{ imageAssetId: record.imageAssetId as string, viewLabel: record.viewLabel }] });
      } else {
        const images = await prisma.captureSetImage.findMany({
          where: { ownerUserId, captureSetId: record.captureSetId as string },
          orderBy: [{ viewLabel: "asc" }],
        });
        resolved.push({
          ...record,
          resolvedImages: images.map((image) => ({
            imageAssetId: image.imageAssetId,
            viewLabel: isCaptureSetViewLabel(image.viewLabel) ? image.viewLabel : null,
          })),
        });
      }
    }
    return resolved;
  });
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

async function runEvidenceQuery<T>(operation: () => Promise<T>): Promise<T> {
  if (!isDatabaseConfigured()) throw new HairStateSnapshotEvidencePersistenceError();
  try {
    return await operation();
  } catch (error) {
    if (
      error instanceof HairStateSnapshotEvidencePersistenceError ||
      error instanceof HairStateSnapshotEvidenceValidationError ||
      error instanceof HairStateSnapshotEvidenceDependencyError
    ) {
      throw error;
    }
    throw new HairStateSnapshotEvidencePersistenceError();
  }
}

function toEvidenceRecord(row: PrismaHairStateSnapshotEvidenceRow): HairStateSnapshotEvidenceRecord {
  return {
    id: row.id,
    ownerUserId: row.ownerUserId,
    clientId: row.clientId,
    hairStateSnapshotId: row.hairStateSnapshotId,
    evidenceKind: row.evidenceKind as HairStateSnapshotEvidenceKind,
    evidenceRole: row.evidenceRole as HairStateSnapshotEvidenceRole,
    imageAssetId: row.imageAssetId,
    captureSetId: row.captureSetId,
    viewLabel: row.viewLabel !== null && isCaptureSetViewLabel(row.viewLabel) ? row.viewLabel : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
