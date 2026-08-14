import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import type {
  RestoreGovernanceAlertsResponse,
  RestoreGovernanceAlertCode,
  RestoreGovernanceCurrentStateSnapshot,
  RestoreGovernanceHealthReasonCode,
  RestoreGovernanceHealthResponse,
  RestoreGovernanceObservabilityResponse,
  RestoreGovernanceOperationalAlert,
  RestoreGovernanceRecentFailure,
  RestoreGovernanceTimelineBucket,
  RestoreGovernanceWindow,
} from "@/lib/contracts";

const WINDOW_TO_MS: Record<RestoreGovernanceWindow, number> = {
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
};

const WINDOW_TO_BUCKET_SIZE: Record<RestoreGovernanceWindow, "1h" | "1d"> = {
  "24h": "1h",
  "7d": "1d",
  "30d": "1d",
};

const WINDOW_TO_BUCKET_COUNT: Record<RestoreGovernanceWindow, number> = {
  "24h": 24,
  "7d": 7,
  "30d": 30,
};

const RESTORE_STALE_MS = 15 * 60 * 1000;
const GOVERNANCE_RUNNING_STALE_MS = 30 * 60 * 1000;
const FAILURE_CODE_LIMIT = 10;
const DEFAULT_RECENT_LIMIT = 10;
const MAX_RECENT_LIMIT = 25;

const M13H_ALERT_THRESHOLDS = {
  staleRestoreRunsWarningMin: 1,
  staleRestoreRunsDegradedMin: 3,
  staleGovernanceRunsWarningMin: 1,
  staleGovernanceRunsDegradedMin: 2,
  restoreSuccessRateWarningMaxExclusive: 0.95,
  restoreSuccessRateDegradedMaxExclusive: 0.85,
  indeterminateRatioWarningMinExclusive: 0.1,
  indeterminateRatioDegradedMinExclusive: 0.2,
  recentFailureAttentionWarningMin: 1,
  recentFailureAttentionDegradedMin: 5,
  minimumRestoreSampleSize: 5,
} as const;

export const OBSERVABILITY_WINDOW_UNSUPPORTED = "BACKUP_RESTORE_OBSERVABILITY_WINDOW_UNSUPPORTED";
export const OBSERVABILITY_RECENT_LIMIT_INVALID = "BACKUP_RESTORE_OBSERVABILITY_RECENT_LIMIT_INVALID";
export const RESTORE_GOVERNANCE_ALERTS_WINDOW_UNSUPPORTED = "BACKUP_RESTORE_ALERTS_WINDOW_UNSUPPORTED";

const HEALTH_REASON_ORDER: RestoreGovernanceHealthReasonCode[] = [
  "STALE_MAINTENANCE_RUNS",
  "STALE_RETENTION_RUNS",
  "STALE_RESTORE_RUNS",
  "RECENT_FAILURE_ATTENTION",
];

type DbClient = Prisma.TransactionClient | typeof prisma;

type RestoreStatusCountRow = {
  status: string;
  count: number;
};

type SimpleCountRow = { count: number };

type SumRow = {
  candidatesScanned: number;
  candidatesReconciledIndeterminate: number;
  deletedRestoreRunCount: number;
  deletedMaintenanceRunCount: number;
};

type FailureCodeRow = {
  code: string;
  count: number;
};

type RecentFailureRow = {
  run_type: "restore" | "maintenance" | "retention";
  run_id: string;
  status: "failed" | "indeterminate";
  backup_id: string | null;
  attempt_count: number | null;
  final_error_code: string | null;
  started_at: Date;
  finished_at: Date | null;
  event_at: Date;
};

type TimelineRestoreRow = {
  bucket_start: Date;
  restore_started: number;
  restore_completed: number;
  restore_failed: number;
  restore_indeterminate: number;
};

type TimelineMaintenanceRow = {
  bucket_start: Date;
  maintenance_completed: number;
  maintenance_failed: number;
};

type TimelineRetentionRow = {
  bucket_start: Date;
  retention_completed: number;
  retention_failed: number;
};

type DurationPercentileRow = {
  p50: number | null;
  p95: number | null;
};

type RestoreGovernanceDerivedState = "healthy" | "warning" | "degraded";

type RestoreGovernanceM13GSnapshot = {
  observability: Omit<RestoreGovernanceObservabilityResponse, "requestId" | "generatedAt">;
  health: Omit<RestoreGovernanceHealthResponse, "requestId" | "generatedAt">;
};

function asDate(input: Date): Date {
  return new Date(input.getTime());
}

function parseWindow(window: string | null): RestoreGovernanceWindow {
  if (window === null) {
    return "24h";
  }

  if (window !== "24h" && window !== "7d" && window !== "30d") {
    throw new Error(OBSERVABILITY_WINDOW_UNSUPPORTED);
  }

  return window;
}

function parseRecentLimit(recentLimit: string | null): number {
  if (recentLimit === null) {
    return DEFAULT_RECENT_LIMIT;
  }

  if (!/^[0-9]+$/.test(recentLimit)) {
    throw new Error(OBSERVABILITY_RECENT_LIMIT_INVALID);
  }

  const parsed = Number.parseInt(recentLimit, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_RECENT_LIMIT) {
    throw new Error(OBSERVABILITY_RECENT_LIMIT_INVALID);
  }

  return parsed;
}

function getWindowStart(generatedAt: Date, window: RestoreGovernanceWindow): Date {
  return new Date(generatedAt.getTime() - WINDOW_TO_MS[window]);
}

function getBucketStepMs(window: RestoreGovernanceWindow): number {
  return window === "24h" ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
}

function iso(date: Date | null): string | null {
  return date ? asDate(date).toISOString() : null;
}

function buildTimelineBuckets(
  window: RestoreGovernanceWindow,
  windowStart: Date,
): RestoreGovernanceTimelineBucket[] {
  const step = getBucketStepMs(window);
  const count = WINDOW_TO_BUCKET_COUNT[window];

  const buckets: RestoreGovernanceTimelineBucket[] = [];
  for (let index = 0; index < count; index += 1) {
    const bucketStart = new Date(windowStart.getTime() + index * step);
    buckets.push({
      bucketStart: bucketStart.toISOString(),
      restoreStarted: 0,
      restoreCompleted: 0,
      restoreFailed: 0,
      restoreIndeterminate: 0,
      maintenanceCompleted: 0,
      maintenanceFailed: 0,
      retentionCompleted: 0,
      retentionFailed: 0,
    });
  }

  return buckets;
}

function bucketKey(date: Date): string {
  return asDate(date).toISOString();
}

function deduplicateReasons(reasons: RestoreGovernanceHealthReasonCode[]): RestoreGovernanceHealthReasonCode[] {
  const set = new Set(reasons);
  return HEALTH_REASON_ORDER.filter((reason) => set.has(reason)).slice(0, 4);
}

