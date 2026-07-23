import { beforeEach, describe, expect, it, vi } from "vitest";

import { BackupArtifactError } from "@/lib/backup-v13-artifact";

const cookiesMock = vi.hoisted(() => ({
  cookies: vi.fn(),
}));

vi.mock("next/headers", () => cookiesMock);

vi.mock("@/lib/ops-persistence", () => ({
  resolveOpsSessionUserReadOnly: vi.fn(),
}));

vi.mock("@/lib/backup-v13-restore-run-maintenance", () => ({
  runBackupRestoreRunMaintenance: vi.fn(),
}));

import { POST } from "./route";
import { runBackupRestoreRunMaintenance } from "@/lib/backup-v13-restore-run-maintenance";
import { resolveOpsSessionUserReadOnly } from "@/lib/ops-persistence";

describe("restore-runs maintenance route", () => {
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
  });

  it("returns 401 when unauthenticated", async () => {
    vi.mocked(resolveOpsSessionUserReadOnly).mockResolvedValue(null);

    const response = await POST(new Request("http://localhost/api/v1/ops/backups/restore-runs/maintenance/run", {
      method: "POST",
      body: JSON.stringify({ mode: "dry_run", staleThresholdMinutes: 30 }),
    }));

    expect(response.status).toBe(401);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("returns dry-run response", async () => {
    vi.mocked(runBackupRestoreRunMaintenance).mockResolvedValue({
      mode: "dry_run",
      evaluationTime: "2026-07-23T10:00:00.000Z",
      maintenanceFingerprint: "a".repeat(64),
      summary: { candidateCount: 3, reconciledCount: 3 },
    });

    const response = await POST(new Request("http://localhost/api/v1/ops/backups/restore-runs/maintenance/run", {
      method: "POST",
      body: JSON.stringify({ mode: "dry_run", staleThresholdMinutes: 30 }),
    }));

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({ mode: "dry_run", summary: { candidateCount: 3 } });
  });

  it("returns execution response", async () => {
    vi.mocked(runBackupRestoreRunMaintenance).mockResolvedValue({
      mode: "execution",
      runId: "maint-1",
      status: "completed",
      replayed: false,
      evaluationTime: "2026-07-23T10:00:00.000Z",
      maintenanceFingerprint: "a".repeat(64),
      summary: { candidateCount: 2, reconciledCount: 2 },
    });

    const response = await POST(new Request("http://localhost/api/v1/ops/backups/restore-runs/maintenance/run", {
      method: "POST",
      body: JSON.stringify({
        mode: "execution",
        staleThresholdMinutes: 30,
        evaluationTime: "2026-07-23T10:00:00.000Z",
        maintenanceFingerprint: "a".repeat(64),
        acknowledgeMutation: true,
        executionIdempotencyKey: "key-1",
      }),
    }));

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({ mode: "execution", runId: "maint-1" });
  });

  it("rejects invalid request payloads", async () => {
    const response = await POST(new Request("http://localhost/api/v1/ops/backups/restore-runs/maintenance/run", {
      method: "POST",
      body: JSON.stringify({ mode: "execution", staleThresholdMinutes: 30 }),
    }));

    expect(response.status).toBe(400);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({ error: "BACKUP_RESTORE_MAINTENANCE_REQUEST_INVALID" });
  });

  it("rejects dry-run payload when client sends evaluationTime", async () => {
    const response = await POST(new Request("http://localhost/api/v1/ops/backups/restore-runs/maintenance/run", {
      method: "POST",
      body: JSON.stringify({
        mode: "dry_run",
        staleThresholdMinutes: 30,
        evaluationTime: "2026-07-23T10:00:00.000Z",
      }),
    }));

    expect(response.status).toBe(400);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({ error: "BACKUP_RESTORE_MAINTENANCE_REQUEST_INVALID_FIELD" });
  });

  it("maps domain conflicts", async () => {
    vi.mocked(runBackupRestoreRunMaintenance).mockRejectedValue(
      new BackupArtifactError("BACKUP_RESTORE_MAINTENANCE_LOCK_CONFLICT", 409, "conflict"),
    );

    const response = await POST(new Request("http://localhost/api/v1/ops/backups/restore-runs/maintenance/run", {
      method: "POST",
      body: JSON.stringify({
        mode: "execution",
        staleThresholdMinutes: 30,
        evaluationTime: "2026-07-23T10:00:00.000Z",
        maintenanceFingerprint: "a".repeat(64),
        acknowledgeMutation: true,
        executionIdempotencyKey: "key-1",
      }),
    }));

    expect(response.status).toBe(409);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({ error: "BACKUP_RESTORE_MAINTENANCE_LOCK_CONFLICT" });
  });

  it("maps all 409 conflict classes with no-store", async () => {
    const conflictCodes = [
      "BACKUP_RESTORE_MAINTENANCE_FINGERPRINT_MISMATCH",
      "BACKUP_RESTORE_MAINTENANCE_IDEMPOTENCY_KEY_MISMATCH",
      "BACKUP_RESTORE_MAINTENANCE_IDEMPOTENCY_RUNNING",
      "BACKUP_RESTORE_MAINTENANCE_IDEMPOTENCY_FAILED_REPLAY",
    ];

    for (const code of conflictCodes) {
      vi.mocked(runBackupRestoreRunMaintenance).mockRejectedValueOnce(
        new BackupArtifactError(code, 409, "conflict"),
      );

      const response = await POST(new Request("http://localhost/api/v1/ops/backups/restore-runs/maintenance/run", {
        method: "POST",
        body: JSON.stringify({
          mode: "execution",
          staleThresholdMinutes: 30,
          evaluationTime: "2026-07-23T10:00:00.000Z",
          maintenanceFingerprint: "a".repeat(64),
          acknowledgeMutation: true,
          executionIdempotencyKey: "key-1",
        }),
      }));

      expect(response.status).toBe(409);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      await expect(response.json()).resolves.toMatchObject({ error: code });
    }
  });

  it("returns 500 for unexpected failures", async () => {
    vi.mocked(runBackupRestoreRunMaintenance).mockRejectedValue(new Error("boom"));

    const response = await POST(new Request("http://localhost/api/v1/ops/backups/restore-runs/maintenance/run", {
      method: "POST",
      body: JSON.stringify({ mode: "dry_run", staleThresholdMinutes: 30 }),
    }));

    expect(response.status).toBe(500);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({ error: "INTERNAL_ERROR" });
  });
});