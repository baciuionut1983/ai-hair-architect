import { Prisma } from "@prisma/client";

import {
  buildImageAssetRetentionEligibilityWhere,
  executeImageAssetRetentionPurge,
  IMAGE_ASSET_RETENTION_CONFIRMATION_TOKEN,
  ImageAssetRetentionError,
  type ImageAssetRetentionDatabase,
  type ImageAssetRetentionResult,
  type ImageAssetRetentionTransaction,
} from "./image-asset-retention";
import {
  runImageAssetRetentionAutomationSweep,
  type RetentionAutomationSweepResult,
} from "./image-asset-retention-automation";
import { findHistoricallyReferencedImageAssetIds, type HistoricalImageReferenceDatabase } from "./image-asset-historical-reference-guard";
import { deleteConfinedImageFileForRetention, getStoragePath } from "./image-storage";
import { createObjectStorageAliasResolver } from "./object-storage-alias-resolver";
import { classifyObjectStorageError, ObjectStorageError } from "./object-storage-errors";
import { prisma } from "./prisma";
import { writeOpsAuditEvent } from "./ops-persistence";

export { ImageAssetRetentionError };
export type { ImageAssetRetentionResult };

export interface RunImageAssetRetentionPurgeInput {
  readonly ownerUserId: string;
  readonly dryRun: boolean;
  readonly confirmationToken?: string;
  readonly executionIdempotencyKey?: string;
  readonly reason?: string;
  readonly correlationRequestId: string;
}

const database: ImageAssetRetentionDatabase = {
  imageAsset: {
    findMany: (args) => prisma.imageAsset.findMany(args as never) as never,
  },
  opsImageAssetRetentionRun: {
    findUnique: (args) => prisma.opsImageAssetRetentionRun.findUnique(args as never) as never,
    create: (args) => prisma.opsImageAssetRetentionRun.create(args as never) as never,
  },
  $transaction: (fn) =>
    prisma.$transaction(async (tx) => {
      const wrapped: ImageAssetRetentionTransaction = {
        imageAsset: {
          deleteMany: (args) => tx.imageAsset.deleteMany(args as never),
        },
        opsImageAssetRetentionRun: {
          findUnique: (args) => tx.opsImageAssetRetentionRun.findUnique(args as never) as never,
          create: (args) => tx.opsImageAssetRetentionRun.create(args as never) as never,
          update: (args) => tx.opsImageAssetRetentionRun.update(args as never) as never,
        },
        auditLog: {
          create: (args) => tx.auditLog.create(args as never),
        },
        tryAcquireAdvisoryLock: async (lockKey) => {
          const rows = await tx.$queryRaw<Array<{ acquired: boolean }>>(
            Prisma.sql`SELECT pg_try_advisory_xact_lock(CAST(${lockKey} AS bigint)) AS acquired`,
          );
          return rows[0]?.acquired === true;
        },
      };
      return fn(wrapped);
    }),
};

