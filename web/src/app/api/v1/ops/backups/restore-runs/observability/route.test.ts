import { beforeEach, describe, expect, it, vi } from "vitest";

const cookiesMock = vi.hoisted(() => ({
  cookies: vi.fn(),
}));

vi.mock("next/headers", () => cookiesMock);

vi.mock("@/lib/ops-persistence", () => ({
  resolveOpsSessionUserReadOnly: vi.fn(),
}));

vi.mock("@/lib/backup-v13-restore-observability", () => ({
  OBSERVABILITY_WINDOW_UNSUPPORTED: "BACKUP_RESTORE_OBSERVABILITY_WINDOW_UNSUPPORTED",
  OBSERVABILITY_RECENT_LIMIT_INVALID: "BACKUP_RESTORE_OBSERVABILITY_RECENT_LIMIT_INVALID",
  parseObservabilityQuery: vi.fn(),
  buildRestoreGovernanceObservability: vi.fn(),
}));

import { GET } from "./route";
import {
  buildRestoreGovernanceObservability,
  parseObservabilityQuery,
} from "@/lib/backup-v13-restore-observability";
import { resolveOpsSessionUserReadOnly } from "@/lib/ops-persistence";

describe("restore-runs observability route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(cookiesMock.cookies).mockResolvedValue({
      get: () => ({ value: "session-token" }),
    } as never);
    vi.mocked(resolveOpsSessionUserReadOnly).mockResolvedValue({
      id: "owner-1",
      email: "owner@example.com",
      role: "professional",
      locale: "en",
      createdAt: new Date().toISOString(),
    } as never);
    vi.mocked(parseObservabilityQuery).mockReturnValue({ window: "24h", recentLimit: 10 });
  });

  it("returns 401 when unauthenticated", async () => {
    vi.mocked(resolveOpsSessionUserReadOnly).mockResolvedValue(null);

    const response = await GET(new Request("http://localhost/api/v1/ops/backups/restore-runs/observability"));

    expect(response.status).toBe(401);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({ error: "UNAUTHORIZED" });
  });

  it("returns 400 for unsupported window", async () => {
    vi.mocked(parseObservabilityQuery).mockImplementation(() => {
      throw new Error("BACKUP_RESTORE_OBSERVABILITY_WINDOW_UNSUPPORTED");
    });

    const response = await GET(new Request("http://localhost/api/v1/ops/backups/restore-runs/observability?window=2d"));

    expect(response.status).toBe(400);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({ error: "BACKUP_RESTORE_OBSERVABILITY_WINDOW_UNSUPPORTED" });
  });

  it("returns 400 for invalid recentLimit", async () => {
    vi.mocked(parseObservabilityQuery).mockImplementation(() => {
      throw new Error("BACKUP_RESTORE_OBSERVABILITY_RECENT_LIMIT_INVALID");
    });

    const response = await GET(new Request("http://localhost/api/v1/ops/backups/restore-runs/observability?recentLimit=0"));

    expect(response.status).toBe(400);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({ error: "BACKUP_RESTORE_OBSERVABILITY_RECENT_LIMIT_INVALID" });
  });

  it("returns 200 with observability payload", async () => {
    vi.mocked(buildRestoreGovernanceObservability).mockResolvedValue({
      requestId: "req-1",
      generatedAt: new Date().toISOString(),
      window: "24h",
      bucketSize: "1h",
      currentState: {
        staleRestoreRuns: 0,
        staleMaintenanceRuns: 0,
        staleRetentionRuns: 0,
        activeGovernanceOperations: 0,
      },
      windowMetrics: {
        restore: {
          restoreRunsStarted: 1,
          restoreRunsCompleted: 1,
          restoreRunsFailed: 0,
          restoreRunsIndeterminate: 0,
          restoreSuccessRate: 1,
          restoreP50DurationMs: 100,
          restoreP95DurationMs: 100,
          averageAttemptsUsed: 1,
        },
        maintenance: {
          totalRuns: 0,
          completedRuns: 0,
          failedRuns: 0,
          candidatesScanned: 0,
          candidatesReconciledIndeterminate: 0,
        },
        retention: {
          totalRuns: 0,
          completedRuns: 0,
          failedRuns: 0,
          restoreRunsDeleted: 0,
          maintenanceRunsDeleted: 0,
        },
      },
      failuresByCode: [],
      timeline: [],
      recentFailures: [],
    } as never);

    const response = await GET(new Request("http://localhost/api/v1/ops/backups/restore-runs/observability?window=24h"));

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({ window: "24h" });
  });

  it("returns 500 when observability builder throws", async () => {
    vi.mocked(buildRestoreGovernanceObservability).mockRejectedValue(new Error("boom"));

    const response = await GET(new Request("http://localhost/api/v1/ops/backups/restore-runs/observability?window=24h"));

    expect(response.status).toBe(500);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({ error: "BACKUP_RESTORE_OBSERVABILITY_UNAVAILABLE" });
  });

  it("falls back to uuid for invalid request id header", async () => {
    vi.mocked(buildRestoreGovernanceObservability).mockResolvedValue({
      requestId: "override",
      generatedAt: new Date().toISOString(),
      window: "24h",
      bucketSize: "1h",
      currentState: {
        staleRestoreRuns: 0,
        staleMaintenanceRuns: 0,
        staleRetentionRuns: 0,
        activeGovernanceOperations: 0,
      },
      windowMetrics: {
        restore: {
          restoreRunsStarted: 0,
          restoreRunsCompleted: 0,
          restoreRunsFailed: 0,
          restoreRunsIndeterminate: 0,
          restoreSuccessRate: null,
          restoreP50DurationMs: null,
          restoreP95DurationMs: null,
          averageAttemptsUsed: null,
        },
        maintenance: {
          totalRuns: 0,
          completedRuns: 0,
          failedRuns: 0,
          candidatesScanned: 0,
          candidatesReconciledIndeterminate: 0,
        },
        retention: {
          totalRuns: 0,
          completedRuns: 0,
          failedRuns: 0,
          restoreRunsDeleted: 0,
          maintenanceRunsDeleted: 0,
        },
      },
      failuresByCode: [],
      timeline: [],
      recentFailures: [],
    } as never);

    await GET(
      new Request("http://localhost/api/v1/ops/backups/restore-runs/observability", {
        headers: new Headers({ "x-request-id": "bad id with spaces" }),
      }),
    );

    const call = vi.mocked(buildRestoreGovernanceObservability).mock.calls.at(-1)?.[0];
    expect(call?.requestId).toMatch(/^[0-9a-f-]{36}$/);
  });
});
