import { createHash, randomUUID } from "crypto";

// M36: purges ImageAsset rows whose 30-day retention grace period
// (retentionDeletesAt, set by the soft-delete route) has expired. Distinct
// from ops-persistence.ts's runPersistentRetention (which purges
// push-queue/audit-log rows on a relative "olderThanDays" window): this
// operates on an absolute per-row expiry and, critically, must clear a real
// external object (S3, version-pinned, or a local file) BEFORE the DB row
// is ever removed -- never the other way around, and never both in the same
// transaction, since real object-storage I/O must never run inside an open
// Postgres transaction (same discipline as M33's restore execution).
//
// Two-phase design, mirroring backup-m15-v2-restore-execution.ts:
//   Phase 1 (no lock, real I/O): identify eligible rows, clear each row's
//     real object (S3 delete + confirm, or local file delete + confirm).
//     A row whose storage clear fails is excluded from Phase 2 entirely --
//     it stays soft-deleted, still eligible, safely retryable next run.
//   Phase 2 (advisory-locked, DB-only, no I/O): hard-delete only the rows
//     whose storage was actually cleared (or was already absent), verify
//     the affected count, record the run.
//
// This ordering (storage first, DB row last) is deliberate: if storage
// deletion fails, nothing is lost -- the row remains for the next run. If
// it were DB-first, a subsequent storage failure would permanently orphan
// a real object with no remaining DB row to signal it still needs cleanup.

export type ImageAssetRetentionRowOutcome = "purged" | "failed";

export interface ImageAssetRetentionEligibleRow {
  id: string;
  ownerUserId: string;
  fileName: string;
  storageBackend: string | null;
  storageBucketAlias: string | null;
  storageKey: string | null;
  storageVersionId: string | null;
}

export interface ImageAssetRetentionRunRow {
  id: string;
  ownerUserId: string;
  mode: string;
  status: string;
  executionIdempotencyKey: string | null;
  idempotencyFingerprint: string | null;
  startedAt: Date;
  finishedAt: Date | null;
  eligibleCount: number;
  purgedCount: number;
  failedCount: number;
  errorCode: string | null;
  errorMessageSafe: string | null;
}

export interface ImageAssetRetentionTransaction {
  imageAsset: {
    deleteMany(args: {
      where: { ownerUserId: string; id: { in: string[] }; deletedAt: { not: null }; retentionDeletesAt: { lte: Date } };
    }): Promise<{ count: number }>;
  };
  opsImageAssetRetentionRun: {
    findUnique(args: {
      where: { ownerUserId_executionIdempotencyKey: { ownerUserId: string; executionIdempotencyKey: string } };
    }): Promise<ImageAssetRetentionRunRow | null>;
    create(args: { data: Record<string, unknown> }): Promise<ImageAssetRetentionRunRow>;
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<ImageAssetRetentionRunRow>;
  };
  auditLog: {
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
  };
  // Kept as an explicit, injectable method (rather than a raw $queryRaw
  // call) so this file never needs to import Prisma's tagged-template SQL
  // helper -- the real implementation (image-asset-retention-runtime.ts)
  // wraps Prisma's own pg_try_advisory_xact_lock call; the fake used in
  // tests implements the same lock semantics in memory.
  tryAcquireAdvisoryLock(lockKey: string): Promise<boolean>;
}

export interface ImageAssetRetentionDatabase {
  imageAsset: {
    findMany(args: {
      where: {
        ownerUserId: string;
        deletedAt: { not: null };
        retentionDeletesAt: { lte: Date };
        OR: Array<Record<string, unknown>>;
      };
      select: Record<string, true>;
      orderBy: { id: "asc" };
    }): Promise<ImageAssetRetentionEligibleRow[]>;
  };
  opsImageAssetRetentionRun: {
    findUnique(args: {
      where: { ownerUserId_executionIdempotencyKey: { ownerUserId: string; executionIdempotencyKey: string } };
    }): Promise<ImageAssetRetentionRunRow | null>;
    create(args: { data: Record<string, unknown> }): Promise<ImageAssetRetentionRunRow>;
  };
  // Read Committed (Postgres's default) is sufficient: rows are strictly
  // owner-scoped (no cross-owner interference possible), the advisory lock
  // already serializes concurrent runs for the same owner, and the
  // deleteMany's own WHERE clause re-checks eligibility at execution time.
  $transaction<T>(fn: (tx: ImageAssetRetentionTransaction) => Promise<T>): Promise<T>;
}