// RETENTION SAFETY GATE, real wiring. One `findMany` per source named in
// image-asset-historical-reference-guard.ts's own inventory comment --
// each returns only the distinct referencing column value, filtered to
// the candidate batch, non-null. No AI, no external call, plain indexed
// Prisma reads. Exported (not just used internally) so a real-Postgres
// test can exercise these exact queries directly against real rows in
// each source table, rather than only re-testing the pure merge logic
// with fakes.
export const historicalReferenceDatabase: HistoricalImageReferenceDatabase = {
  analysisByImageAssetId: async (ids) => {
    const rows = await prisma.analysis.findMany({ where: { imageAssetId: { in: [...ids] } }, select: { imageAssetId: true }, distinct: ["imageAssetId"] });
    return rows.map((r) => r.imageAssetId).filter((v): v is string => v !== null);
  },
  imageAnalysisByAssetId: async (ids) => {
    const rows = await prisma.imageAnalysis.findMany({ where: { assetId: { in: [...ids] } }, select: { assetId: true }, distinct: ["assetId"] });
    return rows.map((r) => r.assetId);
  },
  analysisProposalBySourceImageAssetId: async (ids) => {
    const rows = await prisma.analysisProposal.findMany({
      where: { sourceImageAssetId: { in: [...ids] } },
      select: { sourceImageAssetId: true },
      distinct: ["sourceImageAssetId"],
    });
    return rows.map((r) => r.sourceImageAssetId).filter((v): v is string => v !== null);
  },
  technicalVisualMapBySourceImageAssetId: async (ids) => {
    const rows = await prisma.technicalVisualMap.findMany({
      where: { sourceImageAssetId: { in: [...ids] } },
      select: { sourceImageAssetId: true },
      distinct: ["sourceImageAssetId"],
    });
    return rows.map((r) => r.sourceImageAssetId).filter((v): v is string => v !== null);
  },
  technicalVisualMapSpatialBindingBySourceImageAssetId: async (ids) => {
    const rows = await prisma.technicalVisualMapSpatialBinding.findMany({
      where: { sourceImageAssetId: { in: [...ids] } },
      select: { sourceImageAssetId: true },
      distinct: ["sourceImageAssetId"],
    });
    return rows.map((r) => r.sourceImageAssetId);
  },
  hairStateSnapshotBySourceImageAssetId: async (ids) => {
    const rows = await prisma.hairStateSnapshot.findMany({
      where: { sourceImageAssetId: { in: [...ids] } },
      select: { sourceImageAssetId: true },
      distinct: ["sourceImageAssetId"],
    });
    return rows.map((r) => r.sourceImageAssetId).filter((v): v is string => v !== null);
  },
  hairStateSnapshotEvidenceByImageAssetId: async (ids) => {
    const rows = await prisma.hairStateSnapshotEvidence.findMany({
      where: { imageAssetId: { in: [...ids] } },
      select: { imageAssetId: true },
      distinct: ["imageAssetId"],
    });
    return rows.map((r) => r.imageAssetId).filter((v): v is string => v !== null);
  },
  captureSetImageByImageAssetId: async (ids) => {
    const rows = await prisma.captureSetImage.findMany({ where: { imageAssetId: { in: [...ids] } }, select: { imageAssetId: true }, distinct: ["imageAssetId"] });
    return rows.map((r) => r.imageAssetId);
  },
  photoPreviewGenerationBySourceImageAssetId: async (ids) => {
    const rows = await prisma.photoPreviewGeneration.findMany({
      where: { sourceImageAssetId: { in: [...ids] } },
      select: { sourceImageAssetId: true },
      distinct: ["sourceImageAssetId"],
    });
    return rows.map((r) => r.sourceImageAssetId);
  },
  photoPreviewGenerationByGeneratedImageAssetId: async (ids) => {
    const rows = await prisma.photoPreviewGeneration.findMany({
      where: { generatedImageAssetId: { in: [...ids] } },
      select: { generatedImageAssetId: true },
      distinct: ["generatedImageAssetId"],
    });
    return rows.map((r) => r.generatedImageAssetId).filter((v): v is string => v !== null);
  },
  videoDemonstrationGenerationBySourceGeneratedImageAssetId: async (ids) => {
    const rows = await prisma.videoDemonstrationGeneration.findMany({
      where: { sourceGeneratedImageAssetId: { in: [...ids] } },
      select: { sourceGeneratedImageAssetId: true },
      distinct: ["sourceGeneratedImageAssetId"],
    });
    return rows.map((r) => r.sourceGeneratedImageAssetId);
  },
  technicalExecutionGenerationRequestByImageAssetId: async (ids) => {
    const rows = await prisma.technicalExecutionGenerationRequest.findMany({
      where: { imageAssetId: { in: [...ids] } },
      select: { imageAssetId: true },
      distinct: ["imageAssetId"],
    });
    return rows.map((r) => r.imageAssetId);
  },
};

