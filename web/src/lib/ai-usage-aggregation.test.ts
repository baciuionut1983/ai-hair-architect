import { describe, expect, it, vi } from "vitest";

const prismaMocks = vi.hoisted(() => ({ findMany: vi.fn() }));

vi.mock("@/lib/prisma", () => ({
  prisma: { aiUsageEvent: { findMany: prismaMocks.findMany } },
}));

import { getAiUsageAggregation } from "./ai-usage-aggregation";

function row(overrides: Partial<{
  ownerUserId: string;
  provider: string;
  model: string;
  feature: string;
  outcome: "SUCCEEDED" | "FAILED";
  estimatedCostMicros: bigint | null;
  usage: Record<string, unknown>;
}> = {}) {
  return {
    ownerUserId: "owner-1",
    provider: "gemini",
    model: "gemini-2.5-flash",
    feature: "consultation_chat",
    outcome: "SUCCEEDED" as const,
    estimatedCostMicros: null,
    usage: {},
    ...overrides,
  };
}

const RANGE = { startDate: new Date("2026-08-01T00:00:00.000Z"), endDate: new Date("2026-09-01T00:00:00.000Z") };

describe("getAiUsageAggregation", () => {
  it("1. sums totals, tokens, and success/failure counts across every row in range", async () => {
    prismaMocks.findMany.mockResolvedValue([
      row({ estimatedCostMicros: BigInt(100), usage: { inputTokens: 10, outputTokens: 5 } }),
      row({ estimatedCostMicros: BigInt(50), usage: { inputTokens: 20, outputTokens: 8 }, outcome: "FAILED" }),
    ]);

    const result = await getAiUsageAggregation(RANGE);

    expect(result.totalOperations).toBe(2);
    expect(result.succeededOperations).toBe(1);
    expect(result.failedOperations).toBe(1);
    expect(result.totalEstimatedCostMicros).toBe("150");
    expect(result.totalInputTokens).toBe(30);
    expect(result.totalOutputTokens).toBe(13);
  });

  it("2. treats a null estimatedCostMicros (unavailable cost) as zero in totals, not as a crash", async () => {
    prismaMocks.findMany.mockResolvedValue([row({ estimatedCostMicros: null })]);
    const result = await getAiUsageAggregation(RANGE);
    expect(result.totalEstimatedCostMicros).toBe("0");
  });

  it("3. breaks down by provider", async () => {
    prismaMocks.findMany.mockResolvedValue([
      row({ provider: "gemini", estimatedCostMicros: BigInt(10) }),
      row({ provider: "gemini", estimatedCostMicros: BigInt(20) }),
      row({ provider: "openai", estimatedCostMicros: BigInt(5) }),
    ]);
    const result = await getAiUsageAggregation(RANGE);
    const gemini = result.byProvider.find((entry) => entry.key === "gemini");
    const openai = result.byProvider.find((entry) => entry.key === "openai");
    expect(gemini).toMatchObject({ operations: 2, estimatedCostMicros: "30" });
    expect(openai).toMatchObject({ operations: 1, estimatedCostMicros: "5" });
  });

  it("4. breaks down by model", async () => {
    prismaMocks.findMany.mockResolvedValue([
      row({ model: "gemini-2.5-flash" }),
      row({ model: "gemini-2.5-pro" }),
    ]);
    const result = await getAiUsageAggregation(RANGE);
    expect(result.byModel.map((entry) => entry.key).sort()).toEqual(["gemini-2.5-flash", "gemini-2.5-pro"]);
  });

  it("5. breaks down by feature", async () => {
    prismaMocks.findMany.mockResolvedValue([
      row({ feature: "consultation_chat" }),
      row({ feature: "image_analysis" }),
      row({ feature: "image_analysis" }),
    ]);
    const result = await getAiUsageAggregation(RANGE);
    const imageAnalysis = result.byFeature.find((entry) => entry.key === "image_analysis");
    expect(imageAnalysis?.operations).toBe(2);
  });

  it("6. passes the date range and every optional filter through to the query", async () => {
    prismaMocks.findMany.mockResolvedValue([]);
    await getAiUsageAggregation({ ...RANGE, ownerUserId: "owner-9", provider: "gemini", model: "m1", feature: "f1" });
    expect(prismaMocks.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          createdAt: { gte: RANGE.startDate, lt: RANGE.endDate },
          ownerUserId: "owner-9",
          provider: "gemini",
          model: "m1",
          feature: "f1",
        }),
      }),
    );
  });

  it("7. ranks top users by cost descending, most expensive first", async () => {
    prismaMocks.findMany.mockResolvedValue([
      row({ ownerUserId: "owner-cheap", estimatedCostMicros: BigInt(10) }),
      row({ ownerUserId: "owner-expensive", estimatedCostMicros: BigInt(9999) }),
      row({ ownerUserId: "owner-cheap", estimatedCostMicros: BigInt(10) }),
    ]);
    const result = await getAiUsageAggregation(RANGE);
    expect(result.topUsersByCost[0]).toMatchObject({ ownerUserId: "owner-expensive", estimatedCostMicros: "9999" });
    expect(result.topUsersByCost[1]).toMatchObject({ ownerUserId: "owner-cheap", estimatedCostMicros: "20", operations: 2 });
  });

  it("8. returns all-zero totals for an empty range rather than throwing", async () => {
    prismaMocks.findMany.mockResolvedValue([]);
    const result = await getAiUsageAggregation(RANGE);
    expect(result.totalOperations).toBe(0);
    expect(result.totalEstimatedCostMicros).toBe("0");
    expect(result.byProvider).toEqual([]);
    expect(result.topUsersByCost).toEqual([]);
  });
});
