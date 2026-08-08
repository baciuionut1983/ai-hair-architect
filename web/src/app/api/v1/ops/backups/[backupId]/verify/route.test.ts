import { beforeEach, describe, expect, it, vi } from "vitest";

import { BackupArtifactError } from "@/lib/backup-v13-artifact";
import { BackupM15V2SnapshotPersistenceError } from "@/lib/backup-m15-v2-snapshot-persistence";

const authMock = vi.hoisted(() => ({ authenticateSessionRequest: vi.fn() }));

vi.mock("@/lib/session-request-auth", () => authMock);

vi.mock("@/lib/ops-persistence", () => ({
  verifyBackupSnapshotForUser: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { opsBackupSnapshot: { findFirst: vi.fn() } },
}));

vi.mock("@/lib/backup-m15-v2-snapshot-persistence-runtime", () => ({
  verifyBackupM15V2SnapshotForUser: vi.fn(),
}));

import { GET } from "./route";
import { verifyBackupM15V2SnapshotForUser } from "@/lib/backup-m15-v2-snapshot-persistence-runtime";
import { verifyBackupSnapshotForUser } from "@/lib/ops-persistence";
import { prisma } from "@/lib/prisma";

const OWNER_ID = "user-1";
const OWNER_A = { id: OWNER_ID, email: "u@example.com", role: "professional", locale: "en" };