async function getCurrentState(tx: DbClient, ownerUserId: string, generatedAt: Date): Promise<RestoreGovernanceCurrentStateSnapshot> {
  const restoreThreshold = new Date(generatedAt.getTime() - RESTORE_STALE_MS);
  const governanceThreshold = new Date(generatedAt.getTime() - GOVERNANCE_RUNNING_STALE_MS);

  const rows = await tx.$queryRaw<Array<{
    stale_restore_runs: number;
    stale_maintenance_runs: number;
    stale_retention_runs: number;
    active_restore_runs: number;
    active_maintenance_runs: number;
    active_retention_runs: number;
  }>>(Prisma.sql`
    SELECT
      (
        SELECT COUNT(*)::int
        FROM "OpsBackupRestoreRun"
        WHERE "ownerUserId" = CAST(${ownerUserId} AS uuid)
          AND status::text = 'started'
          AND "finishedAt" IS NULL
          AND "startedAt" <= ${restoreThreshold}
      ) AS stale_restore_runs,
      (
        SELECT COUNT(*)::int
        FROM "OpsBackupRestoreMaintenanceRun"
        WHERE "ownerUserId" = CAST(${ownerUserId} AS uuid)
          AND status::text = 'running'
          AND "finishedAt" IS NULL
          AND "startedAt" <= ${governanceThreshold}
      ) AS stale_maintenance_runs,
      (
        SELECT COUNT(*)::int
        FROM "OpsBackupRestoreRetentionRun"
        WHERE "ownerUserId" = CAST(${ownerUserId} AS uuid)
          AND status::text = 'running'
          AND "finishedAt" IS NULL
          AND "startedAt" <= ${governanceThreshold}
      ) AS stale_retention_runs,
      (
        SELECT COUNT(*)::int
        FROM "OpsBackupRestoreRun"
        WHERE "ownerUserId" = CAST(${ownerUserId} AS uuid)
          AND status::text = 'started'
          AND "finishedAt" IS NULL
      ) AS active_restore_runs,
      (
        SELECT COUNT(*)::int
        FROM "OpsBackupRestoreMaintenanceRun"
        WHERE "ownerUserId" = CAST(${ownerUserId} AS uuid)
          AND status::text = 'running'
          AND "finishedAt" IS NULL
      ) AS active_maintenance_runs,
      (
        SELECT COUNT(*)::int
        FROM "OpsBackupRestoreRetentionRun"
        WHERE "ownerUserId" = CAST(${ownerUserId} AS uuid)
          AND status::text = 'running'
          AND "finishedAt" IS NULL
      ) AS active_retention_runs
  `);

  const row = rows[0] ?? {
    stale_restore_runs: 0,
    stale_maintenance_runs: 0,
    stale_retention_runs: 0,
    active_restore_runs: 0,
    active_maintenance_runs: 0,
    active_retention_runs: 0,
  };

  return {
    staleRestoreRuns: row.stale_restore_runs,
    staleMaintenanceRuns: row.stale_maintenance_runs,
    staleRetentionRuns: row.stale_retention_runs,
    activeGovernanceOperations: row.active_restore_runs + row.active_maintenance_runs + row.active_retention_runs,
  };
}

async function getRestoreStartedCount(tx: DbClient, ownerUserId: string, windowStart: Date, generatedAt: Date): Promise<number> {
  const rows = await tx.$queryRaw<SimpleCountRow[]>(Prisma.sql`
    SELECT COUNT(*)::int AS count
    FROM "OpsBackupRestoreRun"
    WHERE "ownerUserId" = CAST(${ownerUserId} AS uuid)
      AND "startedAt" >= ${windowStart}
      AND "startedAt" < ${generatedAt}
  `);

  return rows[0]?.count ?? 0;
}

async function getRestoreTerminalCounts(tx: DbClient, ownerUserId: string, windowStart: Date, generatedAt: Date): Promise<RestoreStatusCountRow[]> {
  const rows = await tx.$queryRaw<RestoreStatusCountRow[]>(Prisma.sql`
    SELECT status::text AS status, COUNT(*)::int AS count
    FROM "OpsBackupRestoreRun"
    WHERE "ownerUserId" = CAST(${ownerUserId} AS uuid)
      AND "finishedAt" IS NOT NULL
      AND "finishedAt" >= ${windowStart}
      AND "finishedAt" < ${generatedAt}
      AND status::text IN ('completed', 'failed', 'indeterminate')
    GROUP BY status
  `);

  return rows;
}

async function getMaintenanceWindowCounts(tx: DbClient, ownerUserId: string, windowStart: Date, generatedAt: Date): Promise<{ totalRuns: number; completedRuns: number; failedRuns: number }> {
  const rows = await tx.$queryRaw<Array<{ total_runs: number; completed_runs: number; failed_runs: number }>>(Prisma.sql`
    SELECT
      (
        SELECT COUNT(*)::int
        FROM "OpsBackupRestoreMaintenanceRun"
        WHERE "ownerUserId" = CAST(${ownerUserId} AS uuid)
          AND "startedAt" >= ${windowStart}
          AND "startedAt" < ${generatedAt}
      ) AS total_runs,
      (
        SELECT COUNT(*)::int
        FROM "OpsBackupRestoreMaintenanceRun"
        WHERE "ownerUserId" = CAST(${ownerUserId} AS uuid)
          AND status::text = 'completed'
          AND "finishedAt" IS NOT NULL
          AND "finishedAt" >= ${windowStart}
          AND "finishedAt" < ${generatedAt}
      ) AS completed_runs,
      (
        SELECT COUNT(*)::int
        FROM "OpsBackupRestoreMaintenanceRun"
        WHERE "ownerUserId" = CAST(${ownerUserId} AS uuid)
          AND status::text = 'failed'
          AND "finishedAt" IS NOT NULL
          AND "finishedAt" >= ${windowStart}
          AND "finishedAt" < ${generatedAt}
      ) AS failed_runs
  `);

  return {
    totalRuns: rows[0]?.total_runs ?? 0,
    completedRuns: rows[0]?.completed_runs ?? 0,
    failedRuns: rows[0]?.failed_runs ?? 0,
  };
}

