import type { AiUsageCostBasis, AiUsageModality, AiUsageOutcome } from "@prisma/client";

export type { AiUsageCostBasis, AiUsageModality, AiUsageOutcome };

// AI Usage & Cost Metering Phase 1: the provider-neutral shape every AI
// call site reports its real usage in -- deliberately named generically
// (inputTokens, not Gemini's own promptTokenCount) so a future OpenAI or
// Anthropic call site reports through this exact same shape, just
// populating different fields. Every field is optional: only the
// quantities a given modality actually produced are ever populated, never
// a fabricated 0 for a quantity that genuinely doesn't apply or wasn't
// available. See ai-usage-repository.ts for how an entirely-missing
// object (usage never captured at all) is distinguished from this object
// existing with some fields present.
export interface AiUsageQuantities {
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
  reasoningTokens?: number;
  totalTokens?: number;
  audioInputSeconds?: number;
  audioOutputSeconds?: number;
  characterCount?: number;
  imageCount?: number;
  videoSeconds?: number;
}

// The single input shape every instrumented call site builds, regardless
// of feature -- passed to recordAiUsageEvent (ai-usage-repository.ts).
// Mirrors AiUsageEvent's own columns closely by design: this is the one
// place that decides what an accounting record needs, and the schema was
// designed to fit it, not the other way around.
export interface RecordAiUsageEventInput {
  ownerUserId: string;
  // Always null today -- no real multi-stylist workspace/salon model
  // exists yet (see AiUsageEvent's own schema comment). Accepted now so
  // no call site needs to change when one is introduced.
  workspaceId?: string | null;
  clientId?: string | null;
  analysisId?: string | null;

  // A stable internal key, not a display label (e.g. "consultation_chat",
  // "image_analysis", "voice_transcript", "voice_reply") -- expected to
  // grow every time a new AI-touching capability ships, which is exactly
  // why this is a free string validated at the call site, not a Postgres
  // enum requiring a migration per new feature.
  feature: string;
  modality: AiUsageModality;
  // Identifies "one logical operation" -- every real provider call that
  // happened while attempting it (the first try, any retry, any
  // fallback) shares the same correlationId with a different
  // attemptNumber, so retries are never invisible to accounting but also
  // never double-presented as unrelated operations. Callers that have no
  // natural correlation id of their own (e.g. no ConsultationMessage id
  // yet) should generate one randomUUID() per logical operation attempt
  // and reuse it across retries of that same attempt.
  correlationId: string;
  attemptNumber?: number;
  // Only needed when a caller wants to control idempotency itself (e.g.
  // a webhook-style at-least-once redelivery); recordAiUsageEvent derives
  // a safe default from (correlationId, attemptNumber) otherwise.
  idempotencyKey?: string;

  provider: string;
  model: string;
  providerRequestId?: string | null;

  // Absent entirely means "usage was never captured" (usageAvailable
  // persists false, `usage` persists {}) -- never coerced to an object of
  // zeros, which would misrepresent a genuinely free/unmeasured call as a
  // real, zero-cost one.
  usage?: AiUsageQuantities;

  outcome: AiUsageOutcome;
  errorCategory?: string | null;
  latencyMs?: number;
}