describe("ops backup verify route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.opsBackupSnapshot.findFirst).mockResolvedValue({ schemaVersion: "m13.v1" } as never);
  });

  it("returns 401 without a cookie, never reading persistence", async () => {
    authMock.authenticateSessionRequest.mockResolvedValue(null);

    const response = await GET({} as Request, { params: Promise.resolve({ backupId: "backup-1" }) });

    expect(response.status).toBe(401);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(prisma.opsBackupSnapshot.findFirst).not.toHaveBeenCalled();
  });

  it("returns 401 for an unknown or expired session (no in-memory fallback)", async () => {
    authMock.authenticateSessionRequest.mockResolvedValue(null);

    const response = await GET({} as Request, { params: Promise.resolve({ backupId: "backup-1" }) });

    expect(response.status).toBe(401);
  });

  it("returns verification payload on success", async () => {
    authMock.authenticateSessionRequest.mockResolvedValue(OWNER_A);

    vi.mocked(verifyBackupSnapshotForUser).mockResolvedValue({
      backupId: "backup-1",
      schemaVersion: "m13.v1",
      checksumStatus: "verified_match",
      artifactValidity: "valid",
      externalReferenceStatus: "not_applicable",
      recoveryArtifactStatus: "verification_ready",
      reason: null,
      verifiedAt: new Date().toISOString(),
    });

    const response = await GET({} as Request, { params: Promise.resolve({ backupId: "backup-1" }) });

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({
      backupId: "backup-1",
      artifactValidity: "valid",
    });
  });

  it("maps backup artifact errors to status code", async () => {
    authMock.authenticateSessionRequest.mockResolvedValue(OWNER_A);

    vi.mocked(verifyBackupSnapshotForUser).mockRejectedValue(
      new BackupArtifactError("BACKUP_NOT_FOUND", 404, "Backup snapshot not found."),
    );

    const response = await GET({} as Request, { params: Promise.resolve({ backupId: "missing" }) });

    expect(response.status).toBe(404);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({ error: "BACKUP_NOT_FOUND" });
  });

  describe("m15.v2 dispatch", () => {
    beforeEach(() => {
      authMock.authenticateSessionRequest.mockResolvedValue(OWNER_A);
    });

    it("dispatches to the WP2H5 runtime and returns its native result when schemaVersion is m15.v2", async () => {
      vi.mocked(prisma.opsBackupSnapshot.findFirst).mockResolvedValue({ schemaVersion: "m15.v2" } as never);
      const result = { ok: true, verifiedReferenceCount: 2 };
      vi.mocked(verifyBackupM15V2SnapshotForUser).mockResolvedValue(result as never);

      const response = await GET({} as Request, { params: Promise.resolve({ backupId: "backup-v2" }) });

      expect(response.status).toBe(200);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      await expect(response.json()).resolves.toEqual(result);
      expect(verifyBackupM15V2SnapshotForUser).toHaveBeenCalledWith(OWNER_ID, "backup-v2", { now: expect.any(Function) });
      expect(verifyBackupSnapshotForUser).not.toHaveBeenCalled();
    });

    it("dispatches to the WP2H5 runtime for an ok:false verification result, still returning 200", async () => {
      vi.mocked(prisma.opsBackupSnapshot.findFirst).mockResolvedValue({ schemaVersion: "m15.v2" } as never);
      const result = { ok: false, code: "hash_mismatch", message: "sanitized", verifiedAt: "2026-07-30T00:00:00.000Z" };
      vi.mocked(verifyBackupM15V2SnapshotForUser).mockResolvedValue(result as never);

      const response = await GET({} as Request, { params: Promise.resolve({ backupId: "backup-v2" }) });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual(result);
    });

    it("falls through to the unchanged M13 implementation for an unknown schemaVersion", async () => {
      vi.mocked(prisma.opsBackupSnapshot.findFirst).mockResolvedValue({ schemaVersion: "m14.v1" } as never);
      vi.mocked(verifyBackupSnapshotForUser).mockResolvedValue({
        backupId: "backup-1", schemaVersion: "m14.v1", checksumStatus: "verified_match", artifactValidity: "valid",
        externalReferenceStatus: "not_applicable", recoveryArtifactStatus: "verification_ready", reason: null,
        verifiedAt: new Date().toISOString(),
      });

      const response = await GET({} as Request, { params: Promise.resolve({ backupId: "backup-1" }) });

      expect(response.status).toBe(200);
      expect(verifyBackupSnapshotForUser).toHaveBeenCalledWith(OWNER_ID, "backup-1");
      expect(verifyBackupM15V2SnapshotForUser).not.toHaveBeenCalled();
    });

    it("falls through to the unchanged M13 implementation when the snapshot is absent", async () => {
      vi.mocked(prisma.opsBackupSnapshot.findFirst).mockResolvedValue(null);
      vi.mocked(verifyBackupSnapshotForUser).mockRejectedValue(
        new BackupArtifactError("BACKUP_NOT_FOUND", 404, "Backup snapshot not found."),
      );

      const response = await GET({} as Request, { params: Promise.resolve({ backupId: "missing" }) });

      expect(response.status).toBe(404);
      expect(verifyBackupM15V2SnapshotForUser).not.toHaveBeenCalled();
    });

    it("reads the snapshot header owner-scoped (a different owner's row is indistinguishable from absent)", async () => {
      vi.mocked(prisma.opsBackupSnapshot.findFirst).mockResolvedValue(null);
      vi.mocked(verifyBackupSnapshotForUser).mockRejectedValue(
        new BackupArtifactError("BACKUP_NOT_FOUND", 404, "Backup snapshot not found."),
      );

      await GET({} as Request, { params: Promise.resolve({ backupId: "backup-of-another-owner" }) });

      expect(prisma.opsBackupSnapshot.findFirst).toHaveBeenCalledWith({
        where: { id: "backup-of-another-owner", ownerUserId: OWNER_ID },
        select: { schemaVersion: true },
      });
    });

    it("maps a BackupM15V2SnapshotPersistenceError to its HTTP status, sanitized", async () => {
      vi.mocked(prisma.opsBackupSnapshot.findFirst).mockResolvedValue({ schemaVersion: "m15.v2" } as never);
      vi.mocked(verifyBackupM15V2SnapshotForUser).mockRejectedValue(
        new BackupM15V2SnapshotPersistenceError("SNAPSHOT_NOT_FOUND"),
      );

      const response = await GET({} as Request, { params: Promise.resolve({ backupId: "backup-v2" }) });

      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toMatchObject({ error: "SNAPSHOT_NOT_FOUND" });
    });

    it("does not leak owner, path, or hash details in the m15.v2 response", async () => {
      vi.mocked(prisma.opsBackupSnapshot.findFirst).mockResolvedValue({ schemaVersion: "m15.v2" } as never);
      const result = { ok: false, code: "hash_mismatch" as const, message: "sanitized", verifiedAt: "2026-07-30T00:00:00.000Z" };
      vi.mocked(verifyBackupM15V2SnapshotForUser).mockResolvedValue(result as never);

      const response = await GET({} as Request, { params: Promise.resolve({ backupId: "backup-v2" }) });
      const serialized = JSON.stringify(await response.json());

      expect(serialized).not.toContain(OWNER_ID);
      expect(serialized).not.toContain(".storage");
      expect(serialized).not.toMatch(/[0-9a-f]{64}/);
    });

    it("relays an identical mocked business result unchanged across repeated calls", async () => {
      // Business determinism check under mocking: given the same persisted state and the
      // same resolver results (here, a fixed mock return value), the route relays the
      // exact same payload. This does NOT exercise the real clock — verifiedAt/previewedAt
      // is intentionally request-time-derived and is covered separately below.
      vi.mocked(prisma.opsBackupSnapshot.findFirst).mockResolvedValue({ schemaVersion: "m15.v2" } as never);
      const result = { ok: true, verifiedReferenceCount: 1 };
      vi.mocked(verifyBackupM15V2SnapshotForUser).mockResolvedValue(result as never);

      const first = await GET({} as Request, { params: Promise.resolve({ backupId: "backup-v2" }) });
      const second = await GET({} as Request, { params: Promise.resolve({ backupId: "backup-v2" }) });

      await expect(first.json()).resolves.toEqual(await second.json());
    });

    it("supplies dependencies.now bound to the frozen system clock at the exact requested instant", async () => {
      const FIXED_INSTANT = "2030-01-02T03:04:05.000Z";
      vi.mocked(prisma.opsBackupSnapshot.findFirst).mockResolvedValue({ schemaVersion: "m15.v2" } as never);
      vi.useFakeTimers();
      vi.setSystemTime(new Date(FIXED_INSTANT));
      try {
        let capturedDependencies: { now: () => Date } | undefined;
        vi.mocked(verifyBackupM15V2SnapshotForUser).mockImplementation(async (_owner, _backupId, dependencies) => {
          capturedDependencies = dependencies;
          return { ok: true, verifiedReferenceCount: 0 } as never;
        });

        await GET({} as Request, { params: Promise.resolve({ backupId: "backup-v2" }) });

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
        vi.mocked(verifyBackupM15V2SnapshotForUser).mockImplementation(async (owner, backupId, dependencies) => {
          capturedOwner = owner;
          capturedBackupId = backupId;
          capturedDependencies = dependencies;
          return { ok: true, verifiedReferenceCount: 0 } as never;
        });

        await GET({} as Request, { params: Promise.resolve({ backupId: "backup-v2" }) });

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