async function getRetentionWindowCounts(tx: DbClient, ownerUserId: string, windowStart: Date, generatedAt: Date): Promise<{ totalRuns: number; completedRuns: number; failedRuns: number }> {
  const rows = await tx.$queryRaw<Array<{ total_runs: number; completed_runs: number; failed_runs: number }>>(Prisma.sql`
    SELECT
      (
        SELECT COUNT(*)::int
        FROM "OpsBackupRestoreRetentionRun"
        WHERE "ownerUserId" = CAST(${ownerUserId} AS uuid)
          AND "startedAt" >= ${windowStart}
          AND "startedAt" < ${generatedAt}
      ) AS total_runs,
      (
        SELECT COUNT(*)::int
        FROM "OpsBackupRestoreRetentionRun"
        WHERE "ownerUserId" = CAST(${ownerUserId} AS uuid)
          AND status::text = 'completed'
          AND "finishedAt" IS NOT NULL
          AND "finishedAt" >= ${windowStart}
          AND "finishedAt" < ${generatedAt}
      ) AS completed_runs,
      (
        SELECT COUNT(*)::int
        FROM "OpsBackupRestoreRetentionRun"
        WHERE "ownerUserId" = CAST(${ownerUserId} AS uuid)
          AND status::text = 'failed'
          AND "finishedAt" IS NOT NULL
          AND "finishedAt" >= ${windowStart}
          AND "finishedAt" < ${generatedAt}
      ) AS failed_runs
  `);

  return {
    totalRuns: rows[0]?.total_runs ?? 0,
    completedRuns: rows[0]?.completed_runs ?? 0,
    failedRuns: rows[0]?.failed_runs ?? 0,
  };
}

async function getLedgerSums(tx: DbClient, ownerUserId: string, windowStart: Date, generatedAt: Date): Promise<SumRow> {
  const rows = await tx.$queryRaw<SumRow[]>(Prisma.sql`
    SELECT
      COALESCE((
        SELECT SUM("candidatesScanned")::int
        FROM "OpsBackupRestoreMaintenanceRun"
        WHERE "ownerUserId" = CAST(${ownerUserId} AS uuid)
          AND status::text IN ('completed', 'failed')
          AND "finishedAt" IS NOT NULL
          AND "finishedAt" >= ${windowStart}
          AND "finishedAt" < ${generatedAt}
      ), 0)::int AS "candidatesScanned",
      COALESCE((
        SELECT SUM("candidatesReconciledIndeterminate")::int
        FROM "OpsBackupRestoreMaintenanceRun"
        WHERE "ownerUserId" = CAST(${ownerUserId} AS uuid)
          AND status::text IN ('completed', 'failed')
          AND "finishedAt" IS NOT NULL
          AND "finishedAt" >= ${windowStart}
          AND "finishedAt" < ${generatedAt}
      ), 0)::int AS "candidatesReconciledIndeterminate",
      COALESCE((
        SELECT SUM("deletedRestoreRunCount")::int
        FROM "OpsBackupRestoreRetentionRun"
        WHERE "ownerUserId" = CAST(${ownerUserId} AS uuid)
          AND status::text IN ('completed', 'failed')
          AND "finishedAt" IS NOT NULL
          AND "finishedAt" >= ${windowStart}
          AND "finishedAt" < ${generatedAt}
      ), 0)::int AS "deletedRestoreRunCount",
      COALESCE((
        SELECT SUM("deletedMaintenanceRunCount")::int
        FROM "OpsBackupRestoreRetentionRun"
        WHERE "ownerUserId" = CAST(${ownerUserId} AS uuid)
          AND status::text IN ('completed', 'failed')
          AND "finishedAt" IS NOT NULL
          AND "finishedAt" >= ${windowStart}
          AND "finishedAt" < ${generatedAt}
      ), 0)::int AS "deletedMaintenanceRunCount"
  `);

  return rows[0] ?? {
    candidatesScanned: 0,
    candidatesReconciledIndeterminate: 0,
    deletedRestoreRunCount: 0,
    deletedMaintenanceRunCount: 0,
  };
}

async function getRecentFailureAttentionCount24h(tx: DbClient, ownerUserId: string, generatedAt: Date): Promise<number> {
  const trailingStart = new Date(generatedAt.getTime() - 24 * 60 * 60 * 1000);

  const rows = await tx.$queryRaw<SimpleCountRow[]>(Prisma.sql`
    SELECT COUNT(*)::int AS count
    FROM (
      SELECT 1
      FROM "OpsBackupRestoreRun"
      WHERE "ownerUserId" = CAST(${ownerUserId} AS uuid)
        AND "finishedAt" IS NOT NULL
        AND "finishedAt" >= ${trailingStart}
        AND "finishedAt" < ${generatedAt}
        AND status IN ('failed', 'indeterminate')

      UNION ALL

      SELECT 1
      FROM "OpsBackupRestoreMaintenanceRun"
      WHERE "ownerUserId" = CAST(${ownerUserId} AS uuid)
        AND "finishedAt" IS NOT NULL
        AND "finishedAt" >= ${trailingStart}
        AND "finishedAt" < ${generatedAt}
        AND status::text = 'failed'

      UNION ALL

      SELECT 1
      FROM "OpsBackupRestoreRetentionRun"
      WHERE "ownerUserId" = CAST(${ownerUserId} AS uuid)
        AND "finishedAt" IS NOT NULL
        AND "finishedAt" >= ${trailingStart}
        AND "finishedAt" < ${generatedAt}
        AND status::text = 'failed'
    ) failure_events
  `);

  return rows[0]?.count ?? 0;
}

async function getFailureCodes(tx: DbClient, ownerUserId: string, windowStart: Date, generatedAt: Date): Promise<Array<{ code: string; count: number }>> {
  const rows = await tx.$queryRaw<FailureCodeRow[]>(Prisma.sql`
    SELECT code, COUNT(*)::int AS count
    FROM (
      SELECT TRIM("finalErrorCode") AS code
      FROM "OpsBackupRestoreRun"
      WHERE "ownerUserId" = CAST(${ownerUserId} AS uuid)
        AND "finishedAt" IS NOT NULL
        AND "finishedAt" >= ${windowStart}
        AND "finishedAt" < ${generatedAt}
        AND status IN ('failed', 'indeterminate')
        AND "finalErrorCode" IS NOT NULL

      UNION ALL

      SELECT TRIM("finalErrorCode") AS code
      FROM "OpsBackupRestoreMaintenanceRun"
      WHERE "ownerUserId" = CAST(${ownerUserId} AS uuid)
        AND "finishedAt" IS NOT NULL
        AND "finishedAt" >= ${windowStart}
        AND "finishedAt" < ${generatedAt}
        AND status::text = 'failed'
        AND "finalErrorCode" IS NOT NULL

      UNION ALL

      SELECT TRIM("finalErrorCode") AS code
      FROM "OpsBackupRestoreRetentionRun"
      WHERE "ownerUserId" = CAST(${ownerUserId} AS uuid)
        AND "finishedAt" IS NOT NULL
        AND "finishedAt" >= ${windowStart}
        AND "finishedAt" < ${generatedAt}
        AND status::text = 'failed'
        AND "finalErrorCode" IS NOT NULL
    ) combined
    WHERE code <> ''
    GROUP BY code
    ORDER BY COUNT(*) DESC, code ASC
    LIMIT ${FAILURE_CODE_LIMIT}
  `);

  return rows.map((row) => ({ code: row.code, count: row.count }));
}

