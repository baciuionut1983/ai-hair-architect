import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.hoisted(() => ({ authenticateSessionRequest: vi.fn() }));

vi.mock("@/lib/session-request-auth", () => authMock);

vi.mock("@/lib/backup-v13-restore-observability", () => ({
  buildRestoreGovernanceHealth: vi.fn(),
}));

import { GET } from "./route";
import { buildRestoreGovernanceHealth } from "@/lib/backup-v13-restore-observability";

const OWNER_A = { id: "owner-1", email: "owner@example.com", role: "professional", locale: "en" };

describe("restore-runs health route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.authenticateSessionRequest.mockResolvedValue(OWNER_A);
  });

  it("returns 401 without a cookie, never reading persistence", async () => {
    authMock.authenticateSessionRequest.mockResolvedValue(null);

    const response = await GET(new Request("http://localhost/api/v1/ops/backups/restore-runs/health"));

    expect(response.status).toBe(401);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({ error: "UNAUTHORIZED" });
    expect(buildRestoreGovernanceHealth).not.toHaveBeenCalled();
  });

  it("returns 401 for an unknown or expired session (no in-memory fallback)", async () => {
    authMock.authenticateSessionRequest.mockResolvedValue(null);

    const response = await GET(new Request("http://localhost/api/v1/ops/backups/restore-runs/health"));

    expect(response.status).toBe(401);
  });

  it("returns 200 on success", async () => {
    vi.mocked(buildRestoreGovernanceHealth).mockResolvedValue({
      requestId: "req-1",
      generatedAt: new Date().toISOString(),
      state: "healthy",
      reasons: [],
      currentState: {
        staleRestoreRuns: 0,
        staleMaintenanceRuns: 0,
        staleRetentionRuns: 0,
        activeGovernanceOperations: 0,
      },
      recentFailureAttentionCount24h: 0,
      thresholds: {
        restoreStartedStaleMinutes: 15,
        maintenanceRunningStaleMinutes: 30,
        retentionRunningStaleMinutes: 30,
        warningFailureAttentionCount24hMin: 1,
        warningFailureAttentionCount24hMax: 2,
        degradedFailureAttentionCount24hMin: 3,
      },
    } as never);

    const response = await GET(new Request("http://localhost/api/v1/ops/backups/restore-runs/health"));

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({ state: "healthy" });
  });

  it("returns 500 on unexpected failure", async () => {
    vi.mocked(buildRestoreGovernanceHealth).mockRejectedValue(new Error("boom"));

    const response = await GET(new Request("http://localhost/api/v1/ops/backups/restore-runs/health"));

    expect(response.status).toBe(500);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({ error: "BACKUP_RESTORE_HEALTH_UNAVAILABLE" });
  });

  it("uses sanitized request id when valid", async () => {
    vi.mocked(buildRestoreGovernanceHealth).mockResolvedValue({
      requestId: "req-12345",
      generatedAt: new Date().toISOString(),
      state: "healthy",
      reasons: [],
      currentState: {
        staleRestoreRuns: 0,
        staleMaintenanceRuns: 0,
        staleRetentionRuns: 0,
        activeGovernanceOperations: 0,
      },
      recentFailureAttentionCount24h: 0,
      thresholds: {
        restoreStartedStaleMinutes: 15,
        maintenanceRunningStaleMinutes: 30,
        retentionRunningStaleMinutes: 30,
        warningFailureAttentionCount24hMin: 1,
        warningFailureAttentionCount24hMax: 2,
        degradedFailureAttentionCount24hMin: 3,
      },
    } as never);

    await GET(
      new Request("http://localhost/api/v1/ops/backups/restore-runs/health", {
        headers: new Headers({ "x-request-id": "  req-12345  " }),
      }),
    );

    const call = vi.mocked(buildRestoreGovernanceHealth).mock.calls.at(-1)?.[0];
    expect(call?.requestId).toBe("req-12345");
  });
});
