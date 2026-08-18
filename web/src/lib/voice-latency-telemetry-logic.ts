// Voice latency audit follow-up (2026-08-19): the ROOT CAUSE of "no VOICE
// LATENCY SUMMARY in Railway Deploy Logs" is that the previous round's
// summary was only ever computed and console.log'd inside "use client"
// components (use-voice-recording.ts, consultation-chat.tsx) -- that output
// runs in the stylist's own browser and never reaches the Node server
// process, so it can never appear in Railway's logs regardless of search
// string. This module is the STRICT, pure validation contract for the new
// POST /api/v1/clients/[id]/voice-latency endpoint that closes that gap:
// it accepts ONLY an attemptId, a fixed-enum outcome, and the 12 already-
// documented timing numbers (see voice-latency-logic.ts's own
// VoiceLatencySummary) -- never audio, never a transcript, never AI reply
// text, never any other field. Kept here (not inline in the route) so it
// can be unit-tested without a real Next.js Request, matching this
// codebase's established "-logic.ts" convention.

// Every way a voice turn is known to conclude, matching this app's own
// sendMessage/speakMessage/finishRecording branches exactly -- an
// operator reading Railway logs can tell not just HOW LONG a turn took,
// but WHERE it actually ended, without needing the transcript or reply.
export const VOICE_LATENCY_TURN_OUTCOMES = [
  "stt_failed",
  "stt_success_not_submitted",
  "consultation_failed",
  "consultation_succeeded_no_voice_reply",
  "tts_unsupported_language",
  "tts_failed",
  "tts_fallback_local",
  "tts_completed",
] as const;

export type VoiceLatencyTurnOutcome = (typeof VOICE_LATENCY_TURN_OUTCOMES)[number];

function isVoiceLatencyTurnOutcome(value: unknown): value is VoiceLatencyTurnOutcome {
  return typeof value === "string" && (VOICE_LATENCY_TURN_OUTCOMES as readonly string[]).includes(value);
}

// Mirrors VoiceLatencySummary's own field names exactly (see
// voice-latency-logic.ts) -- duplicated here rather than imported so this
// server-side validation module has zero dependency on a "use client" file.
const VOICE_LATENCY_SUMMARY_FIELDS = [
  "recordingFinalizeMs",
  "conversionMs",
  "sttNetworkAndServerMs",
  "sttProviderMs",
  "sttTotalMs",
  "consultationProviderMs",
  "consultationTotalMs",
  "ttsProviderMs",
  "ttsTotalMs",
  "audioPreparationMs",
  "timeToFirstAudioMs",
  "voiceTurnTotalMs",
] as const;

export type VoiceLatencySummaryField = (typeof VOICE_LATENCY_SUMMARY_FIELDS)[number];

export type VoiceLatencyTelemetrySummary = Record<VoiceLatencySummaryField, number | null>;

export interface VoiceLatencyTelemetryInput {
  attemptId: string;
  outcome: VoiceLatencyTurnOutcome;
  summary: VoiceLatencyTelemetrySummary;
}

export type VoiceLatencyTelemetryValidationResult =
  | { ok: true; value: VoiceLatencyTelemetryInput }
  | { ok: false; reason: string };

// Covers both generateAttemptId() formats already in use (a real
// crypto.randomUUID() string, or the "attempt-<ms>-<random>" fallback for
// browsers without it) -- a safe, bounded charset, never a free-form string.
const ATTEMPT_ID_PATTERN = /^[A-Za-z0-9-]{1,100}$/;

// A generous upper bound for one real voice turn (a genuinely slow Gemini
// call could take tens of seconds; this rejects only clearly-garbage
// values -- overflow, a client bug sending milliseconds-since-epoch by
// mistake -- without ever blocking a real, if slow, measurement).
const MAX_PLAUSIBLE_DURATION_MS = 5 * 60 * 1000;

export function parseVoiceLatencyTelemetryPayload(body: unknown): VoiceLatencyTelemetryValidationResult {
  if (typeof body !== "object" || body === null) {
    return { ok: false, reason: "not_an_object" };
  }
  const input = body as Record<string, unknown>;

  const attemptId = input.attemptId;
  if (typeof attemptId !== "string" || !ATTEMPT_ID_PATTERN.test(attemptId)) {
    return { ok: false, reason: "invalid_attempt_id" };
  }

  if (!isVoiceLatencyTurnOutcome(input.outcome)) {
    return { ok: false, reason: "invalid_outcome" };
  }

  if (typeof input.summary !== "object" || input.summary === null) {
    return { ok: false, reason: "invalid_summary" };
  }
  const rawSummary = input.summary as Record<string, unknown>;

  const summary = {} as VoiceLatencyTelemetrySummary;
  for (const field of VOICE_LATENCY_SUMMARY_FIELDS) {
    const value = rawSummary[field];
    if (value === null || value === undefined) {
      summary[field] = null;
      continue;
    }
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > MAX_PLAUSIBLE_DURATION_MS) {
      return { ok: false, reason: `invalid_summary_field:${field}` };
    }
    // Whole milliseconds only -- matches voice-latency-logic.ts's own
    // computeVoiceLatencySummary rounding, never sub-millisecond noise.
    summary[field] = Math.round(value);
  }

  // Unknown extra keys on `summary` (or on the top-level body) are simply
  // never read, not rejected -- an allow-list extraction is exactly as
  // strict against injection/type-confusion as an exact-shape check, and
  // stays forward-compatible if a future field is added client-side before
  // the server is redeployed.
  return { ok: true, value: { attemptId, outcome: input.outcome, summary } };
}