async function getRecentFailures(
  tx: DbClient,
  ownerUserId: string,
  windowStart: Date,
  generatedAt: Date,
  recentLimit: number,
): Promise<RestoreGovernanceRecentFailure[]> {
  const rows = await tx.$queryRaw<RecentFailureRow[]>(Prisma.sql`
    SELECT *
    FROM (
      SELECT
        'restore'::text AS run_type,
        id::text AS run_id,
        status::text AS status,
        "backupId"::text AS backup_id,
        "attemptCount"::int AS attempt_count,
        "finalErrorCode"::text AS final_error_code,
        "startedAt" AS started_at,
        "finishedAt" AS finished_at,
        COALESCE("finishedAt", "startedAt") AS event_at
      FROM "OpsBackupRestoreRun"
      WHERE "ownerUserId" = CAST(${ownerUserId} AS uuid)
        AND "finishedAt" IS NOT NULL
        AND "finishedAt" >= ${windowStart}
        AND "finishedAt" < ${generatedAt}
        AND status IN ('failed', 'indeterminate')

      UNION ALL

      SELECT
        'maintenance'::text AS run_type,
        id::text AS run_id,
        status::text AS status,
        NULL::text AS backup_id,
        NULL::int AS attempt_count,
        "finalErrorCode"::text AS final_error_code,
        "startedAt" AS started_at,
        "finishedAt" AS finished_at,
        COALESCE("finishedAt", "startedAt") AS event_at
      FROM "OpsBackupRestoreMaintenanceRun"
      WHERE "ownerUserId" = CAST(${ownerUserId} AS uuid)
        AND "finishedAt" IS NOT NULL
        AND "finishedAt" >= ${windowStart}
        AND "finishedAt" < ${generatedAt}
        AND status::text = 'failed'

      UNION ALL

      SELECT
        'retention'::text AS run_type,
        id::text AS run_id,
        status::text AS status,
        NULL::text AS backup_id,
        NULL::int AS attempt_count,
        "finalErrorCode"::text AS final_error_code,
        "startedAt" AS started_at,
        "finishedAt" AS finished_at,
        COALESCE("finishedAt", "startedAt") AS event_at
      FROM "OpsBackupRestoreRetentionRun"
      WHERE "ownerUserId" = CAST(${ownerUserId} AS uuid)
        AND "finishedAt" IS NOT NULL
        AND "finishedAt" >= ${windowStart}
        AND "finishedAt" < ${generatedAt}
        AND status::text = 'failed'
    ) recent
    ORDER BY event_at DESC, run_type ASC, run_id ASC
    LIMIT ${recentLimit}
  `);

  return rows.map((row) => {
    if (row.run_type === "restore") {
      return {
        runType: "restore",
        runId: row.run_id,
        status: row.status,
        backupId: row.backup_id ?? "",
        attemptCount: row.attempt_count ?? 0,
        finalErrorCode: row.final_error_code,
        startedAt: row.started_at.toISOString(),
        finishedAt: iso(row.finished_at),
      } as RestoreGovernanceRecentFailure;
    }

    if (row.run_type === "maintenance") {
      return {
        runType: "maintenance",
        runId: row.run_id,
        status: "failed",
        backupId: null,
        attemptCount: null,
        finalErrorCode: row.final_error_code,
        startedAt: row.started_at.toISOString(),
        finishedAt: iso(row.finished_at),
      } as RestoreGovernanceRecentFailure;
    }

    return {
      runType: "retention",
      runId: row.run_id,
      status: "failed",
      backupId: null,
      attemptCount: null,
      finalErrorCode: row.final_error_code,
      startedAt: row.started_at.toISOString(),
      finishedAt: iso(row.finished_at),
    } as RestoreGovernanceRecentFailure;
  });
}

async function getDurationPercentiles(tx: DbClient, ownerUserId: string, windowStart: Date, generatedAt: Date): Promise<DurationPercentileRow> {
  const rows = await tx.$queryRaw<DurationPercentileRow[]>(Prisma.sql`
    WITH durations AS (
      SELECT
        GREATEST(0, EXTRACT(EPOCH FROM ("finishedAt" - "startedAt")) * 1000)::bigint AS duration_ms
      FROM "OpsBackupRestoreRun"
      WHERE "ownerUserId" = CAST(${ownerUserId} AS uuid)
        AND status::text = 'completed'
        AND "finishedAt" IS NOT NULL
        AND "finishedAt" >= ${windowStart}
        AND "finishedAt" < ${generatedAt}
    ), ranked AS (
      SELECT
        duration_ms,
        ROW_NUMBER() OVER (ORDER BY duration_ms ASC) AS rn,
        COUNT(*) OVER () AS total
      FROM durations
    ), picks AS (
      SELECT
        (SELECT duration_ms FROM ranked WHERE rn = CEIL(0.50 * total)::int LIMIT 1) AS p50,
        (SELECT duration_ms FROM ranked WHERE rn = CEIL(0.95 * total)::int LIMIT 1) AS p95
      FROM ranked
      LIMIT 1
    )
    SELECT p50, p95 FROM picks
  `);

  if (rows.length === 0) {
    return { p50: null, p95: null };
  }

  // duration_ms is CAST to ::bigint in the query above (deliberately, to
  // avoid ::int overflow on an unusually long-running restore) -- Postgres
  // bigint columns come back from $queryRaw as native JS BigInt, not
  // number, which JSON.stringify/NextResponse.json cannot serialize. A
  // millisecond duration is always vastly below Number.MAX_SAFE_INTEGER
  // (over 285,000 years), so converting here is exact and safe, and keeps
  // every caller (including this route's real JSON response) working with
  // a plain number as the type already promised.
  return {
    p50: rows[0]?.p50 != null ? Number(rows[0].p50) : null,
    p95: rows[0]?.p95 != null ? Number(rows[0].p95) : null,
  };
}

async function getAverageAttempts(tx: DbClient, ownerUserId: string, windowStart: Date, generatedAt: Date): Promise<number | null> {
  const rows = await tx.$queryRaw<Array<{ average_attempts: number | null }>>(Prisma.sql`
    SELECT AVG("attemptCount")::float8 AS average_attempts
    FROM "OpsBackupRestoreRun"
    WHERE "ownerUserId" = CAST(${ownerUserId} AS uuid)
      AND "finishedAt" IS NOT NULL
      AND "finishedAt" >= ${windowStart}
      AND "finishedAt" < ${generatedAt}
      AND status::text IN ('completed', 'failed', 'indeterminate')
  `);

  const value = rows[0]?.average_attempts;
  if (value === null || value === undefined) {
    return null;
  }

  return Math.round(value * 100) / 100;
}

