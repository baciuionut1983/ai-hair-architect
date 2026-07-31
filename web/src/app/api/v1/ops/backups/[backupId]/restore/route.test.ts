import { beforeEach, describe, expect, it, vi } from "vitest";

import { BackupArtifactError } from "@/lib/backup-v13-artifact";

const cookiesMock = vi.hoisted(() => ({
  cookies: vi.fn(),
}));

vi.mock("next/headers", () => cookiesMock);

vi.mock("@/lib/ops-persistence", () => ({
  resolveOpsSessionUserReadOnly: vi.fn(),
}));

vi.mock("@/lib/backup-v13-restore-execution", () => ({
  executeBackupRestoreForUser: vi.fn(),
}));

vi.mock("@/lib/backup-v13-restore-run-history", () => ({
  executeBackupRestoreWithHistory: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { opsBackupSnapshot: { findFirst: vi.fn() } },
}));

vi.mock("@/lib/backup-m15-v2-restore-execution", async () => {
  const actual = await vi.importActual<typeof import("@/lib/backup-m15-v2-restore-execution")>(
    "@/lib/backup-m15-v2-restore-execution",
  );
  return {
    BackupM15V2RestoreExecutionError: actual.BackupM15V2RestoreExecutionError,
  };
});

vi.mock("@/lib/backup-m15-v2-restore-execution-runtime", async () => {
  const actual = await vi.importActual<typeof import("@/lib/backup-m15-v2-restore-execution-runtime")>(
    "@/lib/backup-m15-v2-restore-execution-runtime",
  );
  return {
    BackupM15V2RestoreExecutionRuntimeError: actual.BackupM15V2RestoreExecutionRuntimeError,
    runBackupM15V2RestoreForUser: vi.fn(),
  };
});

import { POST } from "./route";
import { BackupM15V2RestoreExecutionError } from "@/lib/backup-m15-v2-restore-execution";
import {
  BackupM15V2RestoreExecutionRuntimeError,
  runBackupM15V2RestoreForUser,
} from "@/lib/backup-m15-v2-restore-execution-runtime";
import { executeBackupRestoreWithHistory } from "@/lib/backup-v13-restore-run-history";
import { resolveOpsSessionUserReadOnly } from "@/lib/ops-persistence";
import { prisma } from "@/lib/prisma";

const VALID_PREVIEW_FINGERPRINT = "a".repeat(64);
const VALID_CURRENT_STATE_FINGERPRINT = "b".repeat(64);
const OWNER_ID = "user-1";

