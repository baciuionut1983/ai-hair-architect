import { describe, expect, it, vi } from "vitest";

const hardeningMock = vi.hoisted(() => ({
  ensureRequestId: vi.fn(),
}));

const guardsMock = vi.hoisted(() => ({
  evaluateReadiness: vi.fn(),
}));

vi.mock("@/lib/hardening", () => hardeningMock);
vi.mock("@/lib/production-guards", () => guardsMock);

import { GET } from "./route";

describe("ops readiness route", () => {
  it("returns the readiness payload and status from centralized guards", async () => {
    vi.mocked(hardeningMock.ensureRequestId).mockReturnValue("req-123");
    vi.mocked(guardsMock.evaluateReadiness).mockReturnValue({
      httpStatus: 503,
      payload: {
        status: "NOT_READY",
        checks: [
          {
            code: "BUSINESS_PERSISTENCE_PRODUCTION_READY",
            status: "FAIL",
            critical: true,
            message: "not ready",
          },
        ],
        requestId: "req-123",
        timestamp: "2026-07-24T00:00:00.000Z",
      },
    });

    const response = await GET(new Request("http://localhost/api/v1/ops/readiness"));

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      status: "NOT_READY",
      checks: [
        {
          code: "BUSINESS_PERSISTENCE_PRODUCTION_READY",
          status: "FAIL",
          critical: true,
          message: "not ready",
        },
      ],
      requestId: "req-123",
      timestamp: "2026-07-24T00:00:00.000Z",
    });
  });
});
