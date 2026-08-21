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
  // Round 12: mirrors voice-latency-logic.ts's own new VoiceLatencySummary
  // fields exactly -- the server-side decomposition of consultationTotalMs
  // - consultationProviderMs, same pattern as TTS's own Round 7 fields.
  "consultationPreProviderMs",
  "consultationReplyWriteMs",
  "consultationFailedFirstAttemptMs",
  "consultationServerTotalMs",
  "consultationUnattributedMs",
  "consultationNetworkAndTransferMs",
  "ttsProviderMs",
  "ttsTotalMs",
  // Round 7: mirrors voice-latency-logic.ts's own new
  // VoiceLatencySummary fields exactly -- see that file's doc comment.
  "ttsPreProviderMs",
  "ttsUsageWriteMs",
  "ttsAudioProcessingMs",
  "ttsServerTotalMs",
  "ttsNetworkAndTransferMs",
  "audioPreparationMs",
  "timeToFirstAudioMs",
  "voiceTurnTotalMs",
  "timeToPlaybackCompleteMs",
  // Round 8: mirrors voice-latency-logic.ts's own new
  // VoiceLatencySummary.voiceTurnUnattributedMs exactly.
  "voiceTurnUnattributedMs",
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
  // Round 8: a comma-separated list of the HTTP header names the browser
  // actually saw on a TTS response -- see voice-latency-logic.ts's own
  // VoiceLatencyTerminalDiagnostics.ttsResponseHeaders doc comment for why
  // this exists (diagnosing why 4 of 6 Round 7 TTS timing headers read as
  // null in production despite the server computing real values for all
  // of them). Bounded to real HTTP header name characters only.
  ttsResponseHeaders?: string;
  // Round 9: the git commit SHA the CLIENT bundle was actually built from
  // (see next.config.ts's resolveBuildCommitSha) -- lets an operator
  // confirm, directly from this one log line, whether a given test really
  // ran the code a given round shipped, rather than a stale cached
  // bundle from before that deploy. A 40-char hex SHA, or "unknown" if
  // git was unavailable at build time.
  clientBuildSha?: string;
  // Round 11 (gemini-2.5-flash-lite STT evaluation): the exact STT model
  // string voice-transcript/route.ts actually resolved and used --
  // real Gemini model identifiers (letters, digits, dots, hyphens).
  sttModel?: string;
  // End-of-speech hardening (2026-08-20): see voice-activity-logic.ts's own
  // VoiceActivityDiagnostics doc comments for exactly what each of these
  // means -- never audio, never a transcript, purely technical/timing.
  vadAutoStopReason?: string;
  vadRecordingDurationMs?: number;
  vadSpeechDurationMs?: number;
  vadSilenceAfterSpeechMs?: number;
  vadSpeechDetectedAtMs?: number;
  vadSpeechEndedAtMs?: number;
  vadMaxDurationTriggered?: boolean;
  vadMode?: string;
  // STT Flash-Lite root-cause diagnosis (2026-08-20): see
  // voice-latency-logic.ts's own VoiceLatencyTerminalDiagnostics doc
  // comment on these same 3 fields for exactly what they mean and why.
  sttProviderHttpStatus?: number;
  sttProviderErrorStatus?: string;
  // STT 404 root-cause diagnosis (2026-08-21): see voice-latency-logic.ts's
  // own doc comment -- genuinely free text (Google's own diagnostic
  // message), unlike sttProviderErrorStatus's fixed vocabulary.
  sttProviderErrorMessage?: string;
  sttProviderFetchErrorName?: string;
  // Consult AI 404/PROVIDER_UNAVAILABLE root-cause diagnosis (2026-08-21):
  // see voice-latency-logic.ts's own doc comment on these same 3 fields.
  consultationProviderHttpStatus?: number;
  consultationProviderErrorStatus?: string;
  consultationProviderErrorMessage?: string;
  // Voice latency optimization audit (2026-08-21): see voice-latency-logic.ts's
  // own doc comment on this same field.
  voiceReplyTextLength?: number;
  // Consult AI provider latency variance audit (2026-08-21): see
  // voice-latency-logic.ts's own doc comment on these same 8 fields.
  consultationPromptTokens?: number;
  consultationOutputTokens?: number;
  consultationThinkingTokens?: number;
  consultationCachedTokens?: number;
  consultationHistoryMessageCount?: number;
  consultationHistoryChars?: number;
  consultationMemoryChars?: number;
  consultationInputChars?: number;
  // Consult AI voice thinking A/B (2026-08-21): see voice-latency-logic.ts's
  // own doc comment on this same field.
  consultationThinkingMode?: string;
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

// Real HTTP header names are letters/digits/hyphens only (RFC 7230 token
// chars, which this app's own header names never exceed); comma-separated
// since responseHeaderNames joins several. Bound is generous for a normal
// response's header count while still rejecting an attempt to smuggle
// anything else through this field.
const TTS_RESPONSE_HEADERS_PATTERN = /^[A-Za-z0-9,-]{0,500}$/;

// A real git SHA (full 40-char or the "unknown" fallback resolveBuildCommitSha
// returns when git itself was unavailable at build time) -- never a
// free-form string.
const CLIENT_BUILD_SHA_PATTERN = /^([A-Fa-f0-9]{7,40}|unknown)$/;

// Real Gemini model identifiers (e.g. "gemini-2.5-flash",
// "gemini-2.5-flash-lite") -- letters, digits, dots, hyphens only, never a
// free-form string.
const STT_MODEL_PATTERN = /^[A-Za-z0-9.-]{1,100}$/;

// Mirrors STT/Consult AI's own "at most one retry" policy (max 2 real
// attempts) with a little headroom -- rejects only an implausible value,
// never a real one.
const MAX_PLAUSIBLE_PROVIDER_ATTEMPTS = 5;

// Every real value voice-activity-logic.ts's VoiceActivityAutoStopReason
// can produce -- a fixed enum, never a free-form string.
const VAD_AUTO_STOP_REASONS = new Set(["continue", "stop_silence", "stop_no_speech_timeout", "stop_max_duration", "manual_stop"]);

// A real HTTP status code (100-599) -- rejects an implausible value, never
// a real one.
function isPlausibleHttpStatus(value: number): boolean {
  return Number.isInteger(value) && value >= 100 && value <= 599;
}

// Google's own canonical, short error-status vocabulary (e.g.
// "UNAVAILABLE", "NOT_FOUND", "RESOURCE_EXHAUSTED", "PERMISSION_DENIED" --
// see https://cloud.google.com/apis/design/errors#error_model) -- uppercase
// letters and underscores only, never the raw provider error message.
const PROVIDER_ERROR_STATUS_PATTERN = /^[A-Z_]{1,64}$/;

// A JS Error.prototype.name value (e.g. "TimeoutError", "TypeError",
// "AbortError") -- letters only, never a free-form message.
const PROVIDER_FETCH_ERROR_NAME_PATTERN = /^[A-Za-z]{1,64}$/;

// Matches voice-reply/route.ts's own MAX_VOICE_REPLY_TEXT_LENGTH exactly --
// duplicated (not imported) for the same reason every other constant in
// this module is, so this server-side validation stays zero-dependency on
// any specific route.
const MAX_VOICE_REPLY_TEXT_LENGTH = 4000;

// STT 404 root-cause diagnosis (2026-08-21): Google's own error.message is
// genuinely free text (e.g. "models/gemini-2.5-flash-lite is not found for
// API version v1beta, or is not supported for content generation."), unlike
// providerErrorStatus's fixed vocabulary -- already sanitized/bounded
// server-side (see voice-transcript/route.ts's sanitizeProviderErrorMessage),
// but re-checked here too since this endpoint is a public POST body a
// malicious/buggy client could send anything through, independent of the
// real STT flow. Bounded length, single line (no control characters) --
// never rejects legitimate punctuation/quotes/slashes Google's own
// diagnostic messages use.
const MAX_PROVIDER_ERROR_MESSAGE_LENGTH = 300;

function isSafeSingleLineText(value: string): boolean {
  return !/[\x00-\x1F\x7F]/.test(value);
}

// Shared bound for every vad*DurationMs/*Ms offset field -- same reasoning
// as MAX_PLAUSIBLE_DURATION_MS, reused directly since these are the same
// class of "one real voice turn" duration.
function parseOptionalDurationField(
  input: Record<string, unknown>,
  field: string,
): { ok: true; value: number | undefined } | { ok: false } {
  const raw = input[field];
  if (raw === undefined) return { ok: true, value: undefined };
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0 || raw > MAX_PLAUSIBLE_DURATION_MS) {
    return { ok: false };
  }
  return { ok: true, value: Math.round(raw) };
}

// Consult AI voice thinking A/B (2026-08-21): the fixed set of real values
// consultation-chat-provider-gemini.ts's own ConsultationChatResult.thinkingMode
// can produce -- Gemini's own thinking_level vocabulary plus the literal
// "default" sentinel, never a free-form string.
const CONSULTATION_THINKING_MODES = new Set(["MINIMAL", "LOW", "MEDIUM", "HIGH", "default"]);

// Consult AI provider latency variance audit (2026-08-21): a generous
// ceiling for character/message counts and token counts alike -- rejects
// only clearly-garbage values (e.g. a client bug sending something wildly
// out of range), never a real one. Not coupled to today's exact bounds
// (10 history messages, 12 memories, etc. in consultation-chat-service.ts)
// so a future increase there never requires touching this file.
const MAX_PLAUSIBLE_CONSULTATION_COUNT = 1_000_000;

function parseOptionalNonNegativeInteger(
  input: Record<string, unknown>,
  field: string,
): { ok: true; value: number | undefined } | { ok: false } {
  const raw = input[field];
  if (raw === undefined) return { ok: true, value: undefined };
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 0 || raw > MAX_PLAUSIBLE_CONSULTATION_COUNT) {
    return { ok: false };
  }
  return { ok: true, value: raw };
}

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

  let ttsResponseHeaders: string | undefined;
  if (input.ttsResponseHeaders !== undefined) {
    if (typeof input.ttsResponseHeaders !== "string" || !TTS_RESPONSE_HEADERS_PATTERN.test(input.ttsResponseHeaders)) {
      return { ok: false, reason: "invalid_tts_response_headers" };
    }
    ttsResponseHeaders = input.ttsResponseHeaders;
  }

  let clientBuildSha: string | undefined;
  if (input.clientBuildSha !== undefined) {
    if (typeof input.clientBuildSha !== "string" || !CLIENT_BUILD_SHA_PATTERN.test(input.clientBuildSha)) {
      return { ok: false, reason: "invalid_client_build_sha" };
    }
    clientBuildSha = input.clientBuildSha;
  }

  let sttModel: string | undefined;
  if (input.sttModel !== undefined) {
    if (typeof input.sttModel !== "string" || !STT_MODEL_PATTERN.test(input.sttModel)) {
      return { ok: false, reason: "invalid_stt_model" };
    }
    sttModel = input.sttModel;
  }

  let vadAutoStopReason: string | undefined;
  if (input.vadAutoStopReason !== undefined) {
    if (typeof input.vadAutoStopReason !== "string" || !VAD_AUTO_STOP_REASONS.has(input.vadAutoStopReason)) {
      return { ok: false, reason: "invalid_vad_auto_stop_reason" };
    }
    vadAutoStopReason = input.vadAutoStopReason;
  }

  const vadRecordingDurationMs = parseOptionalDurationField(input, "vadRecordingDurationMs");
  if (!vadRecordingDurationMs.ok) return { ok: false, reason: "invalid_vad_recording_duration_ms" };
  const vadSpeechDurationMs = parseOptionalDurationField(input, "vadSpeechDurationMs");
  if (!vadSpeechDurationMs.ok) return { ok: false, reason: "invalid_vad_speech_duration_ms" };
  const vadSilenceAfterSpeechMs = parseOptionalDurationField(input, "vadSilenceAfterSpeechMs");
  if (!vadSilenceAfterSpeechMs.ok) return { ok: false, reason: "invalid_vad_silence_after_speech_ms" };
  const vadSpeechDetectedAtMs = parseOptionalDurationField(input, "vadSpeechDetectedAtMs");
  if (!vadSpeechDetectedAtMs.ok) return { ok: false, reason: "invalid_vad_speech_detected_at_ms" };
  const vadSpeechEndedAtMs = parseOptionalDurationField(input, "vadSpeechEndedAtMs");
  if (!vadSpeechEndedAtMs.ok) return { ok: false, reason: "invalid_vad_speech_ended_at_ms" };

  let vadMaxDurationTriggered: boolean | undefined;
  if (input.vadMaxDurationTriggered !== undefined) {
    if (typeof input.vadMaxDurationTriggered !== "boolean") {
      return { ok: false, reason: "invalid_vad_max_duration_triggered" };
    }
    vadMaxDurationTriggered = input.vadMaxDurationTriggered;
  }

  let vadMode: string | undefined;
  if (input.vadMode !== undefined) {
    if (typeof input.vadMode !== "string" || !STT_MODEL_PATTERN.test(input.vadMode)) {
      return { ok: false, reason: "invalid_vad_mode" };
    }
    vadMode = input.vadMode;
  }

  let sttProviderHttpStatus: number | undefined;
  if (input.sttProviderHttpStatus !== undefined) {
    if (typeof input.sttProviderHttpStatus !== "number" || !isPlausibleHttpStatus(input.sttProviderHttpStatus)) {
      return { ok: false, reason: "invalid_stt_provider_http_status" };
    }
    sttProviderHttpStatus = input.sttProviderHttpStatus;
  }

  let sttProviderErrorStatus: string | undefined;
  if (input.sttProviderErrorStatus !== undefined) {
    if (typeof input.sttProviderErrorStatus !== "string" || !PROVIDER_ERROR_STATUS_PATTERN.test(input.sttProviderErrorStatus)) {
      return { ok: false, reason: "invalid_stt_provider_error_status" };
    }
    sttProviderErrorStatus = input.sttProviderErrorStatus;
  }

  let sttProviderErrorMessage: string | undefined;
  if (input.sttProviderErrorMessage !== undefined) {
    if (
      typeof input.sttProviderErrorMessage !== "string" ||
      input.sttProviderErrorMessage.length === 0 ||
      input.sttProviderErrorMessage.length > MAX_PROVIDER_ERROR_MESSAGE_LENGTH ||
      !isSafeSingleLineText(input.sttProviderErrorMessage)
    ) {
      return { ok: false, reason: "invalid_stt_provider_error_message" };
    }
    sttProviderErrorMessage = input.sttProviderErrorMessage;
  }

  let sttProviderFetchErrorName: string | undefined;
  if (input.sttProviderFetchErrorName !== undefined) {
    if (typeof input.sttProviderFetchErrorName !== "string" || !PROVIDER_FETCH_ERROR_NAME_PATTERN.test(input.sttProviderFetchErrorName)) {
      return { ok: false, reason: "invalid_stt_provider_fetch_error_name" };
    }
    sttProviderFetchErrorName = input.sttProviderFetchErrorName;
  }

  // Consult AI 404/PROVIDER_UNAVAILABLE root-cause diagnosis (2026-08-21):
  // same validation rules as the stt* fields above, reusing the same shared
  // helpers/patterns -- the consultation stage's own real Gemini failure
  // detail is exactly the same shape.
  let consultationProviderHttpStatus: number | undefined;
  if (input.consultationProviderHttpStatus !== undefined) {
    if (typeof input.consultationProviderHttpStatus !== "number" || !isPlausibleHttpStatus(input.consultationProviderHttpStatus)) {
      return { ok: false, reason: "invalid_consultation_provider_http_status" };
    }
    consultationProviderHttpStatus = input.consultationProviderHttpStatus;
  }

  let consultationProviderErrorStatus: string | undefined;
  if (input.consultationProviderErrorStatus !== undefined) {
    if (typeof input.consultationProviderErrorStatus !== "string" || !PROVIDER_ERROR_STATUS_PATTERN.test(input.consultationProviderErrorStatus)) {
      return { ok: false, reason: "invalid_consultation_provider_error_status" };
    }
    consultationProviderErrorStatus = input.consultationProviderErrorStatus;
  }

  let consultationProviderErrorMessage: string | undefined;
  if (input.consultationProviderErrorMessage !== undefined) {
    if (
      typeof input.consultationProviderErrorMessage !== "string" ||
      input.consultationProviderErrorMessage.length === 0 ||
      input.consultationProviderErrorMessage.length > MAX_PROVIDER_ERROR_MESSAGE_LENGTH ||
      !isSafeSingleLineText(input.consultationProviderErrorMessage)
    ) {
      return { ok: false, reason: "invalid_consultation_provider_error_message" };
    }
    consultationProviderErrorMessage = input.consultationProviderErrorMessage;
  }

  // Voice latency optimization audit (2026-08-21): a real reply's own
  // character length -- bounded to the same real ceiling voice-reply/route.ts
  // itself enforces (MAX_VOICE_REPLY_TEXT_LENGTH), never a free-form number.
  let voiceReplyTextLength: number | undefined;
  if (input.voiceReplyTextLength !== undefined) {
    if (
      typeof input.voiceReplyTextLength !== "number" ||
      !Number.isInteger(input.voiceReplyTextLength) ||
      input.voiceReplyTextLength < 0 ||
      input.voiceReplyTextLength > MAX_VOICE_REPLY_TEXT_LENGTH
    ) {
      return { ok: false, reason: "invalid_voice_reply_text_length" };
    }
    voiceReplyTextLength = input.voiceReplyTextLength;
  }

  // Consult AI provider latency variance audit (2026-08-21): see
  // voice-latency-logic.ts's own doc comment on these same 8 fields.
  const consultationPromptTokens = parseOptionalNonNegativeInteger(input, "consultationPromptTokens");
  if (!consultationPromptTokens.ok) return { ok: false, reason: "invalid_consultation_prompt_tokens" };
  const consultationOutputTokens = parseOptionalNonNegativeInteger(input, "consultationOutputTokens");
  if (!consultationOutputTokens.ok) return { ok: false, reason: "invalid_consultation_output_tokens" };
  const consultationThinkingTokens = parseOptionalNonNegativeInteger(input, "consultationThinkingTokens");
  if (!consultationThinkingTokens.ok) return { ok: false, reason: "invalid_consultation_thinking_tokens" };
  const consultationCachedTokens = parseOptionalNonNegativeInteger(input, "consultationCachedTokens");
  if (!consultationCachedTokens.ok) return { ok: false, reason: "invalid_consultation_cached_tokens" };
  const consultationHistoryMessageCount = parseOptionalNonNegativeInteger(input, "consultationHistoryMessageCount");
  if (!consultationHistoryMessageCount.ok) return { ok: false, reason: "invalid_consultation_history_message_count" };
  const consultationHistoryChars = parseOptionalNonNegativeInteger(input, "consultationHistoryChars");
  if (!consultationHistoryChars.ok) return { ok: false, reason: "invalid_consultation_history_chars" };
  const consultationMemoryChars = parseOptionalNonNegativeInteger(input, "consultationMemoryChars");
  if (!consultationMemoryChars.ok) return { ok: false, reason: "invalid_consultation_memory_chars" };
  const consultationInputChars = parseOptionalNonNegativeInteger(input, "consultationInputChars");
  if (!consultationInputChars.ok) return { ok: false, reason: "invalid_consultation_input_chars" };

  let consultationThinkingMode: string | undefined;
  if (input.consultationThinkingMode !== undefined) {
    if (typeof input.consultationThinkingMode !== "string" || !CONSULTATION_THINKING_MODES.has(input.consultationThinkingMode)) {
      return { ok: false, reason: "invalid_consultation_thinking_mode" };
    }
    consultationThinkingMode = input.consultationThinkingMode;
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
      ...(ttsResponseHeaders !== undefined ? { ttsResponseHeaders } : {}),
      ...(clientBuildSha !== undefined ? { clientBuildSha } : {}),
      ...(sttModel !== undefined ? { sttModel } : {}),
      ...(vadAutoStopReason !== undefined ? { vadAutoStopReason } : {}),
      ...(vadRecordingDurationMs.value !== undefined ? { vadRecordingDurationMs: vadRecordingDurationMs.value } : {}),
      ...(vadSpeechDurationMs.value !== undefined ? { vadSpeechDurationMs: vadSpeechDurationMs.value } : {}),
      ...(vadSilenceAfterSpeechMs.value !== undefined ? { vadSilenceAfterSpeechMs: vadSilenceAfterSpeechMs.value } : {}),
      ...(vadSpeechDetectedAtMs.value !== undefined ? { vadSpeechDetectedAtMs: vadSpeechDetectedAtMs.value } : {}),
      ...(vadSpeechEndedAtMs.value !== undefined ? { vadSpeechEndedAtMs: vadSpeechEndedAtMs.value } : {}),
      ...(vadMaxDurationTriggered !== undefined ? { vadMaxDurationTriggered } : {}),
      ...(vadMode !== undefined ? { vadMode } : {}),
      ...(sttProviderHttpStatus !== undefined ? { sttProviderHttpStatus } : {}),
      ...(sttProviderErrorStatus !== undefined ? { sttProviderErrorStatus } : {}),
      ...(sttProviderErrorMessage !== undefined ? { sttProviderErrorMessage } : {}),
      ...(sttProviderFetchErrorName !== undefined ? { sttProviderFetchErrorName } : {}),
      ...(consultationProviderHttpStatus !== undefined ? { consultationProviderHttpStatus } : {}),
      ...(consultationProviderErrorStatus !== undefined ? { consultationProviderErrorStatus } : {}),
      ...(consultationProviderErrorMessage !== undefined ? { consultationProviderErrorMessage } : {}),
      ...(voiceReplyTextLength !== undefined ? { voiceReplyTextLength } : {}),
      ...(consultationPromptTokens.value !== undefined ? { consultationPromptTokens: consultationPromptTokens.value } : {}),
      ...(consultationOutputTokens.value !== undefined ? { consultationOutputTokens: consultationOutputTokens.value } : {}),
      ...(consultationThinkingTokens.value !== undefined ? { consultationThinkingTokens: consultationThinkingTokens.value } : {}),
      ...(consultationCachedTokens.value !== undefined ? { consultationCachedTokens: consultationCachedTokens.value } : {}),
      ...(consultationHistoryMessageCount.value !== undefined
        ? { consultationHistoryMessageCount: consultationHistoryMessageCount.value }
        : {}),
      ...(consultationHistoryChars.value !== undefined ? { consultationHistoryChars: consultationHistoryChars.value } : {}),
      ...(consultationMemoryChars.value !== undefined ? { consultationMemoryChars: consultationMemoryChars.value } : {}),
      ...(consultationInputChars.value !== undefined ? { consultationInputChars: consultationInputChars.value } : {}),
      ...(consultationThinkingMode !== undefined ? { consultationThinkingMode } : {}),
    },
  };
}
