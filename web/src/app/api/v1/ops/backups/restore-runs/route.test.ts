import { beforeEach, describe, expect, it, vi } from "vitest";

import { BackupArtifactError } from "@/lib/backup-v13-artifact";

const cookiesMock = vi.hoisted(() => ({
  cookies: vi.fn(),
}));

vi.mock("next/headers", () => cookiesMock);

vi.mock("@/lib/ops-persistence", () => ({
  resolveOpsSessionUserReadOnly: vi.fn(),
}));

vi.mock("@/lib/backup-v13-restore-run-history", () => ({
  listBackupRestoreRunsForUser: vi.fn(),
}));

import { GET } from "./route";
import { listBackupRestoreRunsForUser } from "@/lib/backup-v13-restore-run-history";
import { resolveOpsSessionUserReadOnly } from "@/lib/ops-persistence";

describe("restore-runs route", () => {
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

    const response = await GET(new Request("http://localhost/api/v1/ops/backups/restore-runs"));

    expect(response.status).toBe(401);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("returns restore history page", async () => {
    vi.mocked(listBackupRestoreRunsForUser).mockResolvedValue({
      data: [
        {
          id: "run-1",
          backupId: "backup-1",
          status: "completed",
          attemptCount: 1,
          maxAttempts: 3,
          strategy: "replace_all",
          previewFingerprintPrefix: "aaaaaaaaaaaa",
          currentStateFingerprintPrefix: "bbbbbbbbbbbb",
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
          finalErrorCode: null,
          warningCodes: [],
          isStale: false,
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
        },
      ],
      pageInfo: {
        nextCursor: null,
        hasNextPage: false,
        limit: 20,
      },
    });

    const response = await GET(
      new Request("http://localhost/api/v1/ops/backups/restore-runs?limit=20&status=completed"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({
      data: [{ id: "run-1", backupId: "backup-1", previewFingerprintPrefix: "aaaaaaaaaaaa" }],
    });
  });

  it("maps domain validation errors", async () => {
    vi.mocked(listBackupRestoreRunsForUser).mockRejectedValue(
      new BackupArtifactError("RESTORE_HISTORY_CURSOR_INVALID", 400, "cursor invalid"),
    );

    const response = await GET(
      new Request("http://localhost/api/v1/ops/backups/restore-runs?cursor=bad"),
    );

    expect(response.status).toBe(400);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({ error: "RESTORE_HISTORY_CURSOR_INVALID" });
  });

  it("returns 500 for unexpected failures", async () => {
    vi.mocked(listBackupRestoreRunsForUser).mockRejectedValue(new Error("boom"));

    const response = await GET(new Request("http://localhost/api/v1/ops/backups/restore-runs"));

    expect(response.status).toBe(500);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({ error: "INTERNAL_ERROR" });
  });
});