// Real S3 delete + confirm, mirroring storage-readiness-canary.ts's own
// proven "delete, then confirm via a follow-up head() expecting not_found"
// pattern -- the same standard this codebase already trusts for verifying
// a real deletion actually took effect, not just that the API call
// returned without error.
function makeDeleteS3Object(): (identity: { bucketAlias: string; key: string; versionId: string }) => Promise<void> {
  const resolveObjectStorage = createObjectStorageAliasResolver();

  return async (identity) => {
    const storage = await resolveObjectStorage(identity.bucketAlias);
    if (!storage) {
      throw new Error("IMAGE_ASSET_RETENTION_OBJECT_STORAGE_UNAVAILABLE");
    }

    await storage.delete(identity);

    try {
      await storage.head(identity);
    } catch (error) {
      const classified = error instanceof ObjectStorageError ? error : classifyObjectStorageError(error);
      if (classified.code === "not_found") {
        return;
      }
      throw classified;
    }

    // head() succeeding means the object/version is still visible: the
    // delete did not actually take effect, regardless of what the delete
    // call itself reported.
    throw new Error("IMAGE_ASSET_RETENTION_S3_DELETE_UNCONFIRMED");
  };
}

async function deleteLocalFile(row: { ownerUserId: string; id: string; fileName: string }): Promise<"deleted" | "already_absent"> {
  const storagePath = getStoragePath(row.ownerUserId, row.id, row.fileName);
  return deleteConfinedImageFileForRetention(storagePath);
}

export async function runImageAssetRetentionPurgeForUser(
  input: RunImageAssetRetentionPurgeInput,
): Promise<ImageAssetRetentionResult> {
  return executeImageAssetRetentionPurge({
    ownerUserId: input.ownerUserId,
    dryRun: input.dryRun,
    confirmationToken: input.confirmationToken,
    executionIdempotencyKey: input.executionIdempotencyKey,
    reason: input.reason,
    correlationRequestId: input.correlationRequestId,
    database,
    now: () => new Date(),
    deleteS3Object: makeDeleteS3Object(),
    deleteLocalFile,
    findHistoricallyReferencedImageAssetIds: (candidateImageAssetIds) =>
      findHistoricallyReferencedImageAssetIds(historicalReferenceDatabase, candidateImageAssetIds),
    writeDryRunAuditEvent: async ({ eligibleCount, runId }) => {
      await writeOpsAuditEvent({
        actorUserId: input.ownerUserId,
        action: "ops.image_asset_retention.dry_run.completed",
        status: "success",
        correlationRequestId: input.correlationRequestId,
        resourceId: runId,
        metadata: { eligibleCount },
      });
    },
  });
}

// M37: the scheduler-facing entry point. Finds every owner with at least
// one eligible row and runs M36's own, unmodified per-owner purge for
// each -- this function contributes no new deletion logic of its own,
// only cross-owner orchestration (see image-asset-retention-automation.ts
// for why no sweep-level lock is added on top of the existing per-owner
// one).
export async function runImageAssetRetentionAutomationSweepForRuntime(
  correlationRequestId: string,
  dryRun: boolean,
): Promise<RetentionAutomationSweepResult> {
  const MAX_OWNERS_PER_RUN = 200;
  const MAX_CONCURRENCY = 5;

  return runImageAssetRetentionAutomationSweep({
    now: () => new Date(),
    maxOwnersPerRun: MAX_OWNERS_PER_RUN,
    maxConcurrency: MAX_CONCURRENCY,
    findEligibleOwnerIds: async (limit) => {
      const rows = await prisma.imageAsset.findMany({
        where: buildImageAssetRetentionEligibilityWhere(new Date()),
        select: { ownerUserId: true },
        distinct: ["ownerUserId"],
        orderBy: { ownerUserId: "asc" },
        take: limit,
      });
      return rows.map((row) => row.ownerUserId);
    },
    purgeForOwner: async (ownerUserId, idempotencyKey) => {
      const result = await runImageAssetRetentionPurgeForUser({
        ownerUserId,
        dryRun,
        confirmationToken: dryRun ? undefined : IMAGE_ASSET_RETENTION_CONFIRMATION_TOKEN,
        executionIdempotencyKey: dryRun ? undefined : idempotencyKey,
        reason: "automated sweep",
        correlationRequestId,
      });
      return { eligibleCount: result.eligibleCount, purgedCount: result.purgedCount, failedCount: result.failedCount };
    },
  });
}
