import type { AiUsageQuantities } from "./ai-usage-contracts";

// AI Usage & Cost Metering Phase 1: the one place Gemini's own
// usageMetadata field names (confirmed against this app's actually-
// installed @google/genai SDK type declarations, not just public docs --
// see GenerateContentResponseUsageMetadata) get translated into this
// app's provider-neutral AiUsageQuantities shape. Shared by all three
// Gemini call sites (consultation-chat-provider-gemini.ts,
// image-analysis-provider-gemini.ts, tts-provider-gemini.ts) plus the
// direct-REST voice-transcript route, so this mapping has exactly one
// source of truth rather than being re-derived slightly differently four
// times.
export interface GeminiRawUsageMetadata {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  cachedContentTokenCount?: number;
  thoughtsTokenCount?: number;
  totalTokenCount?: number;
}

export function mapGeminiUsageMetadata(raw: GeminiRawUsageMetadata | undefined): AiUsageQuantities | undefined {
  if (!raw) return undefined;

  const quantities: AiUsageQuantities = {};
  if (typeof raw.promptTokenCount === "number") quantities.inputTokens = raw.promptTokenCount;
  if (typeof raw.candidatesTokenCount === "number") quantities.outputTokens = raw.candidatesTokenCount;
  if (typeof raw.cachedContentTokenCount === "number") quantities.cachedInputTokens = raw.cachedContentTokenCount;
  if (typeof raw.thoughtsTokenCount === "number") quantities.reasoningTokens = raw.thoughtsTokenCount;
  if (typeof raw.totalTokenCount === "number") quantities.totalTokens = raw.totalTokenCount;

  // Gemini's own usageMetadata object can be present but structurally
  // empty (all fields undefined) -- treated identically to "no usage
  // metadata at all" so a caller never has to special-case an empty
  // object vs. a missing one.
  return Object.keys(quantities).length > 0 ? quantities : undefined;
}
