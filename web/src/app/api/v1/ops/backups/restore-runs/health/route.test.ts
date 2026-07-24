import { beforeEach, describe, expect, it, vi } from "vitest";

const cookiesMock = vi.hoisted(() => ({
  cookies: vi.fn(),
}));

vi.mock("next/headers", () => cookiesMock);

vi.mock("@/lib/ops-persistence", () => ({
  resolveOpsSessionUserReadOnly: vi.fn(),
}));

vi.mock("@/lib/backup-v13-restore-observability", () => ({
  buildRestoreGovernanceHealth: vi.fn(),
}));

import { GET } from "./route";
import { buildRestoreGovernanceHealth } from "@/lib/backup-v13-restore-observability";
import { resolveOpsSessionUserReadOnly } from "@/lib/ops-persistence";

describe("restore-runs health route", () => {
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

    const response = await GET(new Request("http://localhost/api/v1/ops/backups/restore-runs/health"));

    expect(response.status).toBe(401);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({ error: "UNAUTHORIZED" });
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
