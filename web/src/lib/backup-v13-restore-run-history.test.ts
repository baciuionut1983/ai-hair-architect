import { describe, expect, it, vi, beforeEach } from "vitest";

import { BackupArtifactError } from "@/lib/backup-v13-artifact";

const delegate = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  findMany: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    opsBackupRestoreRun: delegate,
  },
}));

vi.mock("@/lib/backup-v13-restore-execution", () => ({
  executeBackupRestoreInternalForUser: vi.fn(),
}));

import { executeBackupRestoreInternalForUser } from "@/lib/backup-v13-restore-execution";
import { executeBackupRestoreWithHistory, listBackupRestoreRunsForUser } from "./backup-v13-restore-run-history";

const request = {
  previewFingerprint: "a".repeat(64),
  currentStateFingerprint: "b".repeat(64),
  strategy: "replace_all" as const,
  acknowledgeDataLoss: true as const,
};

describe("backup-v13-restore-run-history", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delegate.create.mockResolvedValue({ id: "run-1" });
    delegate.update.mockResolvedValue({});
    delegate.findMany.mockResolvedValue([]);
  });

  it("fails closed when started run cannot be created", async () => {
    delegate.create.mockRejectedValue(new Error("db down"));

    await expect(
      executeBackupRestoreWithHistory({
        ownerUserId: "owner-1",
        actorUserId: "owner-1",
        backupId: "backup-1",
        request,
        correlationRequestId: "req-1",
      }),
    ).rejects.toMatchObject({ code: "BACKUP_RESTORE_HISTORY_UNAVAILABLE", httpStatus: 500 });

    expect(executeBackupRestoreInternalForUser).not.toHaveBeenCalled();
  });

  it("keeps success response when completed update fails", async () => {
    vi.mocked(executeBackupRestoreInternalForUser).mockResolvedValue({
      response: {
        backupId: "backup-1",
        status: "completed",
        strategy: "replace_all",
        appliedPreviewFingerprint: "a".repeat(64),
        previousCurrentStateFingerprint: "b".repeat(64),
        backupStateFingerprint: "c".repeat(64),
        restoredStateFingerprint: "c".repeat(64),
        deletedCounts: { clients: 1, analyses: 0, imageAssets: 0, imageAnalyses: 0, imageAnalysisReviews: 0 },
        restoredCounts: { clients: 1, analyses: 0, imageAssets: 0, imageAnalyses: 0, imageAnalysisReviews: 0 },
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        warnings: [],
      },
      attemptsUsed: 2,
    });
    delegate.update.mockRejectedValueOnce(new Error("cannot update completed"));

    const response = await executeBackupRestoreWithHistory({
      ownerUserId: "owner-1",
      actorUserId: "owner-1",
      backupId: "backup-1",
      request,
      correlationRequestId: "req-1",
    });

    expect(response.status).toBe("completed");
  });

  it("preserves original restore error when failed update also fails", async () => {
    const original = new BackupArtifactError("BACKUP_RESTORE_CONCURRENCY_CONFLICT", 409, "conflict");
    (original as { attemptsUsed?: number }).attemptsUsed = 3;
    vi.mocked(executeBackupRestoreInternalForUser).mockRejectedValue(original);
    delegate.update.mockRejectedValueOnce(new Error("failed write down"));

    await expect(
      executeBackupRestoreWithHistory({
        ownerUserId: "owner-1",
        actorUserId: "owner-1",
        backupId: "backup-1",
        request,
        correlationRequestId: "req-1",
      }),
    ).rejects.toMatchObject({ code: "BACKUP_RESTORE_CONCURRENCY_CONFLICT", httpStatus: 409 });
  });

  it("builds safe history response with prefixes and stale started", async () => {
    const staleDate = new Date(Date.now() - 16 * 60 * 1000);
    delegate.findMany.mockResolvedValue([
      {
        id: "run-1",
        backupId: "backup-1",
        status: "started",
        attemptCount: 1,
        maxAttempts: 3,
        strategy: "replace_all",
        previewFingerprint: "a".repeat(64),
        currentStateFingerprint: "b".repeat(64),
        startedAt: staleDate,
        finishedAt: null,
        finalErrorCode: null,
        deletedClientCount: null,
        deletedAnalysisCount: null,
        deletedImageAssetCount: null,
        deletedImageAnalysisCount: null,
        deletedImageAnalysisReviewCount: null,
        restoredClientCount: null,
        restoredAnalysisCount: null,
        restoredImageAssetCount: null,
        restoredImageAnalysisCount: null,
        restoredImageAnalysisReviewCount: null,
        warningCodes: { warningCodes: ["CURRENT_STATE_HAS_EXTRA_ROWS"] },
      },
    ]);

    const result = await listBackupRestoreRunsForUser({ ownerUserId: "owner-1", limit: 20 });
    expect(result.data).toHaveLength(1);
    expect(result.data[0]?.previewFingerprintPrefix).toBe("a".repeat(12));
    expect(Object.prototype.hasOwnProperty.call(result.data[0] ?? {}, "previewFingerprint")).toBe(false);
    expect(result.data[0]?.isStale).toBe(true);
  });

  it("filters warningCodes allow-list in persisted payload and listed response", async () => {
    const warningInput = [
      "BACKUP_OLDER_THAN_CURRENT_STATE",
      "ARBITRARY_INTERNAL_WARNING",
      "CURRENT_STATE_HAS_EXTRA_ROWS",
      "../../../../secret",
      "",
      "BACKUP_OLDER_THAN_CURRENT_STATE",
    ];

    vi.mocked(executeBackupRestoreInternalForUser).mockResolvedValue({
      response: {
        backupId: "backup-1",
        status: "completed",
        strategy: "replace_all",
        appliedPreviewFingerprint: "a".repeat(64),
        previousCurrentStateFingerprint: "b".repeat(64),
        backupStateFingerprint: "c".repeat(64),
        restoredStateFingerprint: "c".repeat(64),
        deletedCounts: { clients: 1, analyses: 0, imageAssets: 0, imageAnalyses: 0, imageAnalysisReviews: 0 },
        restoredCounts: { clients: 1, analyses: 0, imageAssets: 0, imageAnalyses: 0, imageAnalysisReviews: 0 },
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        warnings: warningInput.map((code) => ({ code, message: `${code} message` })) as never,
      },
      attemptsUsed: 1,
    });

    delegate.findMany.mockResolvedValue([
      {
        id: "run-1",
        backupId: "backup-1",
        status: "completed",
        attemptCount: 1,
        maxAttempts: 3,
        strategy: "replace_all",
        previewFingerprint: "a".repeat(64),
        currentStateFingerprint: "b".repeat(64),
        startedAt: new Date("2026-07-23T10:00:00.000Z"),
        finishedAt: new Date("2026-07-23T10:00:02.000Z"),
        finalErrorCode: null,
        deletedClientCount: 1,
        deletedAnalysisCount: 0,
        deletedImageAssetCount: 0,
        deletedImageAnalysisCount: 0,
        deletedImageAnalysisReviewCount: 0,
        restoredClientCount: 1,
        restoredAnalysisCount: 0,
        restoredImageAssetCount: 0,
        restoredImageAnalysisCount: 0,
        restoredImageAnalysisReviewCount: 0,
        warningCodes: {
          warningCodes: [
            "BACKUP_OLDER_THAN_CURRENT_STATE",
            "ARBITRARY_INTERNAL_WARNING",
            "CURRENT_STATE_HAS_EXTRA_ROWS",
            "../../../../secret",
            "",
            "BACKUP_OLDER_THAN_CURRENT_STATE",
          ],
        },
      },
    ]);

    await executeBackupRestoreWithHistory({
      ownerUserId: "owner-1",
      actorUserId: "owner-1",
      backupId: "backup-1",
      request,
      correlationRequestId: "req-allow-list",
    });

    expect(delegate.update).toHaveBeenCalled();
    const completedUpdateCall = delegate.update.mock.calls[0]?.[0] as { data: { warningCodes?: { warningCodes?: string[] } } };
    const persistedWarningCodes = completedUpdateCall.data.warningCodes?.warningCodes ?? [];

    expect(persistedWarningCodes).toEqual([
      "BACKUP_OLDER_THAN_CURRENT_STATE",
      "CURRENT_STATE_HAS_EXTRA_ROWS",
    ]);
    expect(persistedWarningCodes).not.toContain("ARBITRARY_INTERNAL_WARNING");
    expect(persistedWarningCodes).not.toContain("../../../../secret");
    expect(persistedWarningCodes).not.toContain("");

    const history = await listBackupRestoreRunsForUser({ ownerUserId: "owner-1", limit: 20 });
    const listedWarningCodes = history.data[0]?.warningCodes ?? [];

    expect(listedWarningCodes).toEqual([
      "BACKUP_OLDER_THAN_CURRENT_STATE",
      "CURRENT_STATE_HAS_EXTRA_ROWS",
    ]);
    expect(listedWarningCodes).not.toContain("ARBITRARY_INTERNAL_WARNING");
    expect(listedWarningCodes).not.toContain("../../../../secret");
    expect(listedWarningCodes).not.toContain("");
    expect(listedWarningCodes).toEqual(persistedWarningCodes);

    const occurrences = listedWarningCodes.filter((code) => code === "BACKUP_OLDER_THAN_CURRENT_STATE").length;
    expect(occurrences).toBe(1);
  });

  it("rejects invalid cursor", async () => {
    await expect(
      listBackupRestoreRunsForUser({ ownerUserId: "owner-1", cursor: "%%%" }),
    ).rejects.toMatchObject({ code: "RESTORE_HISTORY_CURSOR_INVALID", httpStatus: 400 });
  });

  it("rejects from >= to", async () => {
    await expect(
      listBackupRestoreRunsForUser({
        ownerUserId: "owner-1",
        from: "2026-07-23T10:00:00.000Z",
        to: "2026-07-23T10:00:00.000Z",
      }),
    ).rejects.toMatchObject({ code: "RESTORE_HISTORY_TIME_RANGE_INVALID", httpStatus: 400 });
  });
});