async function getRestoreTimeline(
  tx: DbClient,
  ownerUserId: string,
  window: RestoreGovernanceWindow,
  windowStart: Date,
  generatedAt: Date,
): Promise<TimelineRestoreRow[]> {
  const step = window === "24h" ? Prisma.sql`INTERVAL '1 hour'` : Prisma.sql`INTERVAL '1 day'`;

  const rows = await tx.$queryRaw<TimelineRestoreRow[]>(Prisma.sql`
    WITH buckets AS (
      SELECT generate_series(
        ${windowStart}::timestamp,
        ${new Date(generatedAt.getTime() - getBucketStepMs(window))}::timestamp,
        ${step}
      ) AS bucket_start
    )
    SELECT
      b.bucket_start,
      COALESCE(started.restore_started, 0)::int AS restore_started,
      COALESCE(completed.restore_completed, 0)::int AS restore_completed,
      COALESCE(failed.restore_failed, 0)::int AS restore_failed,
      COALESCE(indeterminate.restore_indeterminate, 0)::int AS restore_indeterminate
    FROM buckets b
    LEFT JOIN (
      SELECT date_trunc(${window === "24h" ? Prisma.sql`'hour'` : Prisma.sql`'day'`}, "startedAt") AS bucket_start, COUNT(*)::int AS restore_started
      FROM "OpsBackupRestoreRun"
      WHERE "ownerUserId" = CAST(${ownerUserId} AS uuid)
        AND "startedAt" >= ${windowStart}
        AND "startedAt" < ${generatedAt}
      GROUP BY 1
    ) started ON started.bucket_start = b.bucket_start
    LEFT JOIN (
      SELECT date_trunc(${window === "24h" ? Prisma.sql`'hour'` : Prisma.sql`'day'`}, "finishedAt") AS bucket_start, COUNT(*)::int AS restore_completed
      FROM "OpsBackupRestoreRun"
      WHERE "ownerUserId" = CAST(${ownerUserId} AS uuid)
        AND status::text = 'completed'
        AND "finishedAt" IS NOT NULL
        AND "finishedAt" >= ${windowStart}
        AND "finishedAt" < ${generatedAt}
      GROUP BY 1
    ) completed ON completed.bucket_start = b.bucket_start
    LEFT JOIN (
      SELECT date_trunc(${window === "24h" ? Prisma.sql`'hour'` : Prisma.sql`'day'`}, "finishedAt") AS bucket_start, COUNT(*)::int AS restore_failed
      FROM "OpsBackupRestoreRun"
      WHERE "ownerUserId" = CAST(${ownerUserId} AS uuid)
        AND status::text = 'failed'
        AND "finishedAt" IS NOT NULL
        AND "finishedAt" >= ${windowStart}
        AND "finishedAt" < ${generatedAt}
      GROUP BY 1
    ) failed ON failed.bucket_start = b.bucket_start
    LEFT JOIN (
      SELECT date_trunc(${window === "24h" ? Prisma.sql`'hour'` : Prisma.sql`'day'`}, "finishedAt") AS bucket_start, COUNT(*)::int AS restore_indeterminate
      FROM "OpsBackupRestoreRun"
      WHERE "ownerUserId" = CAST(${ownerUserId} AS uuid)
        AND status::text = 'indeterminate'
        AND "finishedAt" IS NOT NULL
        AND "finishedAt" >= ${windowStart}
        AND "finishedAt" < ${generatedAt}
      GROUP BY 1
    ) indeterminate ON indeterminate.bucket_start = b.bucket_start
    ORDER BY b.bucket_start ASC
  `);

  return rows;
}

async function getMaintenanceTimeline(
  tx: DbClient,
  ownerUserId: string,
  window: RestoreGovernanceWindow,
  windowStart: Date,
  generatedAt: Date,
): Promise<TimelineMaintenanceRow[]> {
  const step = window === "24h" ? Prisma.sql`INTERVAL '1 hour'` : Prisma.sql`INTERVAL '1 day'`;

  const rows = await tx.$queryRaw<TimelineMaintenanceRow[]>(Prisma.sql`
    WITH buckets AS (
      SELECT generate_series(
        ${windowStart}::timestamp,
        ${new Date(generatedAt.getTime() - getBucketStepMs(window))}::timestamp,
        ${step}
      ) AS bucket_start
    )
    SELECT
      b.bucket_start,
      COALESCE(completed.maintenance_completed, 0)::int AS maintenance_completed,
      COALESCE(failed.maintenance_failed, 0)::int AS maintenance_failed
    FROM buckets b
    LEFT JOIN (
      SELECT date_trunc(${window === "24h" ? Prisma.sql`'hour'` : Prisma.sql`'day'`}, "finishedAt") AS bucket_start, COUNT(*)::int AS maintenance_completed
      FROM "OpsBackupRestoreMaintenanceRun"
      WHERE "ownerUserId" = CAST(${ownerUserId} AS uuid)
        AND status::text = 'completed'
        AND "finishedAt" IS NOT NULL
        AND "finishedAt" >= ${windowStart}
        AND "finishedAt" < ${generatedAt}
      GROUP BY 1
    ) completed ON completed.bucket_start = b.bucket_start
    LEFT JOIN (
      SELECT date_trunc(${window === "24h" ? Prisma.sql`'hour'` : Prisma.sql`'day'`}, "finishedAt") AS bucket_start, COUNT(*)::int AS maintenance_failed
      FROM "OpsBackupRestoreMaintenanceRun"
      WHERE "ownerUserId" = CAST(${ownerUserId} AS uuid)
        AND status::text = 'failed'
        AND "finishedAt" IS NOT NULL
        AND "finishedAt" >= ${windowStart}
        AND "finishedAt" < ${generatedAt}
      GROUP BY 1
    ) failed ON failed.bucket_start = b.bucket_start
    ORDER BY b.bucket_start ASC
  `);

  return rows;
}

async function getRetentionTimeline(
  tx: DbClient,
  ownerUserId: string,
  window: RestoreGovernanceWindow,
  windowStart: Date,
  generatedAt: Date,
): Promise<TimelineRetentionRow[]> {
  const step = window === "24h" ? Prisma.sql`INTERVAL '1 hour'` : Prisma.sql`INTERVAL '1 day'`;

  const rows = await tx.$queryRaw<TimelineRetentionRow[]>(Prisma.sql`
    WITH buckets AS (
      SELECT generate_series(
        ${windowStart}::timestamp,
        ${new Date(generatedAt.getTime() - getBucketStepMs(window))}::timestamp,
        ${step}
      ) AS bucket_start
    )
    SELECT
      b.bucket_start,
      COALESCE(completed.retention_completed, 0)::int AS retention_completed,
      COALESCE(failed.retention_failed, 0)::int AS retention_failed
    FROM buckets b
    LEFT JOIN (
      SELECT date_trunc(${window === "24h" ? Prisma.sql`'hour'` : Prisma.sql`'day'`}, "finishedAt") AS bucket_start, COUNT(*)::int AS retention_completed
      FROM "OpsBackupRestoreRetentionRun"
      WHERE "ownerUserId" = CAST(${ownerUserId} AS uuid)
        AND status::text = 'completed'
        AND "finishedAt" IS NOT NULL
        AND "finishedAt" >= ${windowStart}
        AND "finishedAt" < ${generatedAt}
      GROUP BY 1
    ) completed ON completed.bucket_start = b.bucket_start
    LEFT JOIN (
      SELECT date_trunc(${window === "24h" ? Prisma.sql`'hour'` : Prisma.sql`'day'`}, "finishedAt") AS bucket_start, COUNT(*)::int AS retention_failed
      FROM "OpsBackupRestoreRetentionRun"
      WHERE "ownerUserId" = CAST(${ownerUserId} AS uuid)
        AND status::text = 'failed'
        AND "finishedAt" IS NOT NULL
        AND "finishedAt" >= ${windowStart}
        AND "finishedAt" < ${generatedAt}
      GROUP BY 1
    ) failed ON failed.bucket_start = b.bucket_start
    ORDER BY b.bucket_start ASC
  `);

  return rows;
}

function applyTimelineRows(
  timeline: RestoreGovernanceTimelineBucket[],
  restoreRows: TimelineRestoreRow[],
  maintenanceRows: TimelineMaintenanceRow[],
  retentionRows: TimelineRetentionRow[],
): RestoreGovernanceTimelineBucket[] {
  const byBucket = new Map<string, RestoreGovernanceTimelineBucket>();
  for (const bucket of timeline) {
    byBucket.set(bucket.bucketStart, bucket);
  }

  for (const row of restoreRows) {
    const key = bucketKey(row.bucket_start);
    const target = byBucket.get(key);
    if (!target) {
      continue;
    }

    target.restoreStarted = row.restore_started;
    target.restoreCompleted = row.restore_completed;
    target.restoreFailed = row.restore_failed;
    target.restoreIndeterminate = row.restore_indeterminate;
  }

  for (const row of maintenanceRows) {
    const key = bucketKey(row.bucket_start);
    const target = byBucket.get(key);
    if (!target) {
      continue;
    }

    target.maintenanceCompleted = row.maintenance_completed;
    target.maintenanceFailed = row.maintenance_failed;
  }

  for (const row of retentionRows) {
    const key = bucketKey(row.bucket_start);
    const target = byBucket.get(key);
    if (!target) {
      continue;
    }

    target.retentionCompleted = row.retention_completed;
    target.retentionFailed = row.retention_failed;
  }

  return timeline;
}

function getRestoreTerminalCount(rows: RestoreStatusCountRow[], status: "completed" | "failed" | "indeterminate"): number {
  return rows.find((row) => row.status.toLowerCase() === status)?.count ?? 0;
}

function computeSuccessRate(completed: number, failed: number, indeterminate: number): number | null {
  const denominator = completed + failed + indeterminate;
  if (denominator === 0) {
    return null;
  }

  const value = completed / denominator;
  return Math.round(value * 10000) / 10000;
}

async function aggregateObservability(
  tx: DbClient,
  ownerUserId: string,
  window: RestoreGovernanceWindow,
  generatedAt: Date,
  recentLimit: number,
): Promise<Omit<RestoreGovernanceObservabilityResponse, "requestId" | "generatedAt">> {
  const windowStart = getWindowStart(generatedAt, window);

  const [
    currentState,
    restoreRunsStarted,
    restoreTerminalCounts,
    durationPercentiles,
    averageAttemptsUsed,
    maintenanceCounts,
    retentionCounts,
    ledgerSums,
    failuresByCode,
    recentFailures,
    restoreTimelineRows,
    maintenanceTimelineRows,
    retentionTimelineRows,
  ] = await Promise.all([
    getCurrentState(tx, ownerUserId, generatedAt),
    getRestoreStartedCount(tx, ownerUserId, windowStart, generatedAt),
    getRestoreTerminalCounts(tx, ownerUserId, windowStart, generatedAt),
    getDurationPercentiles(tx, ownerUserId, windowStart, generatedAt),
    getAverageAttempts(tx, ownerUserId, windowStart, generatedAt),
    getMaintenanceWindowCounts(tx, ownerUserId, windowStart, generatedAt),
    getRetentionWindowCounts(tx, ownerUserId, windowStart, generatedAt),
    getLedgerSums(tx, ownerUserId, windowStart, generatedAt),
    getFailureCodes(tx, ownerUserId, windowStart, generatedAt),
    getRecentFailures(tx, ownerUserId, windowStart, generatedAt, recentLimit),
    getRestoreTimeline(tx, ownerUserId, window, windowStart, generatedAt),
    getMaintenanceTimeline(tx, ownerUserId, window, windowStart, generatedAt),
    getRetentionTimeline(tx, ownerUserId, window, windowStart, generatedAt),
  ]);

  const restoreRunsCompleted = getRestoreTerminalCount(restoreTerminalCounts, "completed");
  const restoreRunsFailed = getRestoreTerminalCount(restoreTerminalCounts, "failed");
  const restoreRunsIndeterminate = getRestoreTerminalCount(restoreTerminalCounts, "indeterminate");

  const timeline = applyTimelineRows(
    buildTimelineBuckets(window, windowStart),
    restoreTimelineRows,
    maintenanceTimelineRows,
    retentionTimelineRows,
  );

  return {
    window,
    bucketSize: WINDOW_TO_BUCKET_SIZE[window],
    currentState,
    windowMetrics: {
      restore: {
        restoreRunsStarted,
        restoreRunsCompleted,
        restoreRunsFailed,
        restoreRunsIndeterminate,
        restoreSuccessRate: computeSuccessRate(restoreRunsCompleted, restoreRunsFailed, restoreRunsIndeterminate),
        restoreP50DurationMs: durationPercentiles.p50,
        restoreP95DurationMs: durationPercentiles.p95,
        averageAttemptsUsed,
      },
      maintenance: {
        totalRuns: maintenanceCounts.totalRuns,
        completedRuns: maintenanceCounts.completedRuns,
        failedRuns: maintenanceCounts.failedRuns,
        candidatesScanned: ledgerSums.candidatesScanned,
        candidatesReconciledIndeterminate: ledgerSums.candidatesReconciledIndeterminate,
      },
      retention: {
        totalRuns: retentionCounts.totalRuns,
        completedRuns: retentionCounts.completedRuns,
        failedRuns: retentionCounts.failedRuns,
        restoreRunsDeleted: ledgerSums.deletedRestoreRunCount,
        maintenanceRunsDeleted: ledgerSums.deletedMaintenanceRunCount,
      },
    },
    failuresByCode,
    timeline,
    recentFailures,
  };
}

async function aggregateHealth(
  tx: DbClient,
  ownerUserId: string,
  generatedAt: Date,
): Promise<Omit<RestoreGovernanceHealthResponse, "requestId" | "generatedAt">> {
  const [currentState, recentFailureAttentionCount24h] = await Promise.all([
    getCurrentState(tx, ownerUserId, generatedAt),
    getRecentFailureAttentionCount24h(tx, ownerUserId, generatedAt),
  ]);

  const reasons: RestoreGovernanceHealthReasonCode[] = [];

  if (currentState.staleMaintenanceRuns >= 1) {
    reasons.push("STALE_MAINTENANCE_RUNS");
  }
  if (currentState.staleRetentionRuns >= 1) {
    reasons.push("STALE_RETENTION_RUNS");
  }
  if (currentState.staleRestoreRuns >= 1) {
    reasons.push("STALE_RESTORE_RUNS");
  }
  if (recentFailureAttentionCount24h >= 1) {
    reasons.push("RECENT_FAILURE_ATTENTION");
  }

  const dedupedReasons = deduplicateReasons(reasons);

  const degraded =
    currentState.staleMaintenanceRuns >= 1 ||
    currentState.staleRetentionRuns >= 1 ||
    currentState.staleRestoreRuns >= 2 ||
    recentFailureAttentionCount24h >= 3;

  const warning = !degraded && (
    currentState.staleRestoreRuns === 1 ||
    (recentFailureAttentionCount24h >= 1 && recentFailureAttentionCount24h <= 2)
  );

  const state: RestoreGovernanceHealthResponse["state"] = degraded
    ? "degraded"
    : warning
      ? "warning"
      : "healthy";

  const filteredReasons = state === "healthy"
    ? []
    : dedupedReasons.filter((reason) => {
      if (reason === "STALE_RESTORE_RUNS") {
        return currentState.staleRestoreRuns >= 1;
      }
      if (reason === "RECENT_FAILURE_ATTENTION") {
        return recentFailureAttentionCount24h >= 1;
      }
      if (reason === "STALE_MAINTENANCE_RUNS") {
        return currentState.staleMaintenanceRuns >= 1;
      }

      return currentState.staleRetentionRuns >= 1;
    });

  return {
    state,
    reasons: filteredReasons,
    currentState,
    recentFailureAttentionCount24h,
    thresholds: {
      restoreStartedStaleMinutes: 15,
      maintenanceRunningStaleMinutes: 30,
      retentionRunningStaleMinutes: 30,
      warningFailureAttentionCount24hMin: 1,
      warningFailureAttentionCount24hMax: 2,
      degradedFailureAttentionCount24hMin: 3,
    },
  };
}

export async function buildRestoreGovernanceM13GSnapshotInTransaction(
  tx: DbClient,
  input: {
    ownerUserId: string;
    window: RestoreGovernanceWindow;
    generatedAt: Date;
    recentLimit: number;
  },
): Promise<RestoreGovernanceM13GSnapshot> {
  const [observability, health] = await Promise.all([
    aggregateObservability(tx, input.ownerUserId, input.window, input.generatedAt, input.recentLimit),
    aggregateHealth(tx, input.ownerUserId, input.generatedAt),
  ]);

  return { observability, health };
}

function rankSeverity(severity: "warning" | "degraded"): number {
  return severity === "degraded" ? 2 : 1;
}