export type ImageAssetRetentionErrorCode =
  | "CONFIRMATION_REQUIRED"
  | "IDEMPOTENCY_CONFLICT"
  | "RETENTION_CONFLICT"
  | "RETENTION_PARTIAL_DELETE"
  | "INTERNAL_ERROR";

export class ImageAssetRetentionError extends Error {
  readonly code: ImageAssetRetentionErrorCode;
  readonly httpStatus: number;

  constructor(code: ImageAssetRetentionErrorCode, httpStatus: number, message: string) {
    super(message);
    this.name = "ImageAssetRetentionError";
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

export interface ImageAssetRetentionRowFailure {
  readonly id: string;
  readonly errorCode: string;
}

export interface ImageAssetRetentionResult {
  readonly runId: string;
  readonly status: string;
  readonly startedAt: string;
  readonly finishedAt: string | null;
  readonly replayed: boolean;
  readonly dryRun: boolean;
  readonly eligibleCount: number;
  readonly purgedCount: number;
  readonly failedCount: number;
  readonly failures: readonly ImageAssetRetentionRowFailure[];
}

export interface ImageAssetRetentionInput {
  readonly ownerUserId: string;
  readonly dryRun: boolean;
  readonly confirmationToken?: string;
  readonly executionIdempotencyKey?: string;
  readonly reason?: string;
  readonly correlationRequestId: string;
  readonly database: ImageAssetRetentionDatabase;
  readonly now: () => Date;
  // Deletes the real S3 object (version-pinned) and confirms it is gone.
  // Never throws for "already gone" -- that is success. Throws only for a
  // genuine failure (the row must then be excluded from the DB purge).
  readonly deleteS3Object: (identity: { bucketAlias: string; key: string; versionId: string }) => Promise<void>;
  // Deletes the real local file. Returns the outcome rather than throwing
  // for "already absent" (idempotent-safe); throws only for a genuine
  // failure.
  readonly deleteLocalFile: (row: { ownerUserId: string; id: string; fileName: string }) => Promise<"deleted" | "already_absent">;
  // Best-effort audit write for the dry-run path only (the execution path
  // writes its own audit entry inside the same DB transaction as the
  // purge, so it is never split from the mutation it documents). Never
  // throws -- a failed audit write must not fail an otherwise-successful
  // dry run.
  readonly writeDryRunAuditEvent: (input: { eligibleCount: number; runId: string }) => Promise<void>;
}

// Exported so callers that construct a real execution request (the
// interactive route, and M37's automation sweep) share the exact same
// literal rather than duplicating a security-relevant constant.
export const IMAGE_ASSET_RETENTION_CONFIRMATION_TOKEN = "CONFIRM_IMAGE_ASSET_RETENTION_EXECUTION";

export async function executeImageAssetRetentionPurge(
  input: ImageAssetRetentionInput,
): Promise<ImageAssetRetentionResult> {
  if (!input.dryRun && input.confirmationToken !== IMAGE_ASSET_RETENTION_CONFIRMATION_TOKEN) {
    throw new ImageAssetRetentionError("CONFIRMATION_REQUIRED", 400, "Explicit confirmation is required to execute retention.");
  }

  const executionIdempotencyKey = sanitizeKey(input.executionIdempotencyKey);
  const idempotencyFingerprint = executionIdempotencyKey
    ? computeFingerprint({ ownerUserId: input.ownerUserId, reason: input.reason })
    : null;

  if (!input.dryRun && executionIdempotencyKey) {
    const existing = await input.database.opsImageAssetRetentionRun.findUnique({
      where: { ownerUserId_executionIdempotencyKey: { ownerUserId: input.ownerUserId, executionIdempotencyKey } },
    });
    if (existing) {
      if (existing.idempotencyFingerprint !== idempotencyFingerprint) {
        throw new ImageAssetRetentionError("IDEMPOTENCY_CONFLICT", 409, "The idempotency key was already used with a different payload.");
      }
      return toResult(existing, true);
    }
  }

  const startedAt = input.now();

  if (input.dryRun) {
    const eligible = await findEligibleRows(input.database, input.ownerUserId, startedAt);
    const runId = randomUUID();
    await input.writeDryRunAuditEvent({ eligibleCount: eligible.length, runId });
    return {
      runId,
      status: "dry_run_completed",
      startedAt: startedAt.toISOString(),
      finishedAt: startedAt.toISOString(),
      replayed: false,
      dryRun: true,
      eligibleCount: eligible.length,
      purgedCount: 0,
      failedCount: 0,
      failures: [],
    };
  }

  // --- Phase 1: real I/O, outside any transaction/lock ---
  const eligible = await findEligibleRows(input.database, input.ownerUserId, startedAt);
  const purgedIds: string[] = [];
  const failures: ImageAssetRetentionRowFailure[] = [];

  for (const row of eligible) {
    try {
      if (row.storageBackend === "s3") {
        if (!row.storageBucketAlias || !row.storageKey || !row.storageVersionId) {
          throw new Error("IMAGE_ASSET_STORAGE_IDENTITY_INCOMPLETE");
        }
        await input.deleteS3Object({
          bucketAlias: row.storageBucketAlias,
          key: row.storageKey,
          versionId: row.storageVersionId,
        });
      } else {
        await input.deleteLocalFile({ ownerUserId: row.ownerUserId, id: row.id, fileName: row.fileName });
      }
      purgedIds.push(row.id);
    } catch (error) {
      failures.push({ id: row.id, errorCode: getSafeErrorCode(error) });
    }
  }

  // --- Phase 2: DB-only, advisory-locked, atomic ---
  try {
    const execution = await input.database.$transaction(async (tx) => {
      const advisoryLockKey = deriveAdvisoryLockKey(input.ownerUserId);
      const acquired = await tx.tryAcquireAdvisoryLock(advisoryLockKey);
      if (!acquired) {
        return { kind: "conflict" as const };
      }

      if (executionIdempotencyKey) {
        const existing = await tx.opsImageAssetRetentionRun.findUnique({
          where: { ownerUserId_executionIdempotencyKey: { ownerUserId: input.ownerUserId, executionIdempotencyKey } },
        });
        if (existing) {
          return { kind: "replay" as const, row: existing };
        }
      }

      const runId = randomUUID();
      const finishedAt = input.now();

      let deletedCount = 0;
      if (purgedIds.length > 0) {
        const deleted = await tx.imageAsset.deleteMany({
          where: { ownerUserId: input.ownerUserId, id: { in: purgedIds }, deletedAt: { not: null }, retentionDeletesAt: { lte: finishedAt } },
        });
        deletedCount = deleted.count;
        if (deletedCount !== purgedIds.length) {
          throw new ImageAssetRetentionError(
            "RETENTION_PARTIAL_DELETE",
            500,
            "Image asset retention purge deleted a different number of rows than expected.",
          );
        }
      }

      const row = await tx.opsImageAssetRetentionRun.create({
        data: {
          id: runId,
          ownerUserId: input.ownerUserId,
          mode: "execution",
          status: "execution_completed",
          reasonAuditSafe: sanitizeReason(input.reason),
          executionIdempotencyKey: executionIdempotencyKey ?? null,
          idempotencyFingerprint,
          advisoryLockKey,
          startedAt,
          finishedAt,
          eligibleCount: eligible.length,
          purgedCount: deletedCount,
          failedCount: failures.length,
        },
      });

      await tx.auditLog.create({
        data: {
          actorUserId: input.ownerUserId,
          action: "ops.image_asset_retention.execution.completed",
          resourceType: "ops",
          resourceId: runId,
          status: "success",
          metadata: {
            correlationRequestId: input.correlationRequestId,
            eligibleCount: eligible.length,
            purgedCount: deletedCount,
            failedCount: failures.length,
          },
        },
      });

      return { kind: "completed" as const, row };
    });

    if (execution.kind === "conflict") {
      throw new ImageAssetRetentionError("RETENTION_CONFLICT", 409, "An image asset retention execution is already running for this owner.");
    }
    if (execution.kind === "replay") {
      return toResult(execution.row, true);
    }
    return { ...toResult(execution.row, false), failures };
  } catch (error) {
    if (error instanceof ImageAssetRetentionError) {
      throw error;
    }
    throw new ImageAssetRetentionError("INTERNAL_ERROR", 500, "Image asset retention execution failed.");
  }
}

// Exported so M37's cross-owner automation sweep (which needs to find
// which owners have ANY eligible row, not full row data) uses the exact
// same eligibility rule as the per-owner purge below -- guaranteed never
// to drift into two subtly different definitions of "eligible."
export function buildImageAssetRetentionEligibilityWhere(now: Date): {
  deletedAt: { not: null };
  retentionDeletesAt: { lte: Date };
  OR: Array<Record<string, unknown>>;
} {
  return {
    deletedAt: { not: null },
    retentionDeletesAt: { lte: now },
    // Deliberately conservative (fail-closed): a legacy-local row
    // (storageBackend null) is eligible unconditionally once its grace
    // period has passed. An S3-backed row is eligible ONLY once it has
    // been correctly transitioned to "delete_pending" -- matching the
    // exact invariant backup creation itself enforces
    // (backup-m15-v2-snapshot-persistence.ts). A row with
    // storageBackend="s3" that is somehow still "available" despite
    // deletedAt being set (a state that should never occur after the
    // M36 DELETE-route fix, but could exist from before it shipped) is
    // NOT touched -- it is an inconsistent state, not an ambiguous
    // identifier to guess at; it is left for manual review rather than
    // auto-corrected.
    OR: [{ storageBackend: null }, { storageBackend: "s3", storageState: "delete_pending" }],
  };
}

async function findEligibleRows(
  database: ImageAssetRetentionDatabase,
  ownerUserId: string,
  now: Date,
): Promise<ImageAssetRetentionEligibleRow[]> {
  return database.imageAsset.findMany({
    where: {
      ownerUserId,
      ...buildImageAssetRetentionEligibilityWhere(now),
    },
    select: {
      id: true,
      ownerUserId: true,
      fileName: true,
      storageBackend: true,
      storageBucketAlias: true,
      storageKey: true,
      storageVersionId: true,
    },
    orderBy: { id: "asc" },
  });
}

function toResult(row: ImageAssetRetentionRunRow, replayed: boolean): ImageAssetRetentionResult {
  return {
    runId: row.id,
    status: row.status,
    startedAt: row.startedAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
    replayed,
    dryRun: row.mode === "dry_run",
    eligibleCount: row.eligibleCount,
    purgedCount: row.purgedCount,
    failedCount: row.failedCount,
    failures: [],
  };
}

function sanitizeKey(value: string | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed ? trimmed.slice(0, 190) : null;
}

function sanitizeReason(value: string | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed ? trimmed.slice(0, 200) : null;
}

function computeFingerprint(input: { ownerUserId: string; reason?: string }): string {
  const canonicalPayload = JSON.stringify({
    ownerUserId: input.ownerUserId,
    mode: "execution",
    reasonNormalized: (input.reason ?? "").trim().normalize("NFC").replace(/\s+/g, " "),
    routeSemanticVersion: "v1",
  });
  return createHash("sha256").update(canonicalPayload, "utf8").digest("hex");
}

function deriveAdvisoryLockKey(ownerUserId: string): string {
  const digest = createHash("sha256").update(`image-asset-retention:${ownerUserId}`, "utf8").digest();
  return digest.readBigInt64BE(0).toString();
}

function getSafeErrorCode(error: unknown): string {
  if (error instanceof Error && error.name) {
    return error.name.slice(0, 80);
  }
  return "IMAGE_ASSET_RETENTION_ROW_FAILED";
}