describe("restore route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(cookiesMock.cookies).mockResolvedValue({
      get: () => ({ value: "session-token" }),
    } as never);
    vi.mocked(resolveOpsSessionUserReadOnly).mockResolvedValue({
      id: OWNER_ID,
      email: "user@example.com",
      role: "professional",
      locale: "en",
      createdAt: new Date().toISOString(),
    } as never);
    // Default: every pre-existing M13 test below falls through the m15.v2 dispatch
    // branch exactly as it did before WP2H8 introduced the peek.
    vi.mocked(prisma.opsBackupSnapshot.findFirst).mockResolvedValue({ schemaVersion: "m13.v1" } as never);
  });

  it("returns 401 when unauthenticated", async () => {
    vi.mocked(resolveOpsSessionUserReadOnly).mockResolvedValue(null);

    const response = await POST({ json: async () => ({}) } as never, { params: Promise.resolve({ backupId: "backup-1" }) });

    expect(response.status).toBe(401);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(prisma.opsBackupSnapshot.findFirst).not.toHaveBeenCalled();
    expect(runBackupM15V2RestoreForUser).not.toHaveBeenCalled();
  });

  it("rejects unknown fields", async () => {
    const response = await POST({
      json: async () => ({
        previewFingerprint: VALID_PREVIEW_FINGERPRINT,
        currentStateFingerprint: VALID_CURRENT_STATE_FINGERPRINT,
        strategy: "replace_all",
        acknowledgeDataLoss: true,
        extra: true,
      }),
    } as never, { params: Promise.resolve({ backupId: "backup-1" }) });

    expect(response.status).toBe(400);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({ error: "BACKUP_RESTORE_REQUEST_INVALID_FIELD" });
  });

  it("rejects invalid json body", async () => {
    const response = await POST({
      json: async () => {
        throw new Error("bad-json");
      },
    } as never, { params: Promise.resolve({ backupId: "backup-1" }) });

    expect(response.status).toBe(400);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({ error: "BACKUP_RESTORE_REQUEST_INVALID_JSON" });
  });

  it("requires acknowledgeDataLoss to be true", async () => {
    const response = await POST({
      json: async () => ({
        previewFingerprint: VALID_PREVIEW_FINGERPRINT,
        currentStateFingerprint: VALID_CURRENT_STATE_FINGERPRINT,
        strategy: "replace_all",
        acknowledgeDataLoss: false,
      }),
    } as never, { params: Promise.resolve({ backupId: "backup-1" }) });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: "BACKUP_RESTORE_REQUEST_INVALID" });
  });

  it("returns successful restore payload", async () => {
    vi.mocked(executeBackupRestoreWithHistory).mockResolvedValue({
      backupId: "backup-1",
      status: "completed",
      strategy: "replace_all",
      appliedPreviewFingerprint: "preview",
      previousCurrentStateFingerprint: "current",
      backupStateFingerprint: "backup",
      restoredStateFingerprint: "backup",
      deletedCounts: { clients: 1, analyses: 1, imageAssets: 1, imageAnalyses: 1, imageAnalysisReviews: 1 },
      restoredCounts: { clients: 1, analyses: 1, imageAssets: 1, imageAnalyses: 1, imageAnalysisReviews: 1 },
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      warnings: [],
    });

    const response = await POST({
      json: async () => ({
        previewFingerprint: VALID_PREVIEW_FINGERPRINT,
        currentStateFingerprint: VALID_CURRENT_STATE_FINGERPRINT,
        strategy: "replace_all",
        acknowledgeDataLoss: true,
      }),
    } as never, { params: Promise.resolve({ backupId: "backup-1" }) });

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({
      backupId: "backup-1",
      status: "completed",
      restoredStateFingerprint: "backup",
    });
  });

  it("maps restore domain errors", async () => {
    vi.mocked(executeBackupRestoreWithHistory).mockRejectedValue(
      new BackupArtifactError("BACKUP_RESTORE_PREVIEW_FINGERPRINT_STALE", 409, "Preview fingerprint no longer matches current restore conditions."),
    );

    const response = await POST({
      json: async () => ({
        previewFingerprint: VALID_PREVIEW_FINGERPRINT,
        currentStateFingerprint: VALID_CURRENT_STATE_FINGERPRINT,
        strategy: "replace_all",
        acknowledgeDataLoss: true,
      }),
    } as never, { params: Promise.resolve({ backupId: "backup-1" }) });

    expect(response.status).toBe(409);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({ error: "BACKUP_RESTORE_PREVIEW_FINGERPRINT_STALE" });
  });

  it("returns 500 for unexpected failures", async () => {
    vi.mocked(executeBackupRestoreWithHistory).mockRejectedValue(new Error("boom"));

    const response = await POST({
      json: async () => ({
        previewFingerprint: VALID_PREVIEW_FINGERPRINT,
        currentStateFingerprint: VALID_CURRENT_STATE_FINGERPRINT,
        strategy: "replace_all",
        acknowledgeDataLoss: true,
      }),
    } as never, { params: Promise.resolve({ backupId: "backup-1" }) });

    expect(response.status).toBe(500);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({ error: "INTERNAL_ERROR" });
  });

  it("rejects null body", async () => {
    const response = await POST({ json: async () => null } as never, { params: Promise.resolve({ backupId: "backup-1" }) });

    expect(response.status).toBe(400);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({ error: "BACKUP_RESTORE_REQUEST_INVALID_JSON" });
  });

  it("rejects array body", async () => {
    const response = await POST({ json: async () => [] } as never, { params: Promise.resolve({ backupId: "backup-1" }) });

    expect(response.status).toBe(400);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({ error: "BACKUP_RESTORE_REQUEST_INVALID_JSON" });
  });

  it("rejects string body", async () => {
    const response = await POST({ json: async () => "payload" } as never, { params: Promise.resolve({ backupId: "backup-1" }) });

    expect(response.status).toBe(400);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({ error: "BACKUP_RESTORE_REQUEST_INVALID_JSON" });
  });

  it("rejects number body", async () => {
    const response = await POST({ json: async () => 42 } as never, { params: Promise.resolve({ backupId: "backup-1" }) });

    expect(response.status).toBe(400);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({ error: "BACKUP_RESTORE_REQUEST_INVALID_JSON" });
  });

  it("rejects boolean body", async () => {
    const response = await POST({ json: async () => true } as never, { params: Promise.resolve({ backupId: "backup-1" }) });

    expect(response.status).toBe(400);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({ error: "BACKUP_RESTORE_REQUEST_INVALID_JSON" });
  });

  it("rejects empty previewFingerprint", async () => {
    const response = await POST({
      json: async () => ({
        previewFingerprint: "",
        currentStateFingerprint: VALID_CURRENT_STATE_FINGERPRINT,
        strategy: "replace_all",
        acknowledgeDataLoss: true,
      }),
    } as never, { params: Promise.resolve({ backupId: "backup-1" }) });

    expect(response.status).toBe(400);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({ error: "BACKUP_RESTORE_REQUEST_INVALID_FIELD", fields: ["previewFingerprint"] });
  });

  it("rejects empty currentStateFingerprint", async () => {
    const response = await POST({
      json: async () => ({
        previewFingerprint: VALID_PREVIEW_FINGERPRINT,
        currentStateFingerprint: "",
        strategy: "replace_all",
        acknowledgeDataLoss: true,
      }),
    } as never, { params: Promise.resolve({ backupId: "backup-1" }) });

    expect(response.status).toBe(400);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({ error: "BACKUP_RESTORE_REQUEST_INVALID_FIELD", fields: ["currentStateFingerprint"] });
  });

  it("rejects shorter-than-64 fingerprint", async () => {
    const response = await POST({
      json: async () => ({
        previewFingerprint: "a".repeat(63),
        currentStateFingerprint: VALID_CURRENT_STATE_FINGERPRINT,
        strategy: "replace_all",
        acknowledgeDataLoss: true,
      }),
    } as never, { params: Promise.resolve({ backupId: "backup-1" }) });

    expect(response.status).toBe(400);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({ error: "BACKUP_RESTORE_REQUEST_INVALID_FIELD", fields: ["previewFingerprint"] });
  });

  it("rejects longer-than-64 fingerprint", async () => {
    const response = await POST({
      json: async () => ({
        previewFingerprint: "a".repeat(65),
        currentStateFingerprint: VALID_CURRENT_STATE_FINGERPRINT,
        strategy: "replace_all",
        acknowledgeDataLoss: true,
      }),
    } as never, { params: Promise.resolve({ backupId: "backup-1" }) });

    expect(response.status).toBe(400);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({ error: "BACKUP_RESTORE_REQUEST_INVALID_FIELD", fields: ["previewFingerprint"] });
  });

  it("rejects uppercase fingerprint characters", async () => {
    const response = await POST({
      json: async () => ({
        previewFingerprint: "A".repeat(64),
        currentStateFingerprint: VALID_CURRENT_STATE_FINGERPRINT,
        strategy: "replace_all",
        acknowledgeDataLoss: true,
      }),
    } as never, { params: Promise.resolve({ backupId: "backup-1" }) });

    expect(response.status).toBe(400);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({ error: "BACKUP_RESTORE_REQUEST_INVALID_FIELD", fields: ["previewFingerprint"] });
  });

  it("rejects non-hex fingerprint characters", async () => {
    const response = await POST({
      json: async () => ({
        previewFingerprint: `${"a".repeat(63)}g`,
        currentStateFingerprint: VALID_CURRENT_STATE_FINGERPRINT,
        strategy: "replace_all",
        acknowledgeDataLoss: true,
      }),
    } as never, { params: Promise.resolve({ backupId: "backup-1" }) });

    expect(response.status).toBe(400);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({ error: "BACKUP_RESTORE_REQUEST_INVALID_FIELD", fields: ["previewFingerprint"] });
  });

  it("rejects fingerprint with 0x prefix", async () => {
    const response = await POST({
      json: async () => ({
        previewFingerprint: `0x${"a".repeat(62)}`,
        currentStateFingerprint: VALID_CURRENT_STATE_FINGERPRINT,
        strategy: "replace_all",
        acknowledgeDataLoss: true,
      }),
    } as never, { params: Promise.resolve({ backupId: "backup-1" }) });

    expect(response.status).toBe(400);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({ error: "BACKUP_RESTORE_REQUEST_INVALID_FIELD", fields: ["previewFingerprint"] });
  });

  it("rejects fingerprint with leading or trailing spaces", async () => {
    const response = await POST({
      json: async () => ({
        previewFingerprint: ` ${"a".repeat(63)}`,
        currentStateFingerprint: `${"b".repeat(63)} `,
        strategy: "replace_all",
        acknowledgeDataLoss: true,
      }),
    } as never, { params: Promise.resolve({ backupId: "backup-1" }) });

    expect(response.status).toBe(400);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({
      error: "BACKUP_RESTORE_REQUEST_INVALID_FIELD",
      fields: ["previewFingerprint", "currentStateFingerprint"],
    });
  });

  it("accepts valid lowercase 64-char hex fingerprints", async () => {
    vi.mocked(executeBackupRestoreWithHistory).mockResolvedValue({
      backupId: "backup-1",
      status: "completed",
      strategy: "replace_all",
      appliedPreviewFingerprint: VALID_PREVIEW_FINGERPRINT,
      previousCurrentStateFingerprint: VALID_CURRENT_STATE_FINGERPRINT,
      backupStateFingerprint: VALID_PREVIEW_FINGERPRINT,
      restoredStateFingerprint: VALID_PREVIEW_FINGERPRINT,
      deletedCounts: { clients: 1, analyses: 1, imageAssets: 1, imageAnalyses: 1, imageAnalysisReviews: 1 },
      restoredCounts: { clients: 1, analyses: 1, imageAssets: 1, imageAnalyses: 1, imageAnalysisReviews: 1 },
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      warnings: [],
    });

    const response = await POST({
      json: async () => ({
        previewFingerprint: VALID_PREVIEW_FINGERPRINT,
        currentStateFingerprint: VALID_CURRENT_STATE_FINGERPRINT,
        strategy: "replace_all",
        acknowledgeDataLoss: true,
      }),
    } as never, { params: Promise.resolve({ backupId: "backup-1" }) });

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(vi.mocked(executeBackupRestoreWithHistory).mock.calls[0]?.[0]).toMatchObject({
      ownerUserId: "user-1",
      actorUserId: "user-1",
      backupId: "backup-1",
      request: {
        previewFingerprint: VALID_PREVIEW_FINGERPRINT,
        currentStateFingerprint: VALID_CURRENT_STATE_FINGERPRINT,
        strategy: "replace_all",
        acknowledgeDataLoss: true,
      },
    });
  });

  it("falls back to UUID when x-request-id contains invalid characters", async () => {
    vi.mocked(executeBackupRestoreWithHistory).mockResolvedValue({
      backupId: "backup-1",
      status: "completed",
      strategy: "replace_all",
      appliedPreviewFingerprint: VALID_PREVIEW_FINGERPRINT,
      previousCurrentStateFingerprint: VALID_CURRENT_STATE_FINGERPRINT,
      backupStateFingerprint: VALID_PREVIEW_FINGERPRINT,
      restoredStateFingerprint: VALID_PREVIEW_FINGERPRINT,
      deletedCounts: { clients: 1, analyses: 1, imageAssets: 1, imageAnalyses: 1, imageAnalysisReviews: 1 },
      restoredCounts: { clients: 1, analyses: 1, imageAssets: 1, imageAnalyses: 1, imageAnalysisReviews: 1 },
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      warnings: [],
    });

    const response = await POST(
      {
        headers: new Headers({ "x-request-id": "bad request id with spaces" }),
        json: async () => ({
          previewFingerprint: VALID_PREVIEW_FINGERPRINT,
          currentStateFingerprint: VALID_CURRENT_STATE_FINGERPRINT,
          strategy: "replace_all",
          acknowledgeDataLoss: true,
        }),
      } as never,
      { params: Promise.resolve({ backupId: "backup-1" }) },
    );

    expect(response.status).toBe(200);
    const call = vi.mocked(executeBackupRestoreWithHistory).mock.calls.at(-1)?.[0];
    expect(call?.correlationRequestId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("uses sanitized x-request-id when valid", async () => {
    vi.mocked(executeBackupRestoreWithHistory).mockResolvedValue({
      backupId: "backup-1",
      status: "completed",
      strategy: "replace_all",
      appliedPreviewFingerprint: VALID_PREVIEW_FINGERPRINT,
      previousCurrentStateFingerprint: VALID_CURRENT_STATE_FINGERPRINT,
      backupStateFingerprint: VALID_PREVIEW_FINGERPRINT,
      restoredStateFingerprint: VALID_PREVIEW_FINGERPRINT,
      deletedCounts: { clients: 1, analyses: 1, imageAssets: 1, imageAnalyses: 1, imageAnalysisReviews: 1 },
      restoredCounts: { clients: 1, analyses: 1, imageAssets: 1, imageAnalyses: 1, imageAnalysisReviews: 1 },
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      warnings: [],
    });

    const response = await POST(
      {
        headers: new Headers({ "x-request-id": "  req-12345  " }),
        json: async () => ({
          previewFingerprint: VALID_PREVIEW_FINGERPRINT,
          currentStateFingerprint: VALID_CURRENT_STATE_FINGERPRINT,
          strategy: "replace_all",
          acknowledgeDataLoss: true,
        }),
      } as never,
      { params: Promise.resolve({ backupId: "backup-1" }) },
    );

    expect(response.status).toBe(200);
    const call = vi.mocked(executeBackupRestoreWithHistory).mock.calls.at(-1)?.[0];
    expect(call?.correlationRequestId).toBe("req-12345");
  });

  describe("m15.v2 dispatch", () => {
    const M15V2_BODY = {
      previewFingerprint: "c".repeat(64),
      previewedAt: "2026-07-30T10:00:00.000Z",
      strategy: "replace_all",
      acknowledgeDataLoss: true,
      safetyBackupId: "backup-safety-1",
    };

    const SUCCESS_RESULT = {
      backupId: "backup-v2",
      ownerUserId: OWNER_ID,
      status: "completed",
      strategy: "replace_all",
      deletedCounts: { clients: 1, analyses: 0, consultations: 0, imageAssets: 0, imageAnalyses: 0, imageAnalysisReviews: 0 },
      restoredCounts: { clients: 1, analyses: 0, consultations: 0, imageAssets: 0, imageAnalyses: 0, imageAnalysisReviews: 0 },
      startedAt: "2026-07-30T15:00:00.000Z",
      finishedAt: "2026-07-30T15:00:01.000Z",
      attemptsUsed: 1,
    };

    it("dispatches to the new WP2H8 runtime and returns its native result when schemaVersion is m15.v2", async () => {
      vi.mocked(prisma.opsBackupSnapshot.findFirst).mockResolvedValue({ schemaVersion: "m15.v2" } as never);
      vi.mocked(runBackupM15V2RestoreForUser).mockResolvedValue(SUCCESS_RESULT as never);

      const response = await POST({ json: async () => M15V2_BODY } as never, { params: Promise.resolve({ backupId: "backup-v2" }) });

      expect(response.status).toBe(200);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      await expect(response.json()).resolves.toEqual(SUCCESS_RESULT);
      expect(runBackupM15V2RestoreForUser).toHaveBeenCalledWith(OWNER_ID, "backup-v2", M15V2_BODY, { now: expect.any(Function) });
      expect(runBackupM15V2RestoreForUser).toHaveBeenCalledTimes(1);
      expect(executeBackupRestoreWithHistory).not.toHaveBeenCalled();
    });

    it("falls through to the unchanged existing M13 implementation for an unknown schemaVersion", async () => {
      vi.mocked(prisma.opsBackupSnapshot.findFirst).mockResolvedValue({ schemaVersion: "m14.v1" } as never);
      vi.mocked(executeBackupRestoreWithHistory).mockResolvedValue({
        backupId: "backup-1",
        status: "completed",
        strategy: "replace_all",
        appliedPreviewFingerprint: VALID_PREVIEW_FINGERPRINT,
        previousCurrentStateFingerprint: VALID_CURRENT_STATE_FINGERPRINT,
        backupStateFingerprint: VALID_PREVIEW_FINGERPRINT,
        restoredStateFingerprint: VALID_PREVIEW_FINGERPRINT,
        deletedCounts: { clients: 1, analyses: 1, imageAssets: 1, imageAnalyses: 1, imageAnalysisReviews: 1 },
        restoredCounts: { clients: 1, analyses: 1, imageAssets: 1, imageAnalyses: 1, imageAnalysisReviews: 1 },
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        warnings: [],
      });

      const response = await POST({
        json: async () => ({
          previewFingerprint: VALID_PREVIEW_FINGERPRINT,
          currentStateFingerprint: VALID_CURRENT_STATE_FINGERPRINT,
          strategy: "replace_all",
          acknowledgeDataLoss: true,
        }),
      } as never, { params: Promise.resolve({ backupId: "backup-1" }) });

      expect(response.status).toBe(200);
      expect(executeBackupRestoreWithHistory).toHaveBeenCalledTimes(1);
      expect(runBackupM15V2RestoreForUser).not.toHaveBeenCalled();
    });

    it("falls through to the unchanged existing M13 implementation when the snapshot is absent", async () => {
      vi.mocked(prisma.opsBackupSnapshot.findFirst).mockResolvedValue(null);
      vi.mocked(executeBackupRestoreWithHistory).mockRejectedValue(
        new BackupArtifactError("BACKUP_RESTORE_NOT_FOUND", 404, "Backup snapshot not found."),
      );

      const response = await POST({
        json: async () => ({
          previewFingerprint: VALID_PREVIEW_FINGERPRINT,
          currentStateFingerprint: VALID_CURRENT_STATE_FINGERPRINT,
          strategy: "replace_all",
          acknowledgeDataLoss: true,
        }),
      } as never, { params: Promise.resolve({ backupId: "missing" }) });

      expect(response.status).toBe(404);
      expect(runBackupM15V2RestoreForUser).not.toHaveBeenCalled();
    });

    it("reads the snapshot header owner-scoped (another owner's backup is indistinguishable from absent)", async () => {
      vi.mocked(prisma.opsBackupSnapshot.findFirst).mockResolvedValue(null);
      vi.mocked(executeBackupRestoreWithHistory).mockRejectedValue(
        new BackupArtifactError("BACKUP_RESTORE_NOT_FOUND", 404, "Backup snapshot not found."),
      );

      await POST({
        json: async () => ({
          previewFingerprint: VALID_PREVIEW_FINGERPRINT,
          currentStateFingerprint: VALID_CURRENT_STATE_FINGERPRINT,
          strategy: "replace_all",
          acknowledgeDataLoss: true,
        }),
      } as never, { params: Promise.resolve({ backupId: "backup-of-another-owner" }) });

      expect(prisma.opsBackupSnapshot.findFirst).toHaveBeenCalledWith({
        where: { id: "backup-of-another-owner", ownerUserId: OWNER_ID },
        select: { schemaVersion: true },
      });
    });

    it("rejects malformed JSON in the m15.v2 branch with a sanitized REQUEST_INVALID/400, without calling the runtime", async () => {
      vi.mocked(prisma.opsBackupSnapshot.findFirst).mockResolvedValue({ schemaVersion: "m15.v2" } as never);

      const response = await POST({
        json: async () => {
          throw new Error("bad-json");
        },
      } as never, { params: Promise.resolve({ backupId: "backup-v2" }) });

      expect(response.status).toBe(400);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      await expect(response.json()).resolves.toEqual({ error: "REQUEST_INVALID", message: "The restore request is not valid." });
      expect(runBackupM15V2RestoreForUser).not.toHaveBeenCalled();
    });

    it.each([
      ["REQUEST_INVALID", 400],
      ["SNAPSHOT_NOT_FOUND", 404],
      ["SNAPSHOT_SCHEMA_UNSUPPORTED", 400],
      ["SNAPSHOT_PAYLOAD_INVALID", 400],
      ["SNAPSHOT_IDENTITY_MISMATCH", 400],
      ["SNAPSHOT_CHECKSUM_MISMATCH", 400],
      ["PRECHECK_FAILED", 409],
      ["RESTORE_BLOCKED_BY_PREVIEW", 409],
      ["PREVIEW_FINGERPRINT_STALE", 409],
      ["SAFETY_BACKUP_REQUIRED", 409],
      ["SAFETY_BACKUP_INVALID", 409],
      ["SAFETY_BACKUP_STATE_MISMATCH", 409],
      ["CURRENT_STATE_CHANGED", 409],
      ["OWNER_COLLISION", 409],
      ["CONCURRENCY_CONFLICT", 409],
      ["POSTCONDITION_FAILED", 500],
    ] as const)("maps the real WP2H7 code %s to HTTP %i, sanitized, with no extra fields", async (code, expectedStatus) => {
      vi.mocked(prisma.opsBackupSnapshot.findFirst).mockResolvedValue({ schemaVersion: "m15.v2" } as never);
      vi.mocked(runBackupM15V2RestoreForUser).mockRejectedValue(new BackupM15V2RestoreExecutionError(code));

      const response = await POST({ json: async () => M15V2_BODY } as never, { params: Promise.resolve({ backupId: "backup-v2" }) });

      expect(response.status).toBe(expectedStatus);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      const body = await response.json();
      expect(Object.keys(body).sort()).toEqual(["error", "message"]);
      expect(body.error).toBe(code);
      expect(body.message).not.toMatch(/[0-9a-f]{64}/);
      expect(body.message).not.toContain(OWNER_ID);
    });

    it("maps a BackupM15V2RestoreExecutionRuntimeError (DATABASE_NOT_CONFIGURED) to a sanitized 500", async () => {
      vi.mocked(prisma.opsBackupSnapshot.findFirst).mockResolvedValue({ schemaVersion: "m15.v2" } as never);
      vi.mocked(runBackupM15V2RestoreForUser).mockRejectedValue(
        new BackupM15V2RestoreExecutionRuntimeError("DATABASE_NOT_CONFIGURED", 500, "Backup restore requires a configured database."),
      );

      const response = await POST({ json: async () => M15V2_BODY } as never, { params: Promise.resolve({ backupId: "backup-v2" }) });

      expect(response.status).toBe(500);
      const body = await response.json();
      expect(Object.keys(body).sort()).toEqual(["error", "message"]);
      expect(body).toEqual({ error: "DATABASE_NOT_CONFIGURED", message: "Backup restore requires a configured database." });
    });

    it("collapses an unknown/unexpected error in the m15.v2 branch to a generic sanitized 500", async () => {
      vi.mocked(prisma.opsBackupSnapshot.findFirst).mockResolvedValue({ schemaVersion: "m15.v2" } as never);
      vi.mocked(runBackupM15V2RestoreForUser).mockRejectedValue(new Error("unexpected: connection reset by peer at 10.0.0.5"));

      const response = await POST({ json: async () => M15V2_BODY } as never, { params: Promise.resolve({ backupId: "backup-v2" }) });

      expect(response.status).toBe(500);
      const body = await response.json();
      expect(body).toEqual({ error: "INTERNAL_ERROR", message: "Backup restore failed." });
      expect(JSON.stringify(body)).not.toContain("10.0.0.5");
    });

    it("does not leak sensitive identifiers in the success response beyond the documented result shape", async () => {
      vi.mocked(prisma.opsBackupSnapshot.findFirst).mockResolvedValue({ schemaVersion: "m15.v2" } as never);
      vi.mocked(runBackupM15V2RestoreForUser).mockResolvedValue(SUCCESS_RESULT as never);

      const response = await POST({ json: async () => M15V2_BODY } as never, { params: Promise.resolve({ backupId: "backup-v2" }) });
      const body = await response.json();

      expect(Object.keys(body).sort()).toEqual(
        ["attemptsUsed", "backupId", "deletedCounts", "finishedAt", "ownerUserId", "restoredCounts", "startedAt", "status", "strategy"].sort(),
      );
    });

    it("supplies now bound to the frozen system clock at the exact requested instant", async () => {
      const FIXED_INSTANT = "2030-01-02T03:04:05.000Z";
      vi.mocked(prisma.opsBackupSnapshot.findFirst).mockResolvedValue({ schemaVersion: "m15.v2" } as never);
      vi.useFakeTimers();
      vi.setSystemTime(new Date(FIXED_INSTANT));
      try {
        let capturedNow: (() => Date) | undefined;
        vi.mocked(runBackupM15V2RestoreForUser).mockImplementation(async (_owner, _backupId, _request, dependencies) => {
          capturedNow = dependencies.now;
          return SUCCESS_RESULT as never;
        });

        await POST({ json: async () => M15V2_BODY } as never, { params: Promise.resolve({ backupId: "backup-v2" }) });

        expect(capturedNow).toBeDefined();
        expect(capturedNow!().toISOString()).toBe(FIXED_INSTANT);
      } finally {
        vi.useRealTimers();
      }
    });

    it("passes the raw parsed request body straight through without route-level shape validation (validation is the closed WP2H7 core's responsibility)", async () => {
      vi.mocked(prisma.opsBackupSnapshot.findFirst).mockResolvedValue({ schemaVersion: "m15.v2" } as never);
      const oddButSyntacticallyValidBody = { anything: "goes-here-for-the-route" };
      vi.mocked(runBackupM15V2RestoreForUser).mockRejectedValue(new BackupM15V2RestoreExecutionError("REQUEST_INVALID"));

      const response = await POST({ json: async () => oddButSyntacticallyValidBody } as never, { params: Promise.resolve({ backupId: "backup-v2" }) });

      expect(runBackupM15V2RestoreForUser).toHaveBeenCalledWith(OWNER_ID, "backup-v2", oddButSyntacticallyValidBody, { now: expect.any(Function) });
      expect(response.status).toBe(400);
    });
  });
});