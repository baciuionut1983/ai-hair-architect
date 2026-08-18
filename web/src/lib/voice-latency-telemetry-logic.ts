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

export type VoiceLatencyTerminalStage = "stt" | "consultation" | "tts" | "playback";

// Derived mechanically from `outcome` rather than sent separately by the
// client -- a second, independently-set field could drift from `outcome`
// (e.g. a client bug pairing "stt_failed" with terminalStage "tts"); this
// way the two can never disagree.
const OUTCOME_TERMINAL_STAGE: Record<VoiceLatencyTurnOutcome, VoiceLatencyTerminalStage> = {
  stt_failed: "stt",
  stt_success_not_submitted: "stt",
  consultation_failed: "consultation",
  consultation_succeeded_no_voice_reply: "consultation",
  tts_unsupported_language: "tts",
  tts_failed: "tts",
  tts_fallback_local: "tts",
  tts_completed: "playback",
};

export function terminalStageForOutcome(outcome: VoiceLatencyTurnOutcome): VoiceLatencyTerminalStage {
  return OUTCOME_TERMINAL_STAGE[outcome];
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
  "timeToPlaybackCompleteMs",
] as const;

export type VoiceLatencySummaryField = (typeof VOICE_LATENCY_SUMMARY_FIELDS)[number];

export type VoiceLatencyTelemetrySummary = Record<VoiceLatencySummaryField, number | null>;

// Terminal diagnostics for a FAILED (or otherwise non-fully-completed)
// turn -- all optional, all technical/timing-only. `errorCode` is
// whichever specific, already-existing classification code this app
// already uses (e.g. VoiceTranscriptionFailureReason, a
// ConsultationChatResultCode, a VOICE_REPLY_* error) -- bounded to a safe
// charset, never a raw provider error message or conversation content.
export interface VoiceLatencyTelemetryInput {
  attemptId: string;
  outcome: VoiceLatencyTurnOutcome;
  summary: VoiceLatencyTelemetrySummary;
  errorCode?: string;
  providerAttemptCount?: number;
  elapsedSinceMicRequestMs?: number | null;
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

// This app's own existing error-code vocabularies (VoiceTranscriptionFailureReason,
// ConsultationChatResultCode, VOICE_REPLY_* codes) are all short, fixed,
// uppercase/lowercase-letters-plus-underscore identifiers -- this bound is
// generous enough for any of them while still rejecting an attempt to
// smuggle a long, free-form string (e.g. a raw provider error message or
// conversation fragment) through this field.
const ERROR_CODE_PATTERN = /^[A-Za-z0-9_]{1,64}$/;

// Mirrors STT/Consult AI's own "at most one retry" policy (max 2 real
// attempts) with a little headroom -- rejects only an implausible value,
// never a real one.
const MAX_PLAUSIBLE_PROVIDER_ATTEMPTS = 5;

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

  // All three terminal-diagnostic fields are optional -- absent/invalid
  // simply means "not reported" (never fabricated), not a request-level
  // rejection, since they're only ever meaningful for a subset of
  // outcomes (e.g. providerAttemptCount has no meaning for a turn that
  // never reached a retryable stage at all).
  let errorCode: string | undefined;
  if (input.errorCode !== undefined) {
    if (typeof input.errorCode !== "string" || !ERROR_CODE_PATTERN.test(input.errorCode)) {
      return { ok: false, reason: "invalid_error_code" };
    }
    errorCode = input.errorCode;
  }

  let providerAttemptCount: number | undefined;
  if (input.providerAttemptCount !== undefined) {
    if (
      typeof input.providerAttemptCount !== "number" ||
      !Number.isInteger(input.providerAttemptCount) ||
      input.providerAttemptCount < 1 ||
      input.providerAttemptCount > MAX_PLAUSIBLE_PROVIDER_ATTEMPTS
    ) {
      return { ok: false, reason: "invalid_provider_attempt_count" };
    }
    providerAttemptCount = input.providerAttemptCount;
  }

  let elapsedSinceMicRequestMs: number | null | undefined;
  if (input.elapsedSinceMicRequestMs !== undefined) {
    if (input.elapsedSinceMicRequestMs === null) {
      elapsedSinceMicRequestMs = null;
    } else if (
      typeof input.elapsedSinceMicRequestMs !== "number" ||
      !Number.isFinite(input.elapsedSinceMicRequestMs) ||
      input.elapsedSinceMicRequestMs < 0 ||
      input.elapsedSinceMicRequestMs > MAX_PLAUSIBLE_DURATION_MS
    ) {
      return { ok: false, reason: "invalid_elapsed_since_mic_request_ms" };
    } else {
      elapsedSinceMicRequestMs = Math.round(input.elapsedSinceMicRequestMs);
    }
  }

  // Unknown extra keys on `summary` (or on the top-level body) are simply
  // never read, not rejected -- an allow-list extraction is exactly as
  // strict against injection/type-confusion as an exact-shape check, and
  // stays forward-compatible if a future field is added client-side before
  // the server is redeployed.
  return {
    ok: true,
    value: {
      attemptId,
      outcome: input.outcome,
      summary,
      ...(errorCode !== undefined ? { errorCode } : {}),
      ...(providerAttemptCount !== undefined ? { providerAttemptCount } : {}),
      ...(elapsedSinceMicRequestMs !== undefined ? { elapsedSinceMicRequestMs } : {}),
    },
  };
}
