import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const aggregationMock = vi.hoisted(() => ({ getAiUsageAggregation: vi.fn() }));

vi.mock("@/lib/ai-usage-aggregation", () => aggregationMock);

import { GET } from "./route";

const ORIGINAL_ENV = { ...process.env };

const EMPTY_RESULT = {
  totalOperations: 0,
  succeededOperations: 0,
  failedOperations: 0,
  totalEstimatedCostMicros: "0",
  totalInputTokens: 0,
  totalOutputTokens: 0,
  byProvider: [],
  byModel: [],
  byFeature: [],
  topUsersByCost: [],
};

function invoke(query = "", authHeader: string | null = "Bearer test-secret"): Promise<Response> {
  const headers = new Headers();
  if (authHeader !== null) headers.set("authorization", authHeader);
  return GET(new Request(`http://localhost/api/v1/ops/ai-usage/report${query}`, { headers }));
}

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV, AI_USAGE_REPORT_TOKEN: "test-secret" };
  aggregationMock.getAiUsageAggregation.mockReset().mockResolvedValue(EMPTY_RESULT);
});

afterEach(() => {
  process.env = ORIGINAL_ENV;
});

describe("GET /api/v1/ops/ai-usage/report", () => {
  it("1. returns 503 when the report token is not configured, never reaching the aggregation service", async () => {
    delete process.env.AI_USAGE_REPORT_TOKEN;
    const response = await invoke();
    expect(response.status).toBe(503);
    expect(aggregationMock.getAiUsageAggregation).not.toHaveBeenCalled();
  });

  it("2. returns 401 for a missing/wrong bearer token, never reaching the aggregation service", async () => {
    const response = await invoke("", "Bearer wrong-secret");
    expect(response.status).toBe(401);
    expect(aggregationMock.getAiUsageAggregation).not.toHaveBeenCalled();
  });

  it("3. defaults to the current UTC calendar month when no date range is given", async () => {
    const response = await invoke();
    expect(response.status).toBe(200);
    const call = aggregationMock.getAiUsageAggregation.mock.calls[0][0];
    expect(call.startDate.getUTCDate()).toBe(1);
    expect(call.endDate.getTime()).toBeGreaterThan(call.startDate.getTime());
  });

  it("4. honors an explicit startDate/endDate query range", async () => {
    await invoke("?startDate=2026-01-01T00:00:00.000Z&endDate=2026-02-01T00:00:00.000Z");
    const call = aggregationMock.getAiUsageAggregation.mock.calls[0][0];
    expect(call.startDate.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(call.endDate.toISOString()).toBe("2026-02-01T00:00:00.000Z");
  });

  it("5. rejects an invalid date range (startDate not before endDate) with 400", async () => {
    const response = await invoke("?startDate=2026-02-01T00:00:00.000Z&endDate=2026-01-01T00:00:00.000Z");
    expect(response.status).toBe(400);
    expect(aggregationMock.getAiUsageAggregation).not.toHaveBeenCalled();
  });

  it("6. passes ownerUserId/provider/model/feature filters through from query params", async () => {
    await invoke("?ownerUserId=owner-9&provider=gemini&model=gemini-2.5-flash&feature=consultation_chat");
    expect(aggregationMock.getAiUsageAggregation).toHaveBeenCalledWith(
      expect.objectContaining({ ownerUserId: "owner-9", provider: "gemini", model: "gemini-2.5-flash", feature: "consultation_chat" }),
    );
  });

  it("7. returns the aggregation result as JSON on success", async () => {
    aggregationMock.getAiUsageAggregation.mockResolvedValue({ ...EMPTY_RESULT, totalOperations: 7 });
    const response = await invoke();
    const body = await response.json();
    expect(body.totalOperations).toBe(7);
  });

  it("8. maps an aggregation failure to 500, never leaking the raw error", async () => {
    aggregationMock.getAiUsageAggregation.mockRejectedValue(new Error("db exploded"));
    const response = await invoke();
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(JSON.stringify(body)).not.toContain("db exploded");
  });

  it("9. sets Cache-Control: no-store on every response", async () => {
    const response = await invoke();
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
});
