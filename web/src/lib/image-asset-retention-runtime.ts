import { Prisma } from "@prisma/client";

import {
  executeImageAssetRetentionPurge,
  ImageAssetRetentionError,
  type ImageAssetRetentionDatabase,
  type ImageAssetRetentionResult,
  type ImageAssetRetentionTransaction,
} from "./image-asset-retention";
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
