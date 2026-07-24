import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  $transaction: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: prismaMock,
}));

import {
  OBSERVABILITY_RECENT_LIMIT_INVALID,
  OBSERVABILITY_WINDOW_UNSUPPORTED,
  buildRestoreGovernanceHealth,
  buildRestoreGovernanceObservability,
  parseObservabilityQuery,
} from "@/lib/backup-v13-restore-observability";

function getSqlText(input: unknown): string {
  const value = input as { strings?: string[] };
  if (Array.isArray(value?.strings)) {
    return value.strings.join(" ");
  }

  return String(input);
}

type FakeTx = {
  opsBackupRestoreRun: { count: ReturnType<typeof vi.fn> };
  opsBackupRestoreMaintenanceRun: { count: ReturnType<typeof vi.fn> };
  opsBackupRestoreRetentionRun: { count: ReturnType<typeof vi.fn> };
  $queryRaw: ReturnType<typeof vi.fn>;
};

function createTx(overrides?: {
  restoreCount?: number;
  staleRestore?: number;
  staleMaintenance?: number;
  staleRetention?: number;
  activeRestore?: number;
  activeMaintenance?: number;
  activeRetention?: number;
  recentFailure24h?: number;
  durationRows?: Array<{ p50: number | null; p95: number | null }>;
  recentFailures?: Array<Record<string, unknown>>;
}): FakeTx {
  const sequence = {
    restoreCount: overrides?.restoreCount ?? 2,
    staleRestore: overrides?.staleRestore ?? 0,
    staleMaintenance: overrides?.staleMaintenance ?? 0,
    staleRetention: overrides?.staleRetention ?? 0,
    activeRestore: overrides?.activeRestore ?? 1,
    activeMaintenance: overrides?.activeMaintenance ?? 0,
    activeRetention: overrides?.activeRetention ?? 0,
    recentFailure24h: overrides?.recentFailure24h ?? 0,
  };

  const restoreCountFn = vi.fn();
  const maintenanceCountFn = vi.fn();
  const retentionCountFn = vi.fn();

  const queryRaw = vi.fn(async (query: unknown) => {
    const text = getSqlText(query);

    if (text.includes("GROUP BY status")) {
      return [
        { status: "completed", count: 2 },
        { status: "failed", count: 1 },
      ];
    }

    if (text.includes("stale_restore_runs") && text.includes("active_restore_runs")) {
      return [{
        stale_restore_runs: sequence.staleRestore,
        stale_maintenance_runs: sequence.staleMaintenance,
        stale_retention_runs: sequence.staleRetention,
        active_restore_runs: sequence.activeRestore,
        active_maintenance_runs: sequence.activeMaintenance,
        active_retention_runs: sequence.activeRetention,
      }];
    }

    if (text.includes("FROM \"OpsBackupRestoreRun\"") && text.includes("\"startedAt\" >=") && text.includes("COUNT(*)::int AS count")) {
      return [{ count: sequence.restoreCount }];
    }

    if (text.includes("AS total_runs") && text.includes("OpsBackupRestoreMaintenanceRun")) {
      return [{ total_runs: 1, completed_runs: 1, failed_runs: 0 }];
    }

    if (text.includes("AS total_runs") && text.includes("OpsBackupRestoreRetentionRun")) {
      return [{ total_runs: 1, completed_runs: 1, failed_runs: 0 }];
    }

    if (text.includes("AVG(\"attemptCount\")")) {
      return [{ average_attempts: 1.3333 }];
    }

    if (text.includes("SELECT p50, p95 FROM picks")) {
      return overrides?.durationRows ?? [{ p50: 120, p95: 240 }];
    }

    if (text.includes("COUNT(*)::int AS count") && text.includes("failure_events")) {
      return [{ count: sequence.recentFailure24h }];
    }

    if (text.includes("ORDER BY COUNT(*) DESC, code ASC")) {
      return [{ code: "ERR_A", count: 2 }];
    }

    if (text.includes("LIMIT") && text.includes("ORDER BY event_at DESC")) {
      return overrides?.recentFailures ?? [];
    }

    if (text.includes("AS \"candidatesScanned\"")) {
      return [{
        candidatesScanned: 3,
        candidatesReconciledIndeterminate: 2,
        deletedRestoreRunCount: 4,
        deletedMaintenanceRunCount: 1,
      }];
    }

    if (text.includes("restore_started")) {
      return [];
    }

    if (text.includes("maintenance_completed")) {
      return [];
    }

    if (text.includes("retention_completed")) {
      return [];
    }

    return [];
  });

  return {
    opsBackupRestoreRun: { count: restoreCountFn },
    opsBackupRestoreMaintenanceRun: { count: maintenanceCountFn },
    opsBackupRestoreRetentionRun: { count: retentionCountFn },
    $queryRaw: queryRaw,
  };
}

describe("backup-v13-restore-observability", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-24T12:00:00.000Z"));
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("parses defaults when query parameters are missing", () => {
    const parsed = parseObservabilityQuery(new URLSearchParams());
    expect(parsed).toEqual({ window: "24h", recentLimit: 10 });
  });

  it("rejects repeated window params even if equal", () => {
    const params = new URLSearchParams("window=24h&window=24h");
    expect(() => parseObservabilityQuery(params)).toThrow(OBSERVABILITY_WINDOW_UNSUPPORTED);
  });

  it("rejects repeated recentLimit params", () => {
    const params = new URLSearchParams("recentLimit=10&recentLimit=10");
    expect(() => parseObservabilityQuery(params)).toThrow(OBSERVABILITY_RECENT_LIMIT_INVALID);
  });

  it("validates recentLimit with strict digits and bounds", () => {
    expect(() => parseObservabilityQuery(new URLSearchParams("recentLimit=1.0"))).toThrow(OBSERVABILITY_RECENT_LIMIT_INVALID);
    expect(() => parseObservabilityQuery(new URLSearchParams("recentLimit=0"))).toThrow(OBSERVABILITY_RECENT_LIMIT_INVALID);
    expect(() => parseObservabilityQuery(new URLSearchParams("recentLimit=26"))).toThrow(OBSERVABILITY_RECENT_LIMIT_INVALID);
    expect(parseObservabilityQuery(new URLSearchParams("recentLimit=01"))).toMatchObject({ recentLimit: 1 });
  });

  it("builds zero-filled 24h timeline with ascending UTC buckets", async () => {
    const tx = createTx();
    prismaMock.$transaction.mockImplementation(async (callback: (client: unknown) => unknown) => callback(tx));

    const response = await buildRestoreGovernanceObservability({
      ownerUserId: "owner-1",
      requestId: "req-1",
      window: "24h",
      recentLimit: 10,
    });

    expect(response.timeline).toHaveLength(24);
    expect(response.timeline[0]?.bucketStart).toBe("2026-07-23T12:00:00.000Z");
    expect(response.timeline[23]?.bucketStart).toBe("2026-07-24T11:00:00.000Z");
    expect(response.timeline.every((item) => item.restoreStarted === 0)).toBe(true);
  });

  it("uses repeatable-read transaction", async () => {
    const tx = createTx();
    prismaMock.$transaction.mockImplementation(async (callback: (client: unknown) => unknown) => callback(tx));

    await buildRestoreGovernanceObservability({
      ownerUserId: "owner-1",
      requestId: "req-1",
      window: "7d",
      recentLimit: 10,
    });

    const options = prismaMock.$transaction.mock.calls[0]?.[1];
    expect(options).toMatchObject({ isolationLevel: "RepeatableRead" });
  });

  it("computes success rate and average attempts with required rounding", async () => {
    const tx = createTx();
    prismaMock.$transaction.mockImplementation(async (callback: (client: unknown) => unknown) => callback(tx));

    const response = await buildRestoreGovernanceObservability({
      ownerUserId: "owner-1",
      requestId: "req-1",
      window: "24h",
      recentLimit: 10,
    });

    expect(response.windowMetrics.restore.restoreRunsCompleted).toBe(2);
    expect(response.windowMetrics.restore.restoreRunsFailed).toBe(1);
    expect(response.windowMetrics.restore.restoreRunsIndeterminate).toBe(0);
    expect(response.windowMetrics.restore.restoreSuccessRate).toBe(0.6667);
    expect(response.windowMetrics.restore.averageAttemptsUsed).toBe(1.33);
  });

  it("returns null success rate and null attempts when terminal set is empty", async () => {
    const tx = createTx({ durationRows: [{ p50: null, p95: null }] });
    tx.$queryRaw = vi.fn(async (query: unknown) => {
      const text = getSqlText(query);
      if (text.includes("GROUP BY status")) {
        return [];
      }
      if (text.includes("AVG(\"attemptCount\")")) {
        return [{ average_attempts: null }];
      }
      if (text.includes("SELECT p50, p95 FROM picks")) {
        return [];
      }
      if (text.includes("COUNT(*)::int AS count") && text.includes("failure_events")) {
        return [{ count: 0 }];
      }
      if (text.includes("AS \"candidatesScanned\"")) {
        return [{ candidatesScanned: 0, candidatesReconciledIndeterminate: 0, deletedRestoreRunCount: 0, deletedMaintenanceRunCount: 0 }];
      }
      if (text.includes("ORDER BY COUNT(*) DESC, code ASC")) {
        return [];
      }
      return [];
    });

    prismaMock.$transaction.mockImplementation(async (callback: (client: unknown) => unknown) => callback(tx));

    const response = await buildRestoreGovernanceObservability({
      ownerUserId: "owner-1",
      requestId: "req-1",
      window: "24h",
      recentLimit: 10,
    });

    expect(response.windowMetrics.restore.restoreSuccessRate).toBeNull();
    expect(response.windowMetrics.restore.averageAttemptsUsed).toBeNull();
    expect(response.windowMetrics.restore.restoreP50DurationMs).toBeNull();
    expect(response.windowMetrics.restore.restoreP95DurationMs).toBeNull();
  });

  it("contains nearest-rank percentile SQL and excludes percentile_cont", async () => {
    const tx = createTx();
    prismaMock.$transaction.mockImplementation(async (callback: (client: unknown) => unknown) => callback(tx));

    await buildRestoreGovernanceObservability({
      ownerUserId: "owner-1",
      requestId: "req-1",
      window: "24h",
      recentLimit: 10,
    });

    const percentileCall = tx.$queryRaw.mock.calls.find((call) => getSqlText(call[0]).includes("SELECT p50, p95 FROM picks"));
    const sql = getSqlText(percentileCall?.[0]);
    expect(sql).toContain("CEIL(0.50 * total)");
    expect(sql).toContain("CEIL(0.95 * total)");
    expect(sql).not.toContain("percentile_cont");
  });

  it("applies health precedence with degraded before warning", async () => {
    const tx = createTx({ staleMaintenance: 1, recentFailure24h: 2 });
    prismaMock.$transaction.mockImplementation(async (callback: (client: unknown) => unknown) => callback(tx));

    const response = await buildRestoreGovernanceHealth({ ownerUserId: "owner-1", requestId: "req-1" });

    expect(response.state).toBe("degraded");
    expect(response.reasons).toContain("STALE_MAINTENANCE_RUNS");
  });

  it("does not mark warning for valid non-stale active operations only", async () => {
    const tx = createTx({ staleRestore: 0, staleMaintenance: 0, staleRetention: 0, activeRestore: 2, recentFailure24h: 0 });
    prismaMock.$transaction.mockImplementation(async (callback: (client: unknown) => unknown) => callback(tx));

    const response = await buildRestoreGovernanceHealth({ ownerUserId: "owner-1", requestId: "req-1" });

    expect(response.state).toBe("healthy");
    expect(response.reasons).toEqual([]);
  });
});