function roundRatio(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function resolveAlertState(alerts: RestoreGovernanceOperationalAlert[]): RestoreGovernanceDerivedState {
  if (alerts.some((item) => item.severity === "degraded")) {
    return "degraded";
  }

  if (alerts.length > 0) {
    return "warning";
  }

  return "healthy";
}

function sortAlerts(alerts: RestoreGovernanceOperationalAlert[]): RestoreGovernanceOperationalAlert[] {
  const order: RestoreGovernanceAlertCode[] = [
    "STALE_GOVERNANCE_RUNS",
    "STALE_RESTORE_RUNS",
    "LOW_RESTORE_SUCCESS_RATE",
    "HIGH_INDETERMINATE_RATIO",
    "RECENT_FAILURE_ATTENTION",
  ];

  return [...alerts].sort((left, right) => {
    const severityDelta = rankSeverity(right.severity) - rankSeverity(left.severity);
    if (severityDelta !== 0) {
      return severityDelta;
    }

    return order.indexOf(left.code) - order.indexOf(right.code);
  });
}

function evaluateRestoreGovernanceAlerts(input: {
  generatedAt: Date;
  window: RestoreGovernanceWindow;
  observability: Omit<RestoreGovernanceObservabilityResponse, "requestId" | "generatedAt">;
  health: Omit<RestoreGovernanceHealthResponse, "requestId" | "generatedAt">;
}): { state: RestoreGovernanceDerivedState; alerts: RestoreGovernanceOperationalAlert[] } {
  const evaluatedAt = input.generatedAt.toISOString();
  const alerts: RestoreGovernanceOperationalAlert[] = [];

  const staleRestoreRuns = input.health.currentState.staleRestoreRuns;
  if (staleRestoreRuns >= M13H_ALERT_THRESHOLDS.staleRestoreRunsWarningMin) {
    alerts.push({
      code: "STALE_RESTORE_RUNS",
      severity: staleRestoreRuns >= M13H_ALERT_THRESHOLDS.staleRestoreRunsDegradedMin ? "degraded" : "warning",
      message: "Stale restore runs detected in active governance operations.",
      window: input.window,
      comparator: ">=",
      warningThreshold: M13H_ALERT_THRESHOLDS.staleRestoreRunsWarningMin,
      degradedThreshold: M13H_ALERT_THRESHOLDS.staleRestoreRunsDegradedMin,
      actualValue: staleRestoreRuns,
      sampleSize: staleRestoreRuns,
      minimumSampleSize: null,
      evaluatedAt,
    });
  }

  const staleMaintenanceRuns = input.health.currentState.staleMaintenanceRuns;
  const staleRetentionRuns = input.health.currentState.staleRetentionRuns;
  const totalStaleGovernanceRuns = staleMaintenanceRuns + staleRetentionRuns;
  if (totalStaleGovernanceRuns >= M13H_ALERT_THRESHOLDS.staleGovernanceRunsWarningMin) {
    alerts.push({
      code: "STALE_GOVERNANCE_RUNS",
      severity: totalStaleGovernanceRuns >= M13H_ALERT_THRESHOLDS.staleGovernanceRunsDegradedMin ? "degraded" : "warning",
      message: "Stale maintenance or retention governance runs detected.",
      window: input.window,
      comparator: ">=",
      warningThreshold: M13H_ALERT_THRESHOLDS.staleGovernanceRunsWarningMin,
      degradedThreshold: M13H_ALERT_THRESHOLDS.staleGovernanceRunsDegradedMin,
      actualValue: totalStaleGovernanceRuns,
      sampleSize: totalStaleGovernanceRuns,
      minimumSampleSize: null,
      evaluatedAt,
      evidence: {
        staleMaintenanceRuns,
        staleRetentionRuns,
        totalStaleGovernanceRuns,
      },
    });
  }

  const restoreStarted = input.observability.windowMetrics.restore.restoreRunsStarted;
  const minimumSampleSize = M13H_ALERT_THRESHOLDS.minimumRestoreSampleSize;
  const restoreSuccessRate = input.observability.windowMetrics.restore.restoreSuccessRate;
  if (
    restoreSuccessRate !== null
    && restoreStarted >= minimumSampleSize
    && restoreSuccessRate < M13H_ALERT_THRESHOLDS.restoreSuccessRateWarningMaxExclusive
  ) {
    alerts.push({
      code: "LOW_RESTORE_SUCCESS_RATE",
      severity: restoreSuccessRate < M13H_ALERT_THRESHOLDS.restoreSuccessRateDegradedMaxExclusive ? "degraded" : "warning",
      message: "Restore success rate is below the expected operational target.",
      window: input.window,
      comparator: "<",
      warningThreshold: M13H_ALERT_THRESHOLDS.restoreSuccessRateWarningMaxExclusive,
      degradedThreshold: M13H_ALERT_THRESHOLDS.restoreSuccessRateDegradedMaxExclusive,
      actualValue: roundRatio(restoreSuccessRate),
      sampleSize: restoreStarted,
      minimumSampleSize,
      evaluatedAt,
    });
  }

  const restoreIndeterminate = input.observability.windowMetrics.restore.restoreRunsIndeterminate;
  const indeterminateRatio = restoreStarted === 0 ? null : restoreIndeterminate / restoreStarted;
  if (
    indeterminateRatio !== null
    && restoreStarted >= minimumSampleSize
    && indeterminateRatio > M13H_ALERT_THRESHOLDS.indeterminateRatioWarningMinExclusive
  ) {
    alerts.push({
      code: "HIGH_INDETERMINATE_RATIO",
      severity: indeterminateRatio > M13H_ALERT_THRESHOLDS.indeterminateRatioDegradedMinExclusive ? "degraded" : "warning",
      message: "Indeterminate restore ratio exceeds safe operational bounds.",
      window: input.window,
      comparator: ">",
      warningThreshold: M13H_ALERT_THRESHOLDS.indeterminateRatioWarningMinExclusive,
      degradedThreshold: M13H_ALERT_THRESHOLDS.indeterminateRatioDegradedMinExclusive,
      actualValue: roundRatio(indeterminateRatio),
      sampleSize: restoreStarted,
      minimumSampleSize,
      evaluatedAt,
    });
  }

  const recentFailureAttentionCount24h = input.health.recentFailureAttentionCount24h;
  if (recentFailureAttentionCount24h >= M13H_ALERT_THRESHOLDS.recentFailureAttentionWarningMin) {
    alerts.push({
      code: "RECENT_FAILURE_ATTENTION",
      severity: recentFailureAttentionCount24h >= M13H_ALERT_THRESHOLDS.recentFailureAttentionDegradedMin ? "degraded" : "warning",
      message: "Recent restore-governance failures require operator attention.",
      window: input.window,
      comparator: ">=",
      warningThreshold: M13H_ALERT_THRESHOLDS.recentFailureAttentionWarningMin,
      degradedThreshold: M13H_ALERT_THRESHOLDS.recentFailureAttentionDegradedMin,
      actualValue: recentFailureAttentionCount24h,
      sampleSize: recentFailureAttentionCount24h,
      minimumSampleSize: null,
      evaluatedAt,
    });
  }

  const sortedAlerts = sortAlerts(alerts);
  return {
    state: resolveAlertState(sortedAlerts),
    alerts: sortedAlerts,
  };
}

export function parseObservabilityQuery(searchParams: URLSearchParams): { window: RestoreGovernanceWindow; recentLimit: number } {
  const windowParams = searchParams.getAll("window");
  if (windowParams.length > 1) {
    throw new Error(OBSERVABILITY_WINDOW_UNSUPPORTED);
  }

  const recentLimitParams = searchParams.getAll("recentLimit");
  if (recentLimitParams.length > 1) {
    throw new Error(OBSERVABILITY_RECENT_LIMIT_INVALID);
  }

  const window = parseWindow(windowParams[0] ?? null);
  const recentLimit = parseRecentLimit(recentLimitParams[0] ?? null);

  return { window, recentLimit };
}

export function parseRestoreGovernanceAlertsQuery(searchParams: URLSearchParams): { window: RestoreGovernanceWindow } {
  const windowParams = searchParams.getAll("window");
  if (windowParams.length > 1) {
    throw new Error(RESTORE_GOVERNANCE_ALERTS_WINDOW_UNSUPPORTED);
  }

  try {
    return { window: parseWindow(windowParams[0] ?? null) };
  } catch {
    throw new Error(RESTORE_GOVERNANCE_ALERTS_WINDOW_UNSUPPORTED);
  }
}

export async function buildRestoreGovernanceObservability(input: {
  ownerUserId: string;
  requestId: string;
  window: RestoreGovernanceWindow;
  recentLimit: number;
}): Promise<RestoreGovernanceObservabilityResponse> {
  const generatedAt = new Date();

  const data = await prisma.$transaction(
    async (tx) => aggregateObservability(tx, input.ownerUserId, input.window, generatedAt, input.recentLimit),
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );

  return {
    requestId: input.requestId,
    generatedAt: generatedAt.toISOString(),
    ...data,
  };
}

export async function buildRestoreGovernanceHealth(input: {
  ownerUserId: string;
  requestId: string;
}): Promise<RestoreGovernanceHealthResponse> {
  const generatedAt = new Date();

  const data = await prisma.$transaction(
    async (tx) => aggregateHealth(tx, input.ownerUserId, generatedAt),
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );

  return {
    requestId: input.requestId,
    generatedAt: generatedAt.toISOString(),
    ...data,
  };
}

export async function buildRestoreGovernanceAlerts(input: {
  ownerUserId: string;
  requestId: string;
  window: RestoreGovernanceWindow;
}): Promise<RestoreGovernanceAlertsResponse> {
  const generatedAt = new Date();

  const data = await prisma.$transaction(async (tx) => {
    const m13gSnapshot = await buildRestoreGovernanceM13GSnapshotInTransaction(tx, {
      ownerUserId: input.ownerUserId,
      window: input.window,
      generatedAt,
      recentLimit: DEFAULT_RECENT_LIMIT,
    });

    return evaluateRestoreGovernanceAlerts({
      generatedAt,
      window: input.window,
      observability: m13gSnapshot.observability,
      health: m13gSnapshot.health,
    });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });

  return {
    requestId: input.requestId,
    generatedAt: generatedAt.toISOString(),
    window: input.window,
    state: data.state,
    alerts: data.alerts,
  };
}


