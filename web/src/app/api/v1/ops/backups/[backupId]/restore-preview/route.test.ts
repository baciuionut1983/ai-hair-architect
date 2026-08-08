import { beforeEach, describe, expect, it, vi } from "vitest";

import { BackupArtifactError } from "@/lib/backup-v13-artifact";
import { BackupM15V2RestorePreviewRuntimeError } from "@/lib/backup-m15-v2-restore-preview-runtime";

const authMock = vi.hoisted(() => ({ authenticateSessionRequest: vi.fn() }));

vi.mock("@/lib/session-request-auth", () => authMock);

vi.mock("@/lib/backup-restore-preview-runtime", () => ({
  getRuntimeBackupRestorePreviewForUser: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { opsBackupSnapshot: { findFirst: vi.fn() } },
}));

vi.mock("@/lib/backup-m15-v2-restore-preview-runtime", async () => {
  const actual = await vi.importActual<typeof import("@/lib/backup-m15-v2-restore-preview-runtime")>(
    "@/lib/backup-m15-v2-restore-preview-runtime",
  );
  return {
    BackupM15V2RestorePreviewRuntimeError: actual.BackupM15V2RestorePreviewRuntimeError,
    getBackupM15V2RestorePreviewForUser: vi.fn(),
  };
});

import { POST } from "./route";
import { getBackupM15V2RestorePreviewForUser } from "@/lib/backup-m15-v2-restore-preview-runtime";
import { getRuntimeBackupRestorePreviewForUser } from "@/lib/backup-restore-preview-runtime";
import { prisma } from "@/lib/prisma";

const OWNER_ID = "user-1";
const OWNER_A = { id: OWNER_ID, email: "user@example.com", role: "professional", locale: "en" };

describe("restore-preview route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.authenticateSessionRequest.mockResolvedValue(OWNER_A);
    vi.mocked(prisma.opsBackupSnapshot.findFirst).mockResolvedValue({ schemaVersion: "m13.v1" } as never);
  });

  it("returns 401 without a cookie, never reading persistence", async () => {
    authMock.authenticateSessionRequest.mockResolvedValue(null);

    const response = await POST({ json: async () => ({}) } as never, { params: Promise.resolve({ backupId: "backup-1" }) });

    expect(response.status).toBe(401);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(prisma.opsBackupSnapshot.findFirst).not.toHaveBeenCalled();
  });

  it("returns 401 for an unknown or expired session (no in-memory fallback)", async () => {
    authMock.authenticateSessionRequest.mockResolvedValue(null);

    const response = await POST({ json: async () => ({}) } as never, { params: Promise.resolve({ backupId: "backup-1" }) });

    expect(response.status).toBe(401);
  });

  it("rejects non-empty request bodies", async () => {
    const response = await POST({ json: async () => ({ force: true }) } as never, { params: Promise.resolve({ backupId: "backup-1" }) });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: "BACKUP_PREVIEW_REQUEST_INVALID_JSON" });
  });

  it("returns a preview payload on success", async () => {
    vi.mocked(getRuntimeBackupRestorePreviewForUser).mockResolvedValue({
      backupId: "backup-1",
      schemaVersion: "m13.v1",
      eligibleForRestorePlanning: true,
      checksumStatus: "valid",
      artifactValidity: "valid",
      externalReferenceStatus: "none",
      backupStateFingerprint: "a".repeat(64),
      currentStateFingerprint: "b".repeat(64),
      currentClientStateFingerprint: "d".repeat(64),
      previewGeneratedAt: "2026-07-25T20:00:00.000Z",
      previewFingerprint: "c".repeat(64),
      latestBackupUpdatedAt: null,
      latestCurrentUpdatedAt: null,
      impact: {
        clients: { backupCount: 0, currentCount: 0, wouldCreate: 0, wouldReplace: 0, wouldDelete: 0, unchanged: 0, conflictCount: 0 },
        analyses: { backupCount: 0, currentCount: 0, wouldCreate: 0, wouldReplace: 0, wouldDelete: 0, unchanged: 0, conflictCount: 0 },
        imageAssets: { backupCount: 0, currentCount: 0, wouldCreate: 0, wouldReplace: 0, wouldDelete: 0, unchanged: 0, conflictCount: 0 },
        imageAnalyses: { backupCount: 0, currentCount: 0, wouldCreate: 0, wouldReplace: 0, wouldDelete: 0, unchanged: 0, conflictCount: 0 },
        imageAnalysisReviews: { backupCount: 0, currentCount: 0, wouldCreate: 0, wouldReplace: 0, wouldDelete: 0, unchanged: 0, conflictCount: 0 },
      },
      conflicts: [],
      warnings: [],
      blockingReasons: [],
    });

    const response = await POST({ json: async () => ({}) } as never, { params: Promise.resolve({ backupId: "backup-1" }) });

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({
      backupId: "backup-1",
      eligibleForRestorePlanning: true,
    });
  });

  it("returns an M15 preview payload without transport transformation", async () => {
    const preview = {
      backupId: "backup-m15",
      schemaVersion: "m15.v1" as const,
      eligibleForRestorePlanning: false,
      checksumStatus: "valid" as const,
      artifactValidity: "valid" as const,
      externalReferenceStatus: "failed" as const,
      externalReferences: {
        status: "failed" as const,
        code: "storage_unavailable" as const,
        verifiedAt: "2026-07-28T10:00:00.000Z",
        totalReferences: 1,
        verifiedReferences: 0,
        referenceIndex: 0,
        assetId: "asset-1",
      },
      backupStateFingerprint: "a".repeat(64),
      currentStateFingerprint: "b".repeat(64),
      currentClientStateFingerprint: "c".repeat(64),
      previewGeneratedAt: "2026-07-28T10:00:00.000Z",
      previewFingerprint: "d".repeat(64),
      latestBackupUpdatedAt: null,
      latestCurrentUpdatedAt: null,
      impact: {
        clients: { backupCount: 0, currentCount: 0, wouldCreate: 0, wouldReplace: 0, wouldDelete: 0, unchanged: 0, conflictCount: 0 },
        analyses: { backupCount: 0, currentCount: 0, wouldCreate: 0, wouldReplace: 0, wouldDelete: 0, unchanged: 0, conflictCount: 0 },
        consultations: { backupCount: 0, currentCount: 0, wouldCreate: 0, wouldReplace: 0, wouldDelete: 0, unchanged: 0, conflictCount: 0 },
        imageAssets: { backupCount: 1, currentCount: 1, wouldCreate: 0, wouldReplace: 0, wouldDelete: 0, unchanged: 1, conflictCount: 0 },
        imageAnalyses: { backupCount: 0, currentCount: 0, wouldCreate: 0, wouldReplace: 0, wouldDelete: 0, unchanged: 0, conflictCount: 0 },
        imageAnalysisReviews: { backupCount: 0, currentCount: 0, wouldCreate: 0, wouldReplace: 0, wouldDelete: 0, unchanged: 0, conflictCount: 0 },
      },
      conflicts: [],
      warnings: [],
      blockingReasons: [{
        code: "ARTIFACT_INVALID" as const,
        section: "imageAssets" as const,
        recordId: null,
        referenceId: null,
        messageSafe: "External object storage is unavailable.",
      }],
    };
    vi.mocked(getRuntimeBackupRestorePreviewForUser).mockResolvedValue(preview);

    const response = await POST(
      { json: async () => ({}) } as never,
      { params: Promise.resolve({ backupId: "backup-m15" }) },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual(preview);
    expect(getRuntimeBackupRestorePreviewForUser).toHaveBeenCalledWith("user-1", "backup-m15");
  });

  it("maps backup artifact errors to HTTP responses", async () => {
    vi.mocked(getRuntimeBackupRestorePreviewForUser).mockRejectedValue(
      new BackupArtifactError("BACKUP_PREVIEW_UNINTERPRETABLE", 422, "Backup snapshot cannot be interpreted for restore planning."),
    );

    const response = await POST({ json: async () => ({}) } as never, { params: Promise.resolve({ backupId: "backup-1" }) });

    expect(response.status).toBe(422);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({ error: "BACKUP_PREVIEW_UNINTERPRETABLE" });
  });

  describe("m15.v2 dispatch", () => {
    it("dispatches to the WP2H4 runtime and returns its native result when schemaVersion is m15.v2", async () => {
      vi.mocked(prisma.opsBackupSnapshot.findFirst).mockResolvedValue({ schemaVersion: "m15.v2" } as never);
      const result = { ok: true, canRestore: true, previewedAt: "2026-07-30T00:00:00.000Z" };
      vi.mocked(getBackupM15V2RestorePreviewForUser).mockResolvedValue(result as never);

      const response = await POST({ json: async () => ({}) } as never, { params: Promise.resolve({ backupId: "backup-v2" }) });

      expect(response.status).toBe(200);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      await expect(response.json()).resolves.toEqual(result);
      expect(getBackupM15V2RestorePreviewForUser).toHaveBeenCalledWith(OWNER_ID, "backup-v2", { now: expect.any(Function) });
      expect(getRuntimeBackupRestorePreviewForUser).not.toHaveBeenCalled();
    });

    it("falls through to the unchanged existing implementation for an unknown schemaVersion", async () => {
      vi.mocked(prisma.opsBackupSnapshot.findFirst).mockResolvedValue({ schemaVersion: "m14.v1" } as never);
      vi.mocked(getRuntimeBackupRestorePreviewForUser).mockResolvedValue({ backupId: "backup-1" } as never);

      const response = await POST({ json: async () => ({}) } as never, { params: Promise.resolve({ backupId: "backup-1" }) });

      expect(response.status).toBe(200);
      expect(getRuntimeBackupRestorePreviewForUser).toHaveBeenCalledWith(OWNER_ID, "backup-1");
      expect(getBackupM15V2RestorePreviewForUser).not.toHaveBeenCalled();
    });

    it("falls through to the unchanged existing implementation when the snapshot is absent", async () => {
      vi.mocked(prisma.opsBackupSnapshot.findFirst).mockResolvedValue(null);
      vi.mocked(getRuntimeBackupRestorePreviewForUser).mockRejectedValue(
        new BackupArtifactError("BACKUP_NOT_FOUND", 404, "Backup snapshot not found."),
      );

      const response = await POST({ json: async () => ({}) } as never, { params: Promise.resolve({ backupId: "missing" }) });

      expect(response.status).toBe(404);
      expect(getBackupM15V2RestorePreviewForUser).not.toHaveBeenCalled();
    });

    it("reads the snapshot header owner-scoped (a different owner's row is indistinguishable from absent)", async () => {
      vi.mocked(prisma.opsBackupSnapshot.findFirst).mockResolvedValue(null);
      vi.mocked(getRuntimeBackupRestorePreviewForUser).mockRejectedValue(
        new BackupArtifactError("BACKUP_NOT_FOUND", 404, "Backup snapshot not found."),
      );

      await POST({ json: async () => ({}) } as never, { params: Promise.resolve({ backupId: "backup-of-another-owner" }) });

      expect(prisma.opsBackupSnapshot.findFirst).toHaveBeenCalledWith({
        where: { id: "backup-of-another-owner", ownerUserId: OWNER_ID },
        select: { schemaVersion: true },
      });
    });

    it("maps a BackupM15V2RestorePreviewRuntimeError to its HTTP status, sanitized", async () => {
      vi.mocked(prisma.opsBackupSnapshot.findFirst).mockResolvedValue({ schemaVersion: "m15.v2" } as never);
      vi.mocked(getBackupM15V2RestorePreviewForUser).mockRejectedValue(
        new BackupM15V2RestorePreviewRuntimeError("BACKUP_NOT_FOUND", 404, "Backup snapshot not found."),
      );

      const response = await POST({ json: async () => ({}) } as never, { params: Promise.resolve({ backupId: "backup-v2" }) });

      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toMatchObject({ error: "BACKUP_NOT_FOUND" });
    });

    it("relays an identical mocked business result unchanged across repeated calls", async () => {
      // Business determinism check under mocking: given the same persisted state and the
      // same resolver results (here, a fixed mock return value), the route relays the
      // exact same payload. This does NOT exercise the real clock — verifiedAt/previewedAt
      // is intentionally request-time-derived and is covered separately below.
      vi.mocked(prisma.opsBackupSnapshot.findFirst).mockResolvedValue({ schemaVersion: "m15.v2" } as never);
      const result = { ok: true, canRestore: true };
      vi.mocked(getBackupM15V2RestorePreviewForUser).mockResolvedValue(result as never);

      const first = await POST({ json: async () => ({}) } as never, { params: Promise.resolve({ backupId: "backup-v2" }) });
      const second = await POST({ json: async () => ({}) } as never, { params: Promise.resolve({ backupId: "backup-v2" }) });

      await expect(first.json()).resolves.toEqual(await second.json());
    });

    it("supplies dependencies.now bound to the frozen system clock at the exact requested instant", async () => {
      const FIXED_INSTANT = "2030-01-02T03:04:05.000Z";
      vi.mocked(prisma.opsBackupSnapshot.findFirst).mockResolvedValue({ schemaVersion: "m15.v2" } as never);
      vi.useFakeTimers();
      vi.setSystemTime(new Date(FIXED_INSTANT));
      try {
        let capturedDependencies: { now: () => Date } | undefined;
        vi.mocked(getBackupM15V2RestorePreviewForUser).mockImplementation(async (_owner, _backupId, dependencies) => {
          capturedDependencies = dependencies;
          return { ok: true, canRestore: true } as never;
        });

        await POST({ json: async () => ({}) } as never, { params: Promise.resolve({ backupId: "backup-v2" }) });

        expect(capturedDependencies).toBeDefined();
        expect(typeof capturedDependencies!.now).toBe("function");
        const value = capturedDependencies!.now();
        expect(value).toBeInstanceOf(Date);
        expect(value.toISOString()).toBe(FIXED_INSTANT);
      } finally {
        vi.useRealTimers();
      }
    });

    it("changing the frozen time changes only the clock value supplied at the route boundary", async () => {
      const SECOND_INSTANT = "2031-02-03T04:05:06.000Z";
      vi.mocked(prisma.opsBackupSnapshot.findFirst).mockResolvedValue({ schemaVersion: "m15.v2" } as never);
      vi.useFakeTimers();
      vi.setSystemTime(new Date(SECOND_INSTANT));
      try {
        let capturedDependencies: { now: () => Date } | undefined;
        let capturedOwner: string | undefined;
        let capturedBackupId: string | undefined;
        vi.mocked(getBackupM15V2RestorePreviewForUser).mockImplementation(async (owner, backupId, dependencies) => {
          capturedOwner = owner;
          capturedBackupId = backupId;
          capturedDependencies = dependencies;
          return { ok: true, canRestore: true } as never;
        });

        await POST({ json: async () => ({}) } as never, { params: Promise.resolve({ backupId: "backup-v2" }) });

        expect(capturedDependencies!.now().toISOString()).toBe(SECOND_INSTANT);
        // Dispatch and owner-scoped lookup are unaffected by the frozen clock.
        expect(capturedOwner).toBe(OWNER_ID);
        expect(capturedBackupId).toBe("backup-v2");
        expect(prisma.opsBackupSnapshot.findFirst).toHaveBeenCalledWith({
          where: { id: "backup-v2", ownerUserId: OWNER_ID },
          select: { schemaVersion: true },
        });
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
