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
  // VAD false-negative hardening (2026-08-21): see voice-activity-logic.ts's
  // own VoiceActivityDiagnostics doc comments on these same 6 fields.
  vadPeakRms?: number;
  vadPeakSpeechBandRatio?: number;
  vadFinalNoiseFloor?: number;
  vadMaxCandidateSpeechMs?: number;
  vadCandidateResetCount?: number;
  vadFullyQualifiedSampleCount?: number;
  // VAD false-negative hardening, ROUND 2 (2026-08-22): see
  // voice-activity-logic.ts's own ROUND 2 VoiceActivityDiagnostics doc
  // comments on these same 5 fields.
  vadTotalSampleCount?: number;
  vadAmplitudeQualifiedSampleCount?: number;
  vadSpectralQualifiedSampleCount?: number;
  vadLongestCandidateGapMs?: number;
  vadPeakNoiseFloor?: number;
  // VAD false-negative hardening, ROUND 4 (2026-08-22): see
  // voice-activity-logic.ts's own ROUND 4 VoiceActivityDiagnostics doc
  // comment for exactly what this answers.
  vadWindowedCandidateSampleCount?: number;
  // VAD end-of-speech hardening, ROUND 6 (2026-08-22): see
  // voice-activity-logic.ts's own ROUND 6 VoiceActivityDiagnostics doc
  // comments for exactly what each answers.
  vadPostConfirmationSampleCount?: number;
  vadContinuationQualifiedSampleCount?: number;
  vadContinuationSpectralOnlySampleCount?: number;
  vadContinuationAmplitudeOnlySampleCount?: number;
  vadLongestPostConfirmationGapMs?: number;
  vadLastStrongEvidenceAgeAtStopMs?: number;
  // VAD start-detection hardening, ROUND 7 (2026-08-22): see
  // voice-activity-logic.ts's own ROUND 7 VoiceActivityDiagnostics doc
  // comments for exactly what each answers.
  vadAmbientSpectralRatioEstimate?: number;
  vadPeakAmbientSpectralRatioEstimate?: number;
  vadSpectralLiftQualifiedSampleCount?: number;
  // VAD start-detection hardening, ROUND 8 (2026-08-22): see
  // voice-activity-logic.ts's own ROUND 8 VoiceActivityDiagnostics doc
  // comments for exactly what each answers.
  vadLongestSpectralQualifiedRunMs?: number;
  vadSpectralQualifiedRunCount?: number;
  vadLongestFullyQualifiedRunMs?: number;
  vadFullyQualifiedRunCount?: number;
  // VAD start-detection hardening, ROUND 9 (2026-08-23): see
  // voice-activity-logic.ts's own ROUND 9 VoiceActivityDiagnostics doc
  // comment for what this answers.
  vadPeakStreakSpectralHitCount?: number;
  // VAD Round 10 (2026-08-23), Silero shadow mode, Phase A: see
  // voice-latency-logic.ts's own VoiceLatencyTerminalDiagnostics doc
  // comment for what each answers -- STRICT SHADOW MODE, diagnostic-only.
  vadModelAvailable?: boolean;
  vadModelName?: string;
  vadModelVersion?: string;
  vadModelLoadMs?: number;
  vadModelPeakSpeechProbability?: number;
  vadModelMeanSpeechProbability?: number;
  vadModelSpeechQualifiedSampleCount?: number;
  vadModelTotalSampleCount?: number;
  vadModelInferencePeakMs?: number;
  vadModelInferenceMeanMs?: number;
  vadModelSpeechProbabilityStdDev?: number;
  vadModelError?: string;
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

// VAD false-negative hardening (2026-08-21): a generous ceiling for the
// raw RMS/noise-floor levels evaluateVadSample computes -- a normalized
// time-domain amplitude that in practice never exceeds ~1.5, so this
// rejects only a clearly-garbage value, never a real one. Ratios
// (speechBandRatio) are separately bounded to their real 0..1 range at
// each call site below, not via this shared ceiling.
const MAX_PLAUSIBLE_AUDIO_LEVEL = 10;

