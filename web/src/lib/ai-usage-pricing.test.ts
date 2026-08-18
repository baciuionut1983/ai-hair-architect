import { afterEach, describe, expect, it } from "vitest";

import { EMPTY_PRICING_TABLE, loadPricingTable, resolveAIProviderCost, type AiUsagePricingTable } from "./ai-usage-pricing";

const ORIGINAL_ENV = process.env.AI_USAGE_PRICING_TABLE_JSON;

describe("loadPricingTable", () => {
  afterEach(() => {
    if (ORIGINAL_ENV === undefined) delete process.env.AI_USAGE_PRICING_TABLE_JSON;
    else process.env.AI_USAGE_PRICING_TABLE_JSON = ORIGINAL_ENV;
  });

  it("1. returns the empty table when unconfigured", () => {
    expect(loadPricingTable({})).toEqual(EMPTY_PRICING_TABLE);
  });

  it("2. returns the empty table for malformed JSON, never throws", () => {
    expect(loadPricingTable({ AI_USAGE_PRICING_TABLE_JSON: "{not json" })).toEqual(EMPTY_PRICING_TABLE);
  });

  it("3. returns the empty table for structurally invalid JSON (missing entries array)", () => {
    expect(loadPricingTable({ AI_USAGE_PRICING_TABLE_JSON: JSON.stringify({ version: "v1" }) })).toEqual(EMPTY_PRICING_TABLE);
  });

  it("4. returns the empty table when an entry is missing a required field", () => {
    const malformed = JSON.stringify({
      version: "v1",
      entries: [{ provider: "gemini", model: "gemini-2.5-flash" /* missing modality/currency/rate */ }],
    });
    expect(loadPricingTable({ AI_USAGE_PRICING_TABLE_JSON: malformed })).toEqual(EMPTY_PRICING_TABLE);
  });

  it("5. parses a valid configured table", () => {
    const table: AiUsagePricingTable = {
      version: "v1-2026-08-18",
      entries: [
        { provider: "gemini", model: "gemini-2.5-flash", modality: "TEXT_GENERATION", currency: "USD", rate: { inputTokenMicros: 1, outputTokenMicros: 2 } },
      ],
    };
    expect(loadPricingTable({ AI_USAGE_PRICING_TABLE_JSON: JSON.stringify(table) })).toEqual(table);
  });
});

describe("resolveAIProviderCost", () => {
  it("1. returns UNAVAILABLE when usage was never captured, regardless of pricing config", () => {
    const table: AiUsagePricingTable = {
      version: "v1",
      entries: [{ provider: "gemini", model: "gemini-2.5-flash", modality: "TEXT_GENERATION", currency: "USD", rate: { inputTokenMicros: 1 } }],
    };
    const result = resolveAIProviderCost({
      provider: "gemini",
      model: "gemini-2.5-flash",
      modality: "TEXT_GENERATION",
      usage: undefined,
      usageAvailable: false,
      pricingTable: table,
    });
    expect(result).toEqual({ estimatedCostMicros: null, currency: null, pricingVersion: "v1", costBasis: "UNAVAILABLE" });
  });

  it("2. returns UNAVAILABLE when no pricing entry matches (provider/model/modality never configured) -- never invents a price", () => {
    const result = resolveAIProviderCost({
      provider: "gemini",
      model: "gemini-2.5-flash",
      modality: "TEXT_GENERATION",
      usage: { inputTokens: 100, outputTokens: 50 },
      usageAvailable: true,
      pricingTable: EMPTY_PRICING_TABLE,
    });
    expect(result.costBasis).toBe("UNAVAILABLE");
    expect(result.estimatedCostMicros).toBeNull();
    expect(result.currency).toBeNull();
    expect(result.pricingVersion).toBe(EMPTY_PRICING_TABLE.version);
  });

  it("3. calculates a real cost from real usage against a configured rate", () => {
    const table: AiUsagePricingTable = {
      version: "v2",
      entries: [
        {
          provider: "gemini",
          model: "gemini-2.5-flash",
          modality: "TEXT_GENERATION",
          currency: "USD",
          rate: { inputTokenMicros: 10, outputTokenMicros: 30 },
        },
      ],
    };
    const result = resolveAIProviderCost({
      provider: "gemini",
      model: "gemini-2.5-flash",
      modality: "TEXT_GENERATION",
      usage: { inputTokens: 100, outputTokens: 50 },
      usageAvailable: true,
      pricingTable: table,
    });
    // 100 * 10 + 50 * 30 = 1000 + 1500 = 2500 micros
    expect(result).toEqual({ estimatedCostMicros: BigInt(2500), currency: "USD", pricingVersion: "v2", costBasis: "CALCULATED" });
  });

  it("4. only prices quantities that have BOTH a real usage number AND a configured rate", () => {
    const table: AiUsagePricingTable = {
      version: "v3",
      entries: [
        { provider: "gemini", model: "gemini-2.5-flash", modality: "STT", currency: "USD", rate: { audioInputSecondMicros: 100 } },
      ],
    };
    const result = resolveAIProviderCost({
      provider: "gemini",
      model: "gemini-2.5-flash",
      modality: "STT",
      // totalTokens has no configured rate -- must be ignored, not treated as an error.
      usage: { audioInputSeconds: 3, totalTokens: 999 },
      usageAvailable: true,
      pricingTable: table,
    });
    expect(result.estimatedCostMicros).toBe(BigInt(300));
    expect(result.costBasis).toBe("CALCULATED");
  });

  it("5. records the pricing table's own version, so a later pricing change never rewrites a historical cost's meaning", () => {
    const table: AiUsagePricingTable = {
      version: "pinned-version-xyz",
      entries: [{ provider: "gemini", model: "gemini-2.5-flash", modality: "TTS", currency: "EUR", rate: { characterMicros: 5 } }],
    };
    const result = resolveAIProviderCost({
      provider: "gemini",
      model: "gemini-2.5-flash",
      modality: "TTS",
      usage: { characterCount: 40 },
      usageAvailable: true,
      pricingTable: table,
    });
    expect(result.pricingVersion).toBe("pinned-version-xyz");
    expect(result.estimatedCostMicros).toBe(BigInt(200));
    expect(result.currency).toBe("EUR");
  });
});
