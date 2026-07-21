import { beforeEach, describe, expect, it, vi } from "vitest";

const cookiesMock = vi.hoisted(() => ({
  cookies: vi.fn(),
}));

vi.mock("next/headers", () => cookiesMock);

vi.mock("@/lib/ops-persistence", () => ({
  resolveOpsSessionUser: vi.fn(),
  listBackupSnapshotsForUser: vi.fn(),
  createPersistentBackupSnapshot: vi.fn(),
}));

import { GET, POST } from "./route";
import { createPersistentBackupSnapshot, listBackupSnapshotsForUser, resolveOpsSessionUser } from "@/lib/ops-persistence";

describe("ops backups route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(cookiesMock.cookies).mockResolvedValue({
      get: () => ({ value: "session-token" }),
    } as never);
    vi.mocked(resolveOpsSessionUser).mockResolvedValue({
      id: "user-1",
      email: "user@example.com",
      role: "professional",
      locale: "en",
      createdAt: new Date().toISOString(),
    } as never);
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
        schemaVersion: "m12.v1",
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
      schemaVersion: "m12.v1",
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

  it("returns 401 when unauthenticated", async () => {
    vi.mocked(resolveOpsSessionUser).mockResolvedValue(null);

    const response = await GET();

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ error: "Unauthorized" });
  });
});