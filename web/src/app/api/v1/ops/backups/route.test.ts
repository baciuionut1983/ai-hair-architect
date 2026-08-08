import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.hoisted(() => ({ authenticateSessionRequest: vi.fn() }));

vi.mock("@/lib/session-request-auth", () => authMock);

vi.mock("@/lib/ops-persistence", () => ({
  listBackupSnapshotsForUser: vi.fn(),
  createPersistentBackupSnapshot: vi.fn(),
}));

import { GET, POST } from "./route";
import { createPersistentBackupSnapshot, listBackupSnapshotsForUser } from "@/lib/ops-persistence";

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

  it("creates a persistent backup snapshot with sanitized label", async () => {
    vi.mocked(createPersistentBackupSnapshot).mockResolvedValue({
      id: "backup-2",
      ownerUserId: "user-1",
      label: "release-checkpoint",
      createdAt: "2026-07-21T10:00:00.000Z",
      checksum: "b".repeat(64),
      checksumAlgorithm: "sha256",
      schemaVersion: "m13.v1",
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
    expect(vi.mocked(createPersistentBackupSnapshot)).toHaveBeenCalledWith({
      ownerUserId: "user-1",
      createdByUserId: "user-1",
      label: "release-checkpoint",
    });
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