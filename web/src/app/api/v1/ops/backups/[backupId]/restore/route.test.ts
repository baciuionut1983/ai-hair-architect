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

import { POST } from "./route";
import { executeBackupRestoreWithHistory } from "@/lib/backup-v13-restore-run-history";
import { resolveOpsSessionUserReadOnly } from "@/lib/ops-persistence";

const VALID_PREVIEW_FINGERPRINT = "a".repeat(64);
const VALID_CURRENT_STATE_FINGERPRINT = "b".repeat(64);

describe("restore route", () => {
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
});