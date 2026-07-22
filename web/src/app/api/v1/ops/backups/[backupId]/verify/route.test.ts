import { beforeEach, describe, expect, it, vi } from "vitest";

import { BackupArtifactError } from "@/lib/backup-v13-artifact";

const cookiesMock = vi.hoisted(() => ({
  cookies: vi.fn(),
}));

vi.mock("next/headers", () => cookiesMock);

vi.mock("@/lib/ops-persistence", () => ({
  resolveOpsSessionUser: vi.fn(),
  verifyBackupSnapshotForUser: vi.fn(),
}));

import { GET } from "./route";
import { resolveOpsSessionUser, verifyBackupSnapshotForUser } from "@/lib/ops-persistence";

describe("ops backup verify route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(cookiesMock.cookies).mockResolvedValue({
      get: () => ({ value: "session-token" }),
    } as never);
  });

  it("returns 401 when unauthenticated", async () => {
    vi.mocked(resolveOpsSessionUser).mockResolvedValue(null);

    const response = await GET({} as Request, { params: Promise.resolve({ backupId: "backup-1" }) });

    expect(response.status).toBe(401);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("returns verification payload on success", async () => {
    vi.mocked(resolveOpsSessionUser).mockResolvedValue({
      id: "user-1",
      email: "u@example.com",
      role: "professional",
      locale: "en",
      createdAt: new Date().toISOString(),
    } as never);

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
    vi.mocked(resolveOpsSessionUser).mockResolvedValue({
      id: "user-1",
      email: "u@example.com",
      role: "professional",
      locale: "en",
      createdAt: new Date().toISOString(),
    } as never);

    vi.mocked(verifyBackupSnapshotForUser).mockRejectedValue(
      new BackupArtifactError("BACKUP_NOT_FOUND", 404, "Backup snapshot not found."),
    );

    const response = await GET({} as Request, { params: Promise.resolve({ backupId: "missing" }) });

    expect(response.status).toBe(404);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({ error: "BACKUP_NOT_FOUND" });
  });
});
