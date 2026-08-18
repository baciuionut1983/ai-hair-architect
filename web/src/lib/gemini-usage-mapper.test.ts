import { describe, expect, it } from "vitest";

import { mapGeminiUsageMetadata } from "./gemini-usage-mapper";

describe("mapGeminiUsageMetadata", () => {
  it("1. maps every populated Gemini field to its provider-neutral name", () => {
    expect(
      mapGeminiUsageMetadata({
        promptTokenCount: 120,
        candidatesTokenCount: 45,
        cachedContentTokenCount: 10,
        thoughtsTokenCount: 5,
        totalTokenCount: 180,
      }),
    ).toEqual({
      inputTokens: 120,
      outputTokens: 45,
      cachedInputTokens: 10,
      reasoningTokens: 5,
      totalTokens: 180,
    });
  });

  it("2. returns undefined for a fully undefined raw metadata object (never fabricates zeros)", () => {
    expect(mapGeminiUsageMetadata(undefined)).toBeUndefined();
  });

  it("3. returns undefined for a raw object with every field absent", () => {
    expect(mapGeminiUsageMetadata({})).toBeUndefined();
  });

  it("4. omits only the unpopulated fields, keeping the ones that are present", () => {
    expect(mapGeminiUsageMetadata({ promptTokenCount: 50, totalTokenCount: 50 })).toEqual({
      inputTokens: 50,
      totalTokens: 50,
    });
  });

  it("5. treats a real zero as a real, present value, not as absent", () => {
    expect(mapGeminiUsageMetadata({ cachedContentTokenCount: 0 })).toEqual({ cachedInputTokens: 0 });
  });
});