function parseOptionalBoundedFloat(
  input: Record<string, unknown>,
  field: string,
  max: number,
): { ok: true; value: number | undefined } | { ok: false } {
  const raw = input[field];
  if (raw === undefined) return { ok: true, value: undefined };
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0 || raw > max) {
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

  // VAD false-negative hardening (2026-08-21): see
  // voice-activity-logic.ts's own VoiceActivityDiagnostics doc comments on
  // these same 6 fields.
  const vadPeakRms = parseOptionalBoundedFloat(input, "vadPeakRms", MAX_PLAUSIBLE_AUDIO_LEVEL);
  if (!vadPeakRms.ok) return { ok: false, reason: "invalid_vad_peak_rms" };
  const vadPeakSpeechBandRatio = parseOptionalBoundedFloat(input, "vadPeakSpeechBandRatio", 1);
  if (!vadPeakSpeechBandRatio.ok) return { ok: false, reason: "invalid_vad_peak_speech_band_ratio" };
  const vadFinalNoiseFloor = parseOptionalBoundedFloat(input, "vadFinalNoiseFloor", MAX_PLAUSIBLE_AUDIO_LEVEL);
  if (!vadFinalNoiseFloor.ok) return { ok: false, reason: "invalid_vad_final_noise_floor" };
  const vadMaxCandidateSpeechMs = parseOptionalDurationField(input, "vadMaxCandidateSpeechMs");
  if (!vadMaxCandidateSpeechMs.ok) return { ok: false, reason: "invalid_vad_max_candidate_speech_ms" };
  const vadCandidateResetCount = parseOptionalNonNegativeInteger(input, "vadCandidateResetCount");
  if (!vadCandidateResetCount.ok) return { ok: false, reason: "invalid_vad_candidate_reset_count" };
  const vadFullyQualifiedSampleCount = parseOptionalNonNegativeInteger(input, "vadFullyQualifiedSampleCount");
  if (!vadFullyQualifiedSampleCount.ok) return { ok: false, reason: "invalid_vad_fully_qualified_sample_count" };

  // VAD false-negative hardening, ROUND 2 (2026-08-22): see
  // voice-activity-logic.ts's own ROUND 2 VoiceActivityDiagnostics doc
  // comments on these same 5 fields.
  const vadTotalSampleCount = parseOptionalNonNegativeInteger(input, "vadTotalSampleCount");
  if (!vadTotalSampleCount.ok) return { ok: false, reason: "invalid_vad_total_sample_count" };
  const vadAmplitudeQualifiedSampleCount = parseOptionalNonNegativeInteger(input, "vadAmplitudeQualifiedSampleCount");
  if (!vadAmplitudeQualifiedSampleCount.ok) return { ok: false, reason: "invalid_vad_amplitude_qualified_sample_count" };
  const vadSpectralQualifiedSampleCount = parseOptionalNonNegativeInteger(input, "vadSpectralQualifiedSampleCount");
  if (!vadSpectralQualifiedSampleCount.ok) return { ok: false, reason: "invalid_vad_spectral_qualified_sample_count" };
  const vadLongestCandidateGapMs = parseOptionalDurationField(input, "vadLongestCandidateGapMs");
  if (!vadLongestCandidateGapMs.ok) return { ok: false, reason: "invalid_vad_longest_candidate_gap_ms" };
  const vadPeakNoiseFloor = parseOptionalBoundedFloat(input, "vadPeakNoiseFloor", MAX_PLAUSIBLE_AUDIO_LEVEL);
  if (!vadPeakNoiseFloor.ok) return { ok: false, reason: "invalid_vad_peak_noise_floor" };

  // VAD false-negative hardening, ROUND 4 (2026-08-22): see
  // voice-activity-logic.ts's own ROUND 4 VoiceActivityDiagnostics doc
  // comment for exactly what this answers.
  const vadWindowedCandidateSampleCount = parseOptionalNonNegativeInteger(input, "vadWindowedCandidateSampleCount");
  if (!vadWindowedCandidateSampleCount.ok) return { ok: false, reason: "invalid_vad_windowed_candidate_sample_count" };

  // VAD end-of-speech hardening, ROUND 6 (2026-08-22): see
  // voice-activity-logic.ts's own ROUND 6 VoiceActivityDiagnostics doc
  // comments for exactly what each answers.
  const vadPostConfirmationSampleCount = parseOptionalNonNegativeInteger(input, "vadPostConfirmationSampleCount");
  if (!vadPostConfirmationSampleCount.ok) return { ok: false, reason: "invalid_vad_post_confirmation_sample_count" };
  const vadContinuationQualifiedSampleCount = parseOptionalNonNegativeInteger(input, "vadContinuationQualifiedSampleCount");
  if (!vadContinuationQualifiedSampleCount.ok) return { ok: false, reason: "invalid_vad_continuation_qualified_sample_count" };
  const vadContinuationSpectralOnlySampleCount = parseOptionalNonNegativeInteger(input, "vadContinuationSpectralOnlySampleCount");
  if (!vadContinuationSpectralOnlySampleCount.ok) return { ok: false, reason: "invalid_vad_continuation_spectral_only_sample_count" };
  const vadContinuationAmplitudeOnlySampleCount = parseOptionalNonNegativeInteger(input, "vadContinuationAmplitudeOnlySampleCount");
  if (!vadContinuationAmplitudeOnlySampleCount.ok) return { ok: false, reason: "invalid_vad_continuation_amplitude_only_sample_count" };
  const vadLongestPostConfirmationGapMs = parseOptionalDurationField(input, "vadLongestPostConfirmationGapMs");
  if (!vadLongestPostConfirmationGapMs.ok) return { ok: false, reason: "invalid_vad_longest_post_confirmation_gap_ms" };
  const vadLastStrongEvidenceAgeAtStopMs = parseOptionalDurationField(input, "vadLastStrongEvidenceAgeAtStopMs");
  if (!vadLastStrongEvidenceAgeAtStopMs.ok) return { ok: false, reason: "invalid_vad_last_strong_evidence_age_at_stop_ms" };

  // VAD start-detection hardening, ROUND 7 (2026-08-22): see
  // voice-activity-logic.ts's own ROUND 7 VoiceActivityDiagnostics doc
  // comments for exactly what each answers.
  const vadAmbientSpectralRatioEstimate = parseOptionalBoundedFloat(input, "vadAmbientSpectralRatioEstimate", 1);
  if (!vadAmbientSpectralRatioEstimate.ok) return { ok: false, reason: "invalid_vad_ambient_spectral_ratio_estimate" };
  const vadPeakAmbientSpectralRatioEstimate = parseOptionalBoundedFloat(input, "vadPeakAmbientSpectralRatioEstimate", 1);
  if (!vadPeakAmbientSpectralRatioEstimate.ok) return { ok: false, reason: "invalid_vad_peak_ambient_spectral_ratio_estimate" };
  const vadSpectralLiftQualifiedSampleCount = parseOptionalNonNegativeInteger(input, "vadSpectralLiftQualifiedSampleCount");
  if (!vadSpectralLiftQualifiedSampleCount.ok) return { ok: false, reason: "invalid_vad_spectral_lift_qualified_sample_count" };

  // VAD start-detection hardening, ROUND 8 (2026-08-22): see
  // voice-activity-logic.ts's own ROUND 8 VoiceActivityDiagnostics doc
  // comments for exactly what each answers.
  const vadLongestSpectralQualifiedRunMs = parseOptionalDurationField(input, "vadLongestSpectralQualifiedRunMs");
  if (!vadLongestSpectralQualifiedRunMs.ok) return { ok: false, reason: "invalid_vad_longest_spectral_qualified_run_ms" };
  const vadSpectralQualifiedRunCount = parseOptionalNonNegativeInteger(input, "vadSpectralQualifiedRunCount");
  if (!vadSpectralQualifiedRunCount.ok) return { ok: false, reason: "invalid_vad_spectral_qualified_run_count" };
  const vadLongestFullyQualifiedRunMs = parseOptionalDurationField(input, "vadLongestFullyQualifiedRunMs");
  if (!vadLongestFullyQualifiedRunMs.ok) return { ok: false, reason: "invalid_vad_longest_fully_qualified_run_ms" };
  const vadFullyQualifiedRunCount = parseOptionalNonNegativeInteger(input, "vadFullyQualifiedRunCount");
  if (!vadFullyQualifiedRunCount.ok) return { ok: false, reason: "invalid_vad_fully_qualified_run_count" };

  // VAD start-detection hardening, ROUND 9 (2026-08-23): see
  // voice-activity-logic.ts's own ROUND 9 VoiceActivityDiagnostics doc
  // comment for what this answers.
  const vadPeakStreakSpectralHitCount = parseOptionalNonNegativeInteger(input, "vadPeakStreakSpectralHitCount");
  if (!vadPeakStreakSpectralHitCount.ok) return { ok: false, reason: "invalid_vad_peak_streak_spectral_hit_count" };

  // VAD Round 10 (2026-08-23), Silero shadow mode, Phase A: see
  // voice-latency-logic.ts's own VoiceLatencyTerminalDiagnostics doc
  // comment for what each answers. STRICT SHADOW MODE, diagnostic-only.
  let vadModelAvailable: boolean | undefined;
  if (input.vadModelAvailable !== undefined) {
    if (typeof input.vadModelAvailable !== "boolean") {
      return { ok: false, reason: "invalid_vad_model_available" };
    }
    vadModelAvailable = input.vadModelAvailable;
  }
  let vadModelName: string | undefined;
  if (input.vadModelName !== undefined) {
    if (typeof input.vadModelName !== "string" || !STT_MODEL_PATTERN.test(input.vadModelName)) {
      return { ok: false, reason: "invalid_vad_model_name" };
    }
    vadModelName = input.vadModelName;
  }
  let vadModelVersion: string | undefined;
  if (input.vadModelVersion !== undefined) {
    if (typeof input.vadModelVersion !== "string" || !STT_MODEL_PATTERN.test(input.vadModelVersion)) {
      return { ok: false, reason: "invalid_vad_model_version" };
    }
    vadModelVersion = input.vadModelVersion;
  }
  const vadModelLoadMs = parseOptionalDurationField(input, "vadModelLoadMs");
  if (!vadModelLoadMs.ok) return { ok: false, reason: "invalid_vad_model_load_ms" };
  const vadModelPeakSpeechProbability = parseOptionalBoundedFloat(input, "vadModelPeakSpeechProbability", 1);
  if (!vadModelPeakSpeechProbability.ok) return { ok: false, reason: "invalid_vad_model_peak_speech_probability" };
  const vadModelMeanSpeechProbability = parseOptionalBoundedFloat(input, "vadModelMeanSpeechProbability", 1);
  if (!vadModelMeanSpeechProbability.ok) return { ok: false, reason: "invalid_vad_model_mean_speech_probability" };
  const vadModelSpeechQualifiedSampleCount = parseOptionalNonNegativeInteger(input, "vadModelSpeechQualifiedSampleCount");
  if (!vadModelSpeechQualifiedSampleCount.ok) return { ok: false, reason: "invalid_vad_model_speech_qualified_sample_count" };
  const vadModelTotalSampleCount = parseOptionalNonNegativeInteger(input, "vadModelTotalSampleCount");
  if (!vadModelTotalSampleCount.ok) return { ok: false, reason: "invalid_vad_model_total_sample_count" };
  const vadModelInferencePeakMs = parseOptionalDurationField(input, "vadModelInferencePeakMs");
  if (!vadModelInferencePeakMs.ok) return { ok: false, reason: "invalid_vad_model_inference_peak_ms" };
  const vadModelInferenceMeanMs = parseOptionalDurationField(input, "vadModelInferenceMeanMs");
  if (!vadModelInferenceMeanMs.ok) return { ok: false, reason: "invalid_vad_model_inference_mean_ms" };
  const vadModelSpeechProbabilityStdDev = parseOptionalBoundedFloat(input, "vadModelSpeechProbabilityStdDev", 1);
  if (!vadModelSpeechProbabilityStdDev.ok) return { ok: false, reason: "invalid_vad_model_speech_probability_std_dev" };
  let vadModelError: string | undefined;
  if (input.vadModelError !== undefined) {
    if (
      typeof input.vadModelError !== "string" ||
      input.vadModelError.length === 0 ||
      input.vadModelError.length > MAX_PROVIDER_ERROR_MESSAGE_LENGTH ||
      !isSafeSingleLineText(input.vadModelError)
    ) {
      return { ok: false, reason: "invalid_vad_model_error" };
    }
    vadModelError = input.vadModelError;
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
      ...(vadPeakRms.value !== undefined ? { vadPeakRms: vadPeakRms.value } : {}),
      ...(vadPeakSpeechBandRatio.value !== undefined ? { vadPeakSpeechBandRatio: vadPeakSpeechBandRatio.value } : {}),
      ...(vadFinalNoiseFloor.value !== undefined ? { vadFinalNoiseFloor: vadFinalNoiseFloor.value } : {}),
      ...(vadMaxCandidateSpeechMs.value !== undefined ? { vadMaxCandidateSpeechMs: vadMaxCandidateSpeechMs.value } : {}),
      ...(vadCandidateResetCount.value !== undefined ? { vadCandidateResetCount: vadCandidateResetCount.value } : {}),
      ...(vadFullyQualifiedSampleCount.value !== undefined
        ? { vadFullyQualifiedSampleCount: vadFullyQualifiedSampleCount.value }
        : {}),
      ...(vadTotalSampleCount.value !== undefined ? { vadTotalSampleCount: vadTotalSampleCount.value } : {}),
      ...(vadAmplitudeQualifiedSampleCount.value !== undefined
        ? { vadAmplitudeQualifiedSampleCount: vadAmplitudeQualifiedSampleCount.value }
        : {}),
      ...(vadSpectralQualifiedSampleCount.value !== undefined
        ? { vadSpectralQualifiedSampleCount: vadSpectralQualifiedSampleCount.value }
        : {}),
      ...(vadLongestCandidateGapMs.value !== undefined ? { vadLongestCandidateGapMs: vadLongestCandidateGapMs.value } : {}),
      ...(vadPeakNoiseFloor.value !== undefined ? { vadPeakNoiseFloor: vadPeakNoiseFloor.value } : {}),
      ...(vadWindowedCandidateSampleCount.value !== undefined
        ? { vadWindowedCandidateSampleCount: vadWindowedCandidateSampleCount.value }
        : {}),
      ...(vadPostConfirmationSampleCount.value !== undefined
        ? { vadPostConfirmationSampleCount: vadPostConfirmationSampleCount.value }
        : {}),
      ...(vadContinuationQualifiedSampleCount.value !== undefined
        ? { vadContinuationQualifiedSampleCount: vadContinuationQualifiedSampleCount.value }
        : {}),
      ...(vadContinuationSpectralOnlySampleCount.value !== undefined
        ? { vadContinuationSpectralOnlySampleCount: vadContinuationSpectralOnlySampleCount.value }
        : {}),
      ...(vadContinuationAmplitudeOnlySampleCount.value !== undefined
        ? { vadContinuationAmplitudeOnlySampleCount: vadContinuationAmplitudeOnlySampleCount.value }
        : {}),
      ...(vadLongestPostConfirmationGapMs.value !== undefined
        ? { vadLongestPostConfirmationGapMs: vadLongestPostConfirmationGapMs.value }
        : {}),
      ...(vadLastStrongEvidenceAgeAtStopMs.value !== undefined
        ? { vadLastStrongEvidenceAgeAtStopMs: vadLastStrongEvidenceAgeAtStopMs.value }
        : {}),
      ...(vadAmbientSpectralRatioEstimate.value !== undefined
        ? { vadAmbientSpectralRatioEstimate: vadAmbientSpectralRatioEstimate.value }
        : {}),
      ...(vadPeakAmbientSpectralRatioEstimate.value !== undefined
        ? { vadPeakAmbientSpectralRatioEstimate: vadPeakAmbientSpectralRatioEstimate.value }
        : {}),
      ...(vadSpectralLiftQualifiedSampleCount.value !== undefined
        ? { vadSpectralLiftQualifiedSampleCount: vadSpectralLiftQualifiedSampleCount.value }
        : {}),
      ...(vadLongestSpectralQualifiedRunMs.value !== undefined
        ? { vadLongestSpectralQualifiedRunMs: vadLongestSpectralQualifiedRunMs.value }
        : {}),
      ...(vadSpectralQualifiedRunCount.value !== undefined
        ? { vadSpectralQualifiedRunCount: vadSpectralQualifiedRunCount.value }
        : {}),
      ...(vadLongestFullyQualifiedRunMs.value !== undefined
        ? { vadLongestFullyQualifiedRunMs: vadLongestFullyQualifiedRunMs.value }
        : {}),
      ...(vadFullyQualifiedRunCount.value !== undefined ? { vadFullyQualifiedRunCount: vadFullyQualifiedRunCount.value } : {}),
      ...(vadPeakStreakSpectralHitCount.value !== undefined
        ? { vadPeakStreakSpectralHitCount: vadPeakStreakSpectralHitCount.value }
        : {}),
      ...(vadModelAvailable !== undefined ? { vadModelAvailable } : {}),
      ...(vadModelName !== undefined ? { vadModelName } : {}),
      ...(vadModelVersion !== undefined ? { vadModelVersion } : {}),
      ...(vadModelLoadMs.value !== undefined ? { vadModelLoadMs: vadModelLoadMs.value } : {}),
      ...(vadModelPeakSpeechProbability.value !== undefined
        ? { vadModelPeakSpeechProbability: vadModelPeakSpeechProbability.value }
        : {}),
      ...(vadModelMeanSpeechProbability.value !== undefined
        ? { vadModelMeanSpeechProbability: vadModelMeanSpeechProbability.value }
        : {}),
      ...(vadModelSpeechQualifiedSampleCount.value !== undefined
        ? { vadModelSpeechQualifiedSampleCount: vadModelSpeechQualifiedSampleCount.value }
        : {}),
      ...(vadModelTotalSampleCount.value !== undefined ? { vadModelTotalSampleCount: vadModelTotalSampleCount.value } : {}),
      ...(vadModelInferencePeakMs.value !== undefined ? { vadModelInferencePeakMs: vadModelInferencePeakMs.value } : {}),
      ...(vadModelInferenceMeanMs.value !== undefined ? { vadModelInferenceMeanMs: vadModelInferenceMeanMs.value } : {}),
      ...(vadModelSpeechProbabilityStdDev.value !== undefined
        ? { vadModelSpeechProbabilityStdDev: vadModelSpeechProbabilityStdDev.value }
        : {}),
      ...(vadModelError !== undefined ? { vadModelError } : {}),
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
