import { beforeEach, describe, expect, it, vi } from "vitest";

import { BackupArtifactError } from "@/lib/backup-v13-artifact";

const cookiesMock = vi.hoisted(() => ({
  cookies: vi.fn(),
}));

vi.mock("next/headers", () => cookiesMock);

vi.mock("@/lib/ops-persistence", () => ({
  resolveOpsSessionUserReadOnly: vi.fn(),
}));

vi.mock("@/lib/backup-v13-restore-preview", () => ({
  getBackupRestorePreviewForUser: vi.fn(),
}));

import { POST } from "./route";
import { getBackupRestorePreviewForUser } from "@/lib/backup-v13-restore-preview";
import { resolveOpsSessionUserReadOnly } from "@/lib/ops-persistence";

describe("restore-preview route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(cookiesMock.cookies).mockResolvedValue({
      get: () => ({ value: "session-token" }),
    } as never);
    vi.mocked(resolveOpsSessionUserReadOnly).mockResolvedValue({
      id: "user-1",
      email: "user@example.com",
      role: "professional",
      locale: "en",
      createdAt: new Date().toISOString(),
    } as never);
  });

  it("returns 401 when unauthenticated", async () => {
    vi.mocked(resolveOpsSessionUserReadOnly).mockResolvedValue(null);

    const response = await POST({ json: async () => ({}) } as never, { params: Promise.resolve({ backupId: "backup-1" }) });

    expect(response.status).toBe(401);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("rejects non-empty request bodies", async () => {
    const response = await POST({ json: async () => ({ force: true }) } as never, { params: Promise.resolve({ backupId: "backup-1" }) });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: "BACKUP_PREVIEW_REQUEST_INVALID_JSON" });
  });

  it("returns a preview payload on success", async () => {
    vi.mocked(getBackupRestorePreviewForUser).mockResolvedValue({
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

  it("maps backup artifact errors to HTTP responses", async () => {
    vi.mocked(getBackupRestorePreviewForUser).mockRejectedValue(
      new BackupArtifactError("BACKUP_PREVIEW_UNINTERPRETABLE", 422, "Backup snapshot cannot be interpreted for restore planning."),
    );

    const response = await POST({ json: async () => ({}) } as never, { params: Promise.resolve({ backupId: "backup-1" }) });

    expect(response.status).toBe(422);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({ error: "BACKUP_PREVIEW_UNINTERPRETABLE" });
  });
});