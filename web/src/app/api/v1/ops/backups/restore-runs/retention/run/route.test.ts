import { beforeEach, describe, expect, it, vi } from "vitest";

import { BackupArtifactError } from "@/lib/backup-v13-artifact";

const authMock = vi.hoisted(() => ({ authenticateSessionRequest: vi.fn() }));

vi.mock("@/lib/session-request-auth", () => authMock);

vi.mock("@/lib/backup-v13-restore-run-retention", () => ({
  runBackupRestoreRunRetention: vi.fn(),
}));

import { POST } from "./route";
import { runBackupRestoreRunRetention } from "@/lib/backup-v13-restore-run-retention";

const OWNER_A = { id: "owner-1", email: "owner@example.com", role: "professional", locale: "en" };

describe("restore-runs retention route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.authenticateSessionRequest.mockResolvedValue(OWNER_A);
  });

  it("returns 401 without a cookie, never reading persistence", async () => {
    authMock.authenticateSessionRequest.mockResolvedValue(null);

    const response = await POST(new Request("http://localhost/api/v1/ops/backups/restore-runs/retention/run", {
      method: "POST",
      body: JSON.stringify({ mode: "dry_run", policyVersion: "m13f-v1", batchLimit: 500 }),
    }));

    expect(response.status).toBe(401);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(runBackupRestoreRunRetention).not.toHaveBeenCalled();
  });

  it("returns 401 for an unknown or expired session (no in-memory fallback)", async () => {
    authMock.authenticateSessionRequest.mockResolvedValue(null);

    const response = await POST(new Request("http://localhost/api/v1/ops/backups/restore-runs/retention/run", {
      method: "POST",
      body: JSON.stringify({ mode: "dry_run", policyVersion: "m13f-v1", batchLimit: 500 }),
    }));

    expect(response.status).toBe(401);
  });

  it("returns dry-run response", async () => {
    vi.mocked(runBackupRestoreRunRetention).mockResolvedValue({
      mode: "dry_run",
      policyVersion: "m13f-v1",
      batchLimit: 500,
      evaluationTime: "2026-07-23T10:00:00.000Z",
      retentionFingerprint: "a".repeat(64),
      summary: {
        restoreRunCandidatesCount: 2,
        maintenanceRunCandidatesCount: 1,
        totalCandidatesCount: 3,
        eligibleBeyondBatchRestoreRunCount: 0,
        eligibleBeyondBatchMaintenanceRunCount: 0,
        restoreRunIdsSample: ["run-1"],
        maintenanceRunIdsSample: ["maint-1"],
      },
    });

    const response = await POST(new Request("http://localhost/api/v1/ops/backups/restore-runs/retention/run", {
      method: "POST",
      body: JSON.stringify({ mode: "dry_run", policyVersion: "m13f-v1", batchLimit: 500 }),
    }));

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({ mode: "dry_run", policyVersion: "m13f-v1" });
  });

  it("returns execution response", async () => {
    vi.mocked(runBackupRestoreRunRetention).mockResolvedValue({
      mode: "execution",
      runId: "ret-1",
      status: "completed",
      replayed: false,
      policyVersion: "m13f-v1",
      batchLimit: 500,
      evaluationTime: "2026-07-23T10:00:00.000Z",
      retentionFingerprint: "a".repeat(64),
      summary: {
        restoreRunCandidatesCount: 2,
        maintenanceRunCandidatesCount: 1,
        totalCandidatesCount: 3,
        eligibleBeyondBatchRestoreRunCount: 0,
        eligibleBeyondBatchMaintenanceRunCount: 0,
        restoreRunIdsSample: ["run-1", "run-2"],
        maintenanceRunIdsSample: ["maint-1"],
      },
      deletedCounts: {
        restoreRunsDeleted: 2,
        maintenanceRunsDeleted: 1,
      },
    });

    const response = await POST(new Request("http://localhost/api/v1/ops/backups/restore-runs/retention/run", {
      method: "POST",
      body: JSON.stringify({
        mode: "execution",
        policyVersion: "m13f-v1",
        batchLimit: 500,
        evaluationTime: "2026-07-23T10:00:00.000Z",
        retentionFingerprint: "a".repeat(64),
        executionIdempotencyKey: "key-1",
        acknowledgeDeletion: true,
      }),
    }));

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({ mode: "execution", runId: "ret-1" });
  });

  it("returns completed replay response", async () => {
    vi.mocked(runBackupRestoreRunRetention).mockResolvedValue({
      mode: "execution",
      runId: "ret-1",
      status: "completed",
      replayed: true,
      policyVersion: "m13f-v1",
      batchLimit: 500,
      evaluationTime: "2026-07-23T10:00:00.000Z",
      retentionFingerprint: "a".repeat(64),
      summary: {
        restoreRunCandidatesCount: 0,
        maintenanceRunCandidatesCount: 0,
        totalCandidatesCount: 0,
        eligibleBeyondBatchRestoreRunCount: 0,
        eligibleBeyondBatchMaintenanceRunCount: 0,
        restoreRunIdsSample: [],
        maintenanceRunIdsSample: [],
      },
      deletedCounts: {
        restoreRunsDeleted: 0,
        maintenanceRunsDeleted: 0,
      },
    });

    const response = await POST(new Request("http://localhost/api/v1/ops/backups/restore-runs/retention/run", {
      method: "POST",
      body: JSON.stringify({
        mode: "execution",
        policyVersion: "m13f-v1",
        batchLimit: 500,
        evaluationTime: "2026-07-23T10:00:00.000Z",
        retentionFingerprint: "a".repeat(64),
        executionIdempotencyKey: "key-1",
        acknowledgeDeletion: true,
      }),
    }));

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({ replayed: true });
  });

  it("rejects invalid request payloads", async () => {
    const response = await POST(new Request("http://localhost/api/v1/ops/backups/restore-runs/retention/run", {
      method: "POST",
      body: JSON.stringify({ mode: "execution", policyVersion: "m13f-v1", batchLimit: 500 }),
    }));

    expect(response.status).toBe(400);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({ error: "BACKUP_RESTORE_RETENTION_REQUEST_INVALID" });
  });

  it("maps 409 conflicts", async () => {
    const conflictCodes = [
      "BACKUP_RESTORE_RETENTION_LOCK_CONFLICT",
      "BACKUP_RESTORE_RETENTION_FINGERPRINT_MISMATCH",
      "BACKUP_RESTORE_RETENTION_IDEMPOTENCY_RUNNING",
      "BACKUP_RESTORE_RETENTION_IDEMPOTENCY_FAILED_REPLAY",
      "BACKUP_RESTORE_RETENTION_IDEMPOTENCY_KEY_MISMATCH",
    ];

    for (const code of conflictCodes) {
      vi.mocked(runBackupRestoreRunRetention).mockRejectedValueOnce(
        new BackupArtifactError(code, 409, "conflict"),
      );

      const response = await POST(new Request("http://localhost/api/v1/ops/backups/restore-runs/retention/run", {
        method: "POST",
        body: JSON.stringify({
          mode: "execution",
          policyVersion: "m13f-v1",
          batchLimit: 500,
          evaluationTime: "2026-07-23T10:00:00.000Z",
          retentionFingerprint: "a".repeat(64),
          executionIdempotencyKey: "key-1",
          acknowledgeDeletion: true,
        }),
      }));

      expect(response.status).toBe(409);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      await expect(response.json()).resolves.toMatchObject({ error: code });
    }
  });

  it("returns 500 for unexpected failures", async () => {
    vi.mocked(runBackupRestoreRunRetention).mockRejectedValue(new Error("boom"));

    const response = await POST(new Request("http://localhost/api/v1/ops/backups/restore-runs/retention/run", {
      method: "POST",
      body: JSON.stringify({ mode: "dry_run", policyVersion: "m13f-v1", batchLimit: 500 }),
    }));

    expect(response.status).toBe(500);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({ error: "INTERNAL_ERROR" });
  });
});
