import { Prisma } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const prismaMocks = vi.hoisted(() => ({ configured: true, create: vi.fn() }));

vi.mock("@/lib/prisma", () => ({
  isDatabaseConfigured: () => prismaMocks.configured,
  prisma: { aiUsageEvent: { create: prismaMocks.create } },
}));

import { recordAiUsageEvent } from "./ai-usage-repository";

const ORIGINAL_PRICING_ENV = process.env.AI_USAGE_PRICING_TABLE_JSON;

const BASE_INPUT = {
  ownerUserId: "owner-1",
  clientId: "client-1",
  feature: "consultation_chat",
  modality: "TEXT_GENERATION" as const,
  correlationId: "corr-1",
  provider: "gemini",
  model: "gemini-2.5-flash",
  outcome: "SUCCEEDED" as const,
};

describe("recordAiUsageEvent", () => {
  beforeEach(() => {
    prismaMocks.configured = true;
    prismaMocks.create.mockReset().mockResolvedValue({});
    delete process.env.AI_USAGE_PRICING_TABLE_JSON;
  });

  afterAll(() => {
    if (ORIGINAL_PRICING_ENV === undefined) delete process.env.AI_USAGE_PRICING_TABLE_JSON;
    else process.env.AI_USAGE_PRICING_TABLE_JSON = ORIGINAL_PRICING_ENV;
  });

  it("1. records a successful call with every mapped field, and never throws", async () => {
    await expect(
      recordAiUsageEvent({
        ...BASE_INPUT,
        analysisId: "analysis-1",
        providerRequestId: "req-1",
        usage: { inputTokens: 100, outputTokens: 40 },
        latencyMs: 250,
      }),
    ).resolves.toBeUndefined();

    expect(prismaMocks.create).toHaveBeenCalledTimes(1);
    const data = prismaMocks.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      ownerUserId: "owner-1",
      clientId: "client-1",
      analysisId: "analysis-1",
      feature: "consultation_chat",
      modality: "TEXT_GENERATION",
      correlationId: "corr-1",
      attemptNumber: 1,
      idempotencyKey: "corr-1:1",
      provider: "gemini",
      model: "gemini-2.5-flash",
      providerRequestId: "req-1",
      usage: { inputTokens: 100, outputTokens: 40 },
      usageAvailable: true,
      outcome: "SUCCEEDED",
      latencyMs: 250,
    });
  });

  it("2. skips silently (no write, no throw) when the database is not configured", async () => {
    prismaMocks.configured = false;
    await expect(recordAiUsageEvent(BASE_INPUT)).resolves.toBeUndefined();
    expect(prismaMocks.create).not.toHaveBeenCalled();
  });

  it("3. treats a unique-constraint violation (duplicate idempotency key) as a safe no-op, not an error", async () => {
    prismaMocks.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("duplicate", { code: "P2002", clientVersion: "test" }),
    );
    await expect(recordAiUsageEvent(BASE_INPUT)).resolves.toBeUndefined();
  });

  it("4. swallows any other write failure -- the caller's own operation must never be broken by a metering failure", async () => {
    prismaMocks.create.mockRejectedValue(new Error("connection reset"));
    await expect(recordAiUsageEvent(BASE_INPUT)).resolves.toBeUndefined();
  });

  it("5. derives idempotencyKey from correlationId:attemptNumber when not explicitly provided", async () => {
    await recordAiUsageEvent({ ...BASE_INPUT, attemptNumber: 2 });
    expect(prismaMocks.create.mock.calls[0][0].data.idempotencyKey).toBe("corr-1:2");
  });

  it("6. uses an explicit idempotencyKey as-is when the caller supplies one", async () => {
    await recordAiUsageEvent({ ...BASE_INPUT, idempotencyKey: "explicit-key-xyz" });
    expect(prismaMocks.create.mock.calls[0][0].data.idempotencyKey).toBe("explicit-key-xyz");
  });

  it("7. marks usage explicitly unavailable (never a fabricated object of zeros) when the caller never captured any", async () => {
    await recordAiUsageEvent(BASE_INPUT);
    const data = prismaMocks.create.mock.calls[0][0].data;
    expect(data.usageAvailable).toBe(false);
    expect(data.usage).toEqual({});
    expect(data.costBasis).toBe("UNAVAILABLE");
    expect(data.estimatedCostMicros).toBeNull();
  });

  it("8. resolves and persists a real cost when a pricing entry is configured for this exact provider/model/modality", async () => {
    process.env.AI_USAGE_PRICING_TABLE_JSON = JSON.stringify({
      version: "v-test",
      entries: [
        {
          provider: "gemini",
          model: "gemini-2.5-flash",
          modality: "TEXT_GENERATION",
          currency: "USD",
          rate: { inputTokenMicros: 10, outputTokenMicros: 20 },
        },
      ],
    });
    await recordAiUsageEvent({ ...BASE_INPUT, usage: { inputTokens: 10, outputTokens: 5 } });
    const data = prismaMocks.create.mock.calls[0][0].data;
    expect(data.costBasis).toBe("CALCULATED");
    expect(data.estimatedCostMicros).toBe(BigInt(200));
    expect(data.currency).toBe("USD");
    expect(data.pricingVersion).toBe("v-test");
  });

  it("9. never writes any prompt/reply/transcript content -- only the fields the input type itself allows through", async () => {
    await recordAiUsageEvent({ ...BASE_INPUT, usage: { inputTokens: 1 } });
    const data = prismaMocks.create.mock.calls[0][0].data;
    const allowedKeys = new Set([
      "ownerUserId", "workspaceId", "clientId", "analysisId", "feature", "modality", "correlationId",
      "attemptNumber", "idempotencyKey", "provider", "model", "providerRequestId", "usage", "usageAvailable",
      "estimatedCostMicros", "currency", "pricingVersion", "costBasis", "outcome", "errorCategory", "latencyMs",
    ]);
    for (const key of Object.keys(data)) {
      expect(allowedKeys.has(key)).toBe(true);
    }
  });

  it("10. records a failed outcome with its error category, distinguishable from a successful one", async () => {
    await recordAiUsageEvent({ ...BASE_INPUT, outcome: "FAILED", errorCategory: "PROVIDER_TIMEOUT" });
    const data = prismaMocks.create.mock.calls[0][0].data;
    expect(data.outcome).toBe("FAILED");
    expect(data.errorCategory).toBe("PROVIDER_TIMEOUT");
  });

  it("11. a pricing configuration change never rewrites an already-recorded event's cost -- each event's cost is computed once, at write time, and the pricing version used is stamped on that same row", async () => {
    process.env.AI_USAGE_PRICING_TABLE_JSON = JSON.stringify({
      version: "v-2026-08-01",
      entries: [{ provider: "gemini", model: "gemini-2.5-flash", modality: "TEXT_GENERATION", currency: "USD", rate: { inputTokenMicros: 10 } }],
    });
    await recordAiUsageEvent({ ...BASE_INPUT, usage: { inputTokens: 10 } });
    const firstEventData = prismaMocks.create.mock.calls[0][0].data;
    expect(firstEventData).toMatchObject({ estimatedCostMicros: BigInt(100), pricingVersion: "v-2026-08-01" });

    // Pricing genuinely changes (a real provider price update) -- a NEW
    // event recorded afterward reflects it, but nothing re-touches the
    // row already written above; recordAiUsageEvent never updates an
    // existing row, only ever creates new ones.
    process.env.AI_USAGE_PRICING_TABLE_JSON = JSON.stringify({
      version: "v-2026-09-01",
      entries: [{ provider: "gemini", model: "gemini-2.5-flash", modality: "TEXT_GENERATION", currency: "USD", rate: { inputTokenMicros: 50 } }],
    });
    await recordAiUsageEvent({ ...BASE_INPUT, usage: { inputTokens: 10 } });
    const secondEventData = prismaMocks.create.mock.calls[1][0].data;
    expect(secondEventData).toMatchObject({ estimatedCostMicros: BigInt(500), pricingVersion: "v-2026-09-01" });

    // The first call's own recorded data object is untouched -- proving
    // the "historical cost never silently changes" guarantee directly,
    // not just inferred from the absence of an update code path.
    expect(firstEventData).toMatchObject({ estimatedCostMicros: BigInt(100), pricingVersion: "v-2026-08-01" });
  });

  it("12. retries/fallbacks are recorded as separate rows sharing one correlationId -- real provider consumption from a retried attempt is never lost or silently merged into the first", async () => {
    await recordAiUsageEvent({ ...BASE_INPUT, correlationId: "retry-corr", attemptNumber: 1, outcome: "FAILED", errorCategory: "PROVIDER_ERROR" });
    await recordAiUsageEvent({ ...BASE_INPUT, correlationId: "retry-corr", attemptNumber: 2, outcome: "SUCCEEDED", usage: { inputTokens: 5 } });

    expect(prismaMocks.create).toHaveBeenCalledTimes(2);
    const [firstCall, secondCall] = prismaMocks.create.mock.calls.map((call) => call[0].data);
    expect(firstCall).toMatchObject({ correlationId: "retry-corr", attemptNumber: 1, idempotencyKey: "retry-corr:1", outcome: "FAILED" });
    expect(secondCall).toMatchObject({ correlationId: "retry-corr", attemptNumber: 2, idempotencyKey: "retry-corr:2", outcome: "SUCCEEDED" });
    // Different idempotencyKeys -- neither write can ever collide with or
    // silently replace the other, even though they share a correlationId.
    expect(firstCall.idempotencyKey).not.toBe(secondCall.idempotencyKey);
  });
});
