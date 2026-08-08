import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.hoisted(() => ({ authenticateSessionRequest: vi.fn() }));

vi.mock("@/lib/session-request-auth", () => authMock);

vi.mock("@/lib/backup-v13-restore-observability", () => ({
  RESTORE_GOVERNANCE_ALERTS_WINDOW_UNSUPPORTED: "BACKUP_RESTORE_ALERTS_WINDOW_UNSUPPORTED",
  parseRestoreGovernanceAlertsQuery: vi.fn(),
  buildRestoreGovernanceAlerts: vi.fn(),
}));

import { GET } from "./route";
import {
  buildRestoreGovernanceAlerts,
  parseRestoreGovernanceAlertsQuery,
} from "@/lib/backup-v13-restore-observability";

const OWNER_A = { id: "owner-1", email: "owner@example.com", role: "professional", locale: "en" };

describe("restore-runs alerts route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.authenticateSessionRequest.mockResolvedValue(OWNER_A);
    vi.mocked(parseRestoreGovernanceAlertsQuery).mockReturnValue({ window: "24h" });
  });

  it("returns 401 without a cookie, never reading persistence", async () => {
    authMock.authenticateSessionRequest.mockResolvedValue(null);

    const response = await GET(new Request("http://localhost/api/v1/ops/backups/restore-runs/alerts"));

    expect(response.status).toBe(401);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({ error: "UNAUTHORIZED" });
    expect(buildRestoreGovernanceAlerts).not.toHaveBeenCalled();
  });

  it("returns 401 for an unknown or expired session (no in-memory fallback)", async () => {
    authMock.authenticateSessionRequest.mockResolvedValue(null);

    const response = await GET(new Request("http://localhost/api/v1/ops/backups/restore-runs/alerts"));

    expect(response.status).toBe(401);
  });

  it("returns 400 for invalid window", async () => {
    vi.mocked(parseRestoreGovernanceAlertsQuery).mockImplementation(() => {
      throw new Error("BACKUP_RESTORE_ALERTS_WINDOW_UNSUPPORTED");
    });

    const response = await GET(new Request("http://localhost/api/v1/ops/backups/restore-runs/alerts?window=2d"));

    expect(response.status).toBe(400);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({ error: "BACKUP_RESTORE_ALERTS_WINDOW_UNSUPPORTED" });
  });

  it("returns 200 with active alerts payload", async () => {
    vi.mocked(buildRestoreGovernanceAlerts).mockResolvedValue({
      requestId: "req-1",
      generatedAt: new Date().toISOString(),
      window: "24h",
      state: "warning",
      alerts: [
        {
          code: "STALE_RESTORE_RUNS",
          severity: "warning",
          message: "Stale restore runs detected in active governance operations.",
          window: "24h",
          comparator: ">=",
          warningThreshold: 1,
          degradedThreshold: 3,
          actualValue: 1,
          sampleSize: 1,
          minimumSampleSize: null,
          evaluatedAt: new Date().toISOString(),
        },
      ],
    } as never);

    const response = await GET(new Request("http://localhost/api/v1/ops/backups/restore-runs/alerts?window=24h"));

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({ state: "warning" });
  });

  it("returns 500 when builder throws", async () => {
    vi.mocked(buildRestoreGovernanceAlerts).mockRejectedValue(new Error("boom"));

    const response = await GET(new Request("http://localhost/api/v1/ops/backups/restore-runs/alerts?window=24h"));

    expect(response.status).toBe(500);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({ error: "BACKUP_RESTORE_ALERTS_UNAVAILABLE" });
  });

  it("uses uuid fallback for invalid request id header", async () => {
    vi.mocked(buildRestoreGovernanceAlerts).mockResolvedValue({
      requestId: "placeholder",
      generatedAt: new Date().toISOString(),
      window: "24h",
      state: "healthy",
      alerts: [],
    } as never);

    await GET(
      new Request("http://localhost/api/v1/ops/backups/restore-runs/alerts", {
        headers: new Headers({ "x-request-id": "bad id with spaces" }),
      }),
    );

    const call = vi.mocked(buildRestoreGovernanceAlerts).mock.calls.at(-1)?.[0];
    expect(call?.requestId).toMatch(/^[0-9a-f-]{36}$/);
  });
});
