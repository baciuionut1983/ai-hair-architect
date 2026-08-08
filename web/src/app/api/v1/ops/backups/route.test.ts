import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.hoisted(() => ({ authenticateSessionRequest: vi.fn() }));
const createRuntimeMock = vi.hoisted(() => ({ createBackupM15V2SnapshotForUser: vi.fn() }));

vi.mock("@/lib/session-request-auth", () => authMock);

vi.mock("@/lib/ops-persistence", () => ({
  listBackupSnapshotsForUser: vi.fn(),
}));

vi.mock("@/lib/backup-m15-v2-snapshot-persistence-runtime", () => createRuntimeMock);

const { FakeBackupM15V2SnapshotPersistenceError } = vi.hoisted(() => {
  class FakeBackupM15V2SnapshotPersistenceError extends Error {
    code: string;
    constructor(code: string) {
      super(`fake-${code}`);
      this.name = "BackupM15V2SnapshotPersistenceError";
      this.code = code;
    }
  }
  return { FakeBackupM15V2SnapshotPersistenceError };
});

vi.mock("@/lib/backup-m15-v2-snapshot-persistence", () => ({
  BackupM15V2SnapshotPersistenceError: FakeBackupM15V2SnapshotPersistenceError,
}));

import { GET, POST } from "./route";
import { listBackupSnapshotsForUser } from "@/lib/ops-persistence";

describe("ops backups route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.authenticateSessionRequest.mockResolvedValue({
      id: "user-1",
      email: "user@example.com",
      role: "professional",
      locale: "en",
    });
  });

  it("lists owner-scoped persistent backups", async () => {
    vi.mocked(listBackupSnapshotsForUser).mockResolvedValue([
      {
        id: "backup-1",
        ownerUserId: "user-1",
        label: "checkpoint",
        createdAt: "2026-07-21T10:00:00.000Z",
        checksum: "a".repeat(64),
        checksumAlgorithm: "sha256",
        schemaVersion: "m13.v1",
        createdByUserId: "user-1",
        snapshot: {
          clientsCount: 1,
          consultationsCount: 0,
          appointmentsCount: 0,
          notificationsCount: 0,
          workspacesCount: 0,
        },
      },
    ]);

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      backups: [
        {
          id: "backup-1",
          checksumAlgorithm: "sha256",
        },
      ],
    });
  });

  it("creates a backup snapshot on the m15.v2 schema with sanitized label (M33 GO-2)", async () => {
    createRuntimeMock.createBackupM15V2SnapshotForUser.mockResolvedValue({
      id: "backup-2",
      ownerUserId: "user-1",
      label: "release-checkpoint",
      createdAt: "2026-07-21T10:00:00.000Z",
      checksum: "b".repeat(64),
      checksumAlgorithm: "sha256",
      schemaVersion: "m15.v2",
      createdByUserId: "user-1",
      snapshot: {
        clientsCount: 2,
        consultationsCount: 1,
        appointmentsCount: 0,
        notificationsCount: 0,
        workspacesCount: 0,
      },
    });

    const response = await POST({ json: async () => ({ label: "  release-checkpoint  " }) } as never);

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({ backup: { schemaVersion: "m15.v2" } });
    expect(createRuntimeMock.createBackupM15V2SnapshotForUser).toHaveBeenCalledWith(
      "user-1",
      "user-1",
      "release-checkpoint",
      { now: expect.any(Function) },
    );
  });

  it("never references the legacy m13.v3 creator (m15.v2 is the only schema emitted for new backups)", () => {
    expect(readRouteSource()).not.toMatch(/createPersistentBackupSnapshot/);
  });

  it("maps a BackupM15V2SnapshotPersistenceError to a sanitized error response", async () => {
    createRuntimeMock.createBackupM15V2SnapshotForUser.mockRejectedValue(
      new FakeBackupM15V2SnapshotPersistenceError("ROW_LIMIT_EXCEEDED"),
    );

    const response = await POST({ json: async () => ({ label: "checkpoint" }) } as never);

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({ error: "ROW_LIMIT_EXCEEDED" });
  });

  it("maps an unexpected creation failure to a sanitized 500", async () => {
    createRuntimeMock.createBackupM15V2SnapshotForUser.mockRejectedValue(new Error("boom"));

    const response = await POST({ json: async () => ({ label: "checkpoint" }) } as never);

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({ error: "INTERNAL_ERROR" });
  });

  it("returns 401 without a cookie, never reading persistence", async () => {
    authMock.authenticateSessionRequest.mockResolvedValue(null);

    const response = await GET();

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ error: "Unauthorized" });
    expect(listBackupSnapshotsForUser).not.toHaveBeenCalled();
  });

  it("returns 401 for an unknown or expired session (no in-memory fallback -- previously resolveOpsSessionUser could return a cached in-memory user even when the Postgres session had expired; that path no longer exists)", async () => {
    authMock.authenticateSessionRequest.mockResolvedValue(null);

    const response = await GET();

    expect(response.status).toBe(401);
  });

  it("scopes the list strictly to the authenticated owner (cross-user isolation)", async () => {
    authMock.authenticateSessionRequest.mockResolvedValue({
      id: "user-2",
      email: "user2@example.com",
      role: "professional",
      locale: "en",
    });
    vi.mocked(listBackupSnapshotsForUser).mockResolvedValue([]);

    await GET();

    expect(listBackupSnapshotsForUser).toHaveBeenCalledWith("user-2");
    expect(listBackupSnapshotsForUser).not.toHaveBeenCalledWith("user-1");
  });

  it("rejects unexpected request fields", async () => {
    const response = await POST({ json: async () => ({ label: "ok", force: true }) } as never);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: "BACKUP_REQUEST_INVALID_FIELD" });
  });

  it("rejects non-string label", async () => {
    const response = await POST({ json: async () => ({ label: 42 }) } as never);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: "BACKUP_LABEL_INVALID_TYPE" });
  });

  it("rejects too-long label", async () => {
    const response = await POST({ json: async () => ({ label: "a".repeat(121) }) } as never);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: "BACKUP_LABEL_TOO_LONG" });
  });
});

function readRouteSource(): string {
  return fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "route.ts"), "utf8");
}