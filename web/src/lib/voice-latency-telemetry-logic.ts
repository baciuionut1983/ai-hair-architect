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

// VOICE NEXT LEVEL, Phase D (2026-08-24): the exact set of real values
// provider-attempt-telemetry-logic.ts's own classifyProviderAttemptOutcome
// can produce -- duplicated as a plain string literal set (not an import
// of a runtime const) to keep this file's own "unit-testable without a
// real Next.js Request, zero framework dependency" contract intact, same
// reasoning this file's own module doc comment already gives for every
// other duplicated vocabulary here (e.g. VOICE_LATENCY_SUMMARY_FIELDS
// below).
const PROVIDER_ATTEMPT_OUTCOMES = new Set([
  "success",
  "timeout",
  "http_429",
  "http_5xx",
  "http_error",
  "network_error",
  "invalid_response",
]);

// Every way a voice turn is known to conclude, matching this app's own
// sendMessage/speakMessage/finishRecording branches exactly -- an
// operator reading Railway logs can tell not just HOW LONG a turn took,
// but WHERE it actually ended, without needing the transcript or reply.
export const VOICE_LATENCY_TURN_OUTCOMES = [
  "stt_failed",
  "stt_success_not_submitted",
  // VAD Round 12 (2026-08-23): a real production report proved a
  // no-speech recording (radio/music, START correctly never confirmed)
  // still reached STT -- see voice-activity-logic.ts's own
  // hasConfirmedSpeechForSubmission doc comment. Distinct from
  // "stt_failed" on purpose: no speech was ever a provider/transcription
  // failure -- STT was never even attempted for this turn.
  "stt_skipped_no_speech",
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
  stt_skipped_no_speech: "stt",
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

// Streaming Voice Reply candidate mode (2026-08-26, DEFAULT OFF -- see
// consultation-chat-streaming-tts-integration.ts's own
// isStreamingVoiceReplyEnabled): mirrors voice-latency-logic.ts's own new
// VoiceLatencySummary fields exactly. Kept as a separate, additive
// intersection rather than folded into VOICE_LATENCY_SUMMARY_FIELDS above
// -- that array (and the uniform number|null loop it drives, below) is
// deliberately single-typed; these 10 fields are NOT all numbers (a
// delivery-mode string, an error string, two booleans), so they get their
// own individually-typed, individually-validated handling right after
// that loop instead of forcing a mixed-type value through it.
export interface VoiceLatencyStreamingSummaryFields {
  ttsDeliveryMode: "full_wav" | "streaming" | null;
  ttsChunkCount: number | null;
  ttsFirstChunkProviderMs: number | null;
  ttsFirstPlayableChunkMs: number | null;
  ttsFirstPlaybackStartedMs: number | null;
  ttsFallbackToFullUsed: boolean;
  ttsFallbackReason: string | null;
  ttsPlaybackGapMaxMs: number | null;
  ttsStreamingCompleted: boolean | null;
  ttsStreamingError: string | null;
}

export type VoiceLatencyTelemetrySummary = Record<VoiceLatencySummaryField, number | null> & VoiceLatencyStreamingSummaryFields;

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
  // VAD Round 11 (2026-08-23), Phase B: see voice-latency-logic.ts's own
  // VoiceLatencyTerminalDiagnostics doc comment for what each answers.
  vadStartGateMode?: "legacy" | "silero";
  vadStartGateModelThreshold?: number;
  vadStartGateModelQualifiedFrames?: number;
  vadStartGateModelConfirmedAtMs?: number;
  vadStartGateFallbackUsed?: boolean;
  vadStartGateFallbackReason?: "model_loading" | "model_unavailable" | "model_error";
  // VAD Round 12 (2026-08-23): see voice-latency-logic.ts's own
  // VoiceLatencyTerminalDiagnostics doc comment for what each answers.
  sttSkipped?: boolean;
  sttSkipReason?: "no_confirmed_speech";
  // VAD Round 13 (2026-08-24), Phase B.2: see voice-latency-logic.ts's own
  // VoiceLatencyTerminalDiagnostics doc comment for what each answers.
  vadModelPreloadAttempted?: boolean;
  vadModelPreloadCompleted?: boolean;
  vadModelPreloadMs?: number;
  vadModelWasPreloadedAtRecordingStart?: boolean;
  // VAD Round 14 (2026-08-24), Phase C: see voice-latency-logic.ts's own
  // VoiceLatencyTerminalDiagnostics doc comment for what each answers.
  vadContinuationMode?: "legacy" | "silero";
  vadContinuationModelThreshold?: number;
  vadContinuationModelLastSpeechAtMs?: number;
  vadContinuationModelSilenceCandidateAtMs?: number;
  vadContinuationModelSilenceConfirmedAtMs?: number;
  vadContinuationFallbackUsed?: boolean;
  vadContinuationFallbackReason?: "model_loading" | "model_unavailable" | "model_error";
  vadLegacyStopSuppressedByModelCount?: number;
  // VOICE NEXT LEVEL, Phase D (2026-08-24): see voice-latency-logic.ts's
  // own VoiceLatencyTerminalDiagnostics doc comment for what each
  // answers, and provider-attempt-telemetry-logic.ts's own doc comment
  // for the ProviderAttemptOutcome vocabulary.
  consultationAttempt1Ms?: number;
  consultationAttempt1Outcome?: string;
  consultationAttempt1HttpStatus?: number;
  consultationAttempt2Ms?: number;
  consultationAttempt2Outcome?: string;
  consultationAttempt2HttpStatus?: number;
  ttsAttempt1Ms?: number;
  ttsAttempt1Outcome?: string;
  ttsAttempt1HttpStatus?: number;
  ttsAttempt2Ms?: number;
  ttsAttempt2Outcome?: string;
  ttsAttempt2HttpStatus?: number;
  sttAttempt1Ms?: number;
  sttAttempt1Outcome?: string;
  sttAttempt1HttpStatus?: number;
  sttAttempt2Ms?: number;
  sttAttempt2Outcome?: string;
  sttAttempt2HttpStatus?: number;
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

// Streaming Voice Reply candidate mode (2026-08-26, DEFAULT OFF): the
// fixed set of real values voice-latency-logic.ts's own
// VoiceLatencySummary.ttsDeliveryMode can produce -- never a free-form
// string.
const TTS_DELIVERY_MODES = new Set(["full_wav", "streaming"]);

// A generous ceiling for a real streamed reply's chunk count (the real
// provider's own chunks were confirmed live at ~1920 bytes each -- even a
// very long reply is nowhere near this many) -- rejects only a clearly-
// garbage value, never a real one.
const MAX_PLAUSIBLE_CHUNK_COUNT = 100_000;

// Shared by every one of the 4 new nullable streaming duration fields
// (ttsFirstChunkProviderMs/ttsFirstPlayableChunkMs/ttsFirstPlaybackStartedMs/
// ttsPlaybackGapMaxMs) -- unlike parseOptionalDurationField above, this
// treats an explicit `null` the same as `undefined` (both mean "not
// measured for this turn"), matching how computeVoiceLatencySummary itself
// already emits `null` for every one of these when the corresponding
// event never happened (see that function's own doc comment) -- these
// values arrive nested inside `summary`, not as a top-level optional
// field, so they are genuinely sent as `null` on the wire for every
// full-WAV turn, never merely omitted.
function parseNullableStreamingDurationField(
  input: Record<string, unknown>,
  field: string,
): { ok: true; value: number | null } | { ok: false } {
  const raw = input[field];
  if (raw === undefined || raw === null) return { ok: true, value: null };
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0 || raw > MAX_PLAUSIBLE_DURATION_MS) {
    return { ok: false };
  }
  return { ok: true, value: Math.round(raw) };
}

// Same null-or-undefined-means-null contract as
// parseNullableStreamingDurationField above, for the one new integer COUNT
// field (ttsChunkCount) rather than a duration.
function parseNullableStreamingCountField(
  input: Record<string, unknown>,
  field: string,
  max: number,
): { ok: true; value: number | null } | { ok: false } {
  const raw = input[field];
  if (raw === undefined || raw === null) return { ok: true, value: null };
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 0 || raw > max) {
    return { ok: false };
  }
  return { ok: true, value: raw };
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

// VAD Round 11 (2026-08-23), Phase B: the fixed set of real values
// use-voice-recording.ts's own sileroStartGateToReportFields can produce
// -- see that function's own doc comment for what each means.
const VAD_START_GATE_FALLBACK_REASONS = new Set(["model_loading", "model_unavailable", "model_error"]);

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

// VOICE NEXT LEVEL, Phase D (2026-08-24): one shared parser for the
// (ms, outcome, httpStatus) triple every attempt-level field family
// (consultation/tts/stt x attempt1/attempt2) uses identically -- reused
// six times below rather than six near-duplicate blocks, so the three
// pipelines' validation can never silently drift from each other.
function parseAttemptTelemetry(
  input: Record<string, unknown>,
  msField: string,
  outcomeField: string,
  httpStatusField: string,
  reasonPrefix: string,
): { ok: true; ms: number | undefined; outcome: string | undefined; httpStatus: number | undefined } | { ok: false; reason: string } {
  const ms = parseOptionalDurationField(input, msField);
  if (!ms.ok) return { ok: false, reason: `invalid_${reasonPrefix}_ms` };
  let outcome: string | undefined;
  const rawOutcome = input[outcomeField];
  if (rawOutcome !== undefined) {
    if (typeof rawOutcome !== "string" || !PROVIDER_ATTEMPT_OUTCOMES.has(rawOutcome)) {
      return { ok: false, reason: `invalid_${reasonPrefix}_outcome` };
    }
    outcome = rawOutcome;
  }
  let httpStatus: number | undefined;
  const rawStatus = input[httpStatusField];
  if (rawStatus !== undefined) {
    if (typeof rawStatus !== "number" || !isPlausibleHttpStatus(rawStatus)) {
      return { ok: false, reason: `invalid_${reasonPrefix}_http_status` };
    }
    httpStatus = rawStatus;
  }
  return { ok: true, ms: ms.value, outcome, httpStatus };
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

  // Streaming Voice Reply candidate mode (2026-08-26, DEFAULT OFF): the 10
  // new VoiceLatencySummary fields, individually typed/validated (see
  // VoiceLatencyStreamingSummaryFields's own doc comment for why these
  // can't share the uniform number|null loop above). Still part of
  // `summary` on the wire (computeVoiceLatencySummary emits them as part
  // of the same object every other summary field lives in), so they're
  // read from the same rawSummary object, not from the top-level body.
  let ttsDeliveryMode: "full_wav" | "streaming" | null = null;
  if (rawSummary.ttsDeliveryMode !== undefined && rawSummary.ttsDeliveryMode !== null) {
    if (typeof rawSummary.ttsDeliveryMode !== "string" || !TTS_DELIVERY_MODES.has(rawSummary.ttsDeliveryMode)) {
      return { ok: false, reason: "invalid_summary_field:ttsDeliveryMode" };
    }
    ttsDeliveryMode = rawSummary.ttsDeliveryMode as "full_wav" | "streaming";
  }
  summary.ttsDeliveryMode = ttsDeliveryMode;

  const ttsChunkCount = parseNullableStreamingCountField(rawSummary, "ttsChunkCount", MAX_PLAUSIBLE_CHUNK_COUNT);
  if (!ttsChunkCount.ok) return { ok: false, reason: "invalid_summary_field:ttsChunkCount" };
  summary.ttsChunkCount = ttsChunkCount.value;

  const ttsFirstChunkProviderMs = parseNullableStreamingDurationField(rawSummary, "ttsFirstChunkProviderMs");
  if (!ttsFirstChunkProviderMs.ok) return { ok: false, reason: "invalid_summary_field:ttsFirstChunkProviderMs" };
  summary.ttsFirstChunkProviderMs = ttsFirstChunkProviderMs.value;

  const ttsFirstPlayableChunkMs = parseNullableStreamingDurationField(rawSummary, "ttsFirstPlayableChunkMs");
  if (!ttsFirstPlayableChunkMs.ok) return { ok: false, reason: "invalid_summary_field:ttsFirstPlayableChunkMs" };
  summary.ttsFirstPlayableChunkMs = ttsFirstPlayableChunkMs.value;

  const ttsFirstPlaybackStartedMs = parseNullableStreamingDurationField(rawSummary, "ttsFirstPlaybackStartedMs");
  if (!ttsFirstPlaybackStartedMs.ok) return { ok: false, reason: "invalid_summary_field:ttsFirstPlaybackStartedMs" };
  summary.ttsFirstPlaybackStartedMs = ttsFirstPlaybackStartedMs.value;

  let ttsFallbackToFullUsed = false;
  if (rawSummary.ttsFallbackToFullUsed !== undefined && rawSummary.ttsFallbackToFullUsed !== null) {
    if (typeof rawSummary.ttsFallbackToFullUsed !== "boolean") {
      return { ok: false, reason: "invalid_summary_field:ttsFallbackToFullUsed" };
    }
    ttsFallbackToFullUsed = rawSummary.ttsFallbackToFullUsed;
  }
  summary.ttsFallbackToFullUsed = ttsFallbackToFullUsed;

  let ttsFallbackReason: string | null = null;
  if (rawSummary.ttsFallbackReason !== undefined && rawSummary.ttsFallbackReason !== null) {
    if (typeof rawSummary.ttsFallbackReason !== "string" || !ERROR_CODE_PATTERN.test(rawSummary.ttsFallbackReason)) {
      return { ok: false, reason: "invalid_summary_field:ttsFallbackReason" };
    }
    ttsFallbackReason = rawSummary.ttsFallbackReason;
  }
  summary.ttsFallbackReason = ttsFallbackReason;

  const ttsPlaybackGapMaxMs = parseNullableStreamingDurationField(rawSummary, "ttsPlaybackGapMaxMs");
  if (!ttsPlaybackGapMaxMs.ok) return { ok: false, reason: "invalid_summary_field:ttsPlaybackGapMaxMs" };
  summary.ttsPlaybackGapMaxMs = ttsPlaybackGapMaxMs.value;

  let ttsStreamingCompleted: boolean | null = null;
  if (rawSummary.ttsStreamingCompleted !== undefined && rawSummary.ttsStreamingCompleted !== null) {
    if (typeof rawSummary.ttsStreamingCompleted !== "boolean") {
      return { ok: false, reason: "invalid_summary_field:ttsStreamingCompleted" };
    }
    ttsStreamingCompleted = rawSummary.ttsStreamingCompleted;
  }
  summary.ttsStreamingCompleted = ttsStreamingCompleted;

  let ttsStreamingError: string | null = null;
  if (rawSummary.ttsStreamingError !== undefined && rawSummary.ttsStreamingError !== null) {
    if (
      typeof rawSummary.ttsStreamingError !== "string" ||
      rawSummary.ttsStreamingError.length === 0 ||
      rawSummary.ttsStreamingError.length > MAX_PROVIDER_ERROR_MESSAGE_LENGTH ||
      !isSafeSingleLineText(rawSummary.ttsStreamingError)
    ) {
      return { ok: false, reason: "invalid_summary_field:ttsStreamingError" };
    }
    ttsStreamingError = rawSummary.ttsStreamingError;
  }
  summary.ttsStreamingError = ttsStreamingError;

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

  // VAD Round 11 (2026-08-23), Phase B: see voice-latency-logic.ts's own
  // VoiceLatencyTerminalDiagnostics doc comment for what each answers.
  let vadStartGateMode: "legacy" | "silero" | undefined;
  if (input.vadStartGateMode !== undefined) {
    if (input.vadStartGateMode !== "legacy" && input.vadStartGateMode !== "silero") {
      return { ok: false, reason: "invalid_vad_start_gate_mode" };
    }
    vadStartGateMode = input.vadStartGateMode;
  }
  const vadStartGateModelThreshold = parseOptionalBoundedFloat(input, "vadStartGateModelThreshold", 1);
  if (!vadStartGateModelThreshold.ok) return { ok: false, reason: "invalid_vad_start_gate_model_threshold" };
  const vadStartGateModelQualifiedFrames = parseOptionalNonNegativeInteger(input, "vadStartGateModelQualifiedFrames");
  if (!vadStartGateModelQualifiedFrames.ok) return { ok: false, reason: "invalid_vad_start_gate_model_qualified_frames" };
  const vadStartGateModelConfirmedAtMs = parseOptionalDurationField(input, "vadStartGateModelConfirmedAtMs");
  if (!vadStartGateModelConfirmedAtMs.ok) return { ok: false, reason: "invalid_vad_start_gate_model_confirmed_at_ms" };
  let vadStartGateFallbackUsed: boolean | undefined;
  if (input.vadStartGateFallbackUsed !== undefined) {
    if (typeof input.vadStartGateFallbackUsed !== "boolean") {
      return { ok: false, reason: "invalid_vad_start_gate_fallback_used" };
    }
    vadStartGateFallbackUsed = input.vadStartGateFallbackUsed;
  }
  let vadStartGateFallbackReason: "model_loading" | "model_unavailable" | "model_error" | undefined;
  if (input.vadStartGateFallbackReason !== undefined) {
    if (!VAD_START_GATE_FALLBACK_REASONS.has(input.vadStartGateFallbackReason as string)) {
      return { ok: false, reason: "invalid_vad_start_gate_fallback_reason" };
    }
    vadStartGateFallbackReason = input.vadStartGateFallbackReason as "model_loading" | "model_unavailable" | "model_error";
  }

  // VAD Round 12 (2026-08-23): see voice-latency-logic.ts's own
  // VoiceLatencyTerminalDiagnostics doc comment for what each answers.
  let sttSkipped: boolean | undefined;
  if (input.sttSkipped !== undefined) {
    if (typeof input.sttSkipped !== "boolean") {
      return { ok: false, reason: "invalid_stt_skipped" };
    }
    sttSkipped = input.sttSkipped;
  }
  let sttSkipReason: "no_confirmed_speech" | undefined;
  if (input.sttSkipReason !== undefined) {
    if (input.sttSkipReason !== "no_confirmed_speech") {
      return { ok: false, reason: "invalid_stt_skip_reason" };
    }
    sttSkipReason = input.sttSkipReason;
  }

  // VAD Round 13 (2026-08-24), Phase B.2: see voice-latency-logic.ts's own
  // VoiceLatencyTerminalDiagnostics doc comment for what each answers.
  let vadModelPreloadAttempted: boolean | undefined;
  if (input.vadModelPreloadAttempted !== undefined) {
    if (typeof input.vadModelPreloadAttempted !== "boolean") {
      return { ok: false, reason: "invalid_vad_model_preload_attempted" };
    }
    vadModelPreloadAttempted = input.vadModelPreloadAttempted;
  }
  let vadModelPreloadCompleted: boolean | undefined;
  if (input.vadModelPreloadCompleted !== undefined) {
    if (typeof input.vadModelPreloadCompleted !== "boolean") {
      return { ok: false, reason: "invalid_vad_model_preload_completed" };
    }
    vadModelPreloadCompleted = input.vadModelPreloadCompleted;
  }
  const vadModelPreloadMs = parseOptionalDurationField(input, "vadModelPreloadMs");
  if (!vadModelPreloadMs.ok) return { ok: false, reason: "invalid_vad_model_preload_ms" };
  let vadModelWasPreloadedAtRecordingStart: boolean | undefined;
  if (input.vadModelWasPreloadedAtRecordingStart !== undefined) {
    if (typeof input.vadModelWasPreloadedAtRecordingStart !== "boolean") {
      return { ok: false, reason: "invalid_vad_model_was_preloaded_at_recording_start" };
    }
    vadModelWasPreloadedAtRecordingStart = input.vadModelWasPreloadedAtRecordingStart;
  }

  // VAD Round 14 (2026-08-24), Phase C: see voice-latency-logic.ts's own
  // VoiceLatencyTerminalDiagnostics doc comment for what each answers.
  let vadContinuationMode: "legacy" | "silero" | undefined;
  if (input.vadContinuationMode !== undefined) {
    if (input.vadContinuationMode !== "legacy" && input.vadContinuationMode !== "silero") {
      return { ok: false, reason: "invalid_vad_continuation_mode" };
    }
    vadContinuationMode = input.vadContinuationMode;
  }
  const vadContinuationModelThreshold = parseOptionalBoundedFloat(input, "vadContinuationModelThreshold", 1);
  if (!vadContinuationModelThreshold.ok) return { ok: false, reason: "invalid_vad_continuation_model_threshold" };
  const vadContinuationModelLastSpeechAtMs = parseOptionalDurationField(input, "vadContinuationModelLastSpeechAtMs");
  if (!vadContinuationModelLastSpeechAtMs.ok) return { ok: false, reason: "invalid_vad_continuation_model_last_speech_at_ms" };
  const vadContinuationModelSilenceCandidateAtMs = parseOptionalDurationField(input, "vadContinuationModelSilenceCandidateAtMs");
  if (!vadContinuationModelSilenceCandidateAtMs.ok) return { ok: false, reason: "invalid_vad_continuation_model_silence_candidate_at_ms" };
  const vadContinuationModelSilenceConfirmedAtMs = parseOptionalDurationField(input, "vadContinuationModelSilenceConfirmedAtMs");
  if (!vadContinuationModelSilenceConfirmedAtMs.ok) return { ok: false, reason: "invalid_vad_continuation_model_silence_confirmed_at_ms" };
  let vadContinuationFallbackUsed: boolean | undefined;
  if (input.vadContinuationFallbackUsed !== undefined) {
    if (typeof input.vadContinuationFallbackUsed !== "boolean") {
      return { ok: false, reason: "invalid_vad_continuation_fallback_used" };
    }
    vadContinuationFallbackUsed = input.vadContinuationFallbackUsed;
  }
  let vadContinuationFallbackReason: "model_loading" | "model_unavailable" | "model_error" | undefined;
  if (input.vadContinuationFallbackReason !== undefined) {
    // Reuses VAD_START_GATE_FALLBACK_REASONS -- the same 3 real values
    // either Silero gate (START or CONTINUATION) can ever produce as a
    // fallback reason, see that const's own doc comment.
    if (!VAD_START_GATE_FALLBACK_REASONS.has(input.vadContinuationFallbackReason as string)) {
      return { ok: false, reason: "invalid_vad_continuation_fallback_reason" };
    }
    vadContinuationFallbackReason = input.vadContinuationFallbackReason as "model_loading" | "model_unavailable" | "model_error";
  }
  const vadLegacyStopSuppressedByModelCount = parseOptionalNonNegativeInteger(input, "vadLegacyStopSuppressedByModelCount");
  if (!vadLegacyStopSuppressedByModelCount.ok) return { ok: false, reason: "invalid_vad_legacy_stop_suppressed_by_model_count" };

  // VOICE NEXT LEVEL, Phase D (2026-08-24): see voice-latency-logic.ts's
  // own VoiceLatencyTerminalDiagnostics doc comment for what each
  // answers.
  const consultationAttempt1 = parseAttemptTelemetry(
    input,
    "consultationAttempt1Ms",
    "consultationAttempt1Outcome",
    "consultationAttempt1HttpStatus",
    "consultation_attempt1",
  );
  if (!consultationAttempt1.ok) return consultationAttempt1;
  const consultationAttempt2 = parseAttemptTelemetry(
    input,
    "consultationAttempt2Ms",
    "consultationAttempt2Outcome",
    "consultationAttempt2HttpStatus",
    "consultation_attempt2",
  );
  if (!consultationAttempt2.ok) return consultationAttempt2;
  const ttsAttempt1 = parseAttemptTelemetry(input, "ttsAttempt1Ms", "ttsAttempt1Outcome", "ttsAttempt1HttpStatus", "tts_attempt1");
  if (!ttsAttempt1.ok) return ttsAttempt1;
  const ttsAttempt2 = parseAttemptTelemetry(input, "ttsAttempt2Ms", "ttsAttempt2Outcome", "ttsAttempt2HttpStatus", "tts_attempt2");
  if (!ttsAttempt2.ok) return ttsAttempt2;
  const sttAttempt1 = parseAttemptTelemetry(input, "sttAttempt1Ms", "sttAttempt1Outcome", "sttAttempt1HttpStatus", "stt_attempt1");
  if (!sttAttempt1.ok) return sttAttempt1;
  const sttAttempt2 = parseAttemptTelemetry(input, "sttAttempt2Ms", "sttAttempt2Outcome", "sttAttempt2HttpStatus", "stt_attempt2");
  if (!sttAttempt2.ok) return sttAttempt2;

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
      ...(vadStartGateMode !== undefined ? { vadStartGateMode } : {}),
      ...(vadStartGateModelThreshold.value !== undefined ? { vadStartGateModelThreshold: vadStartGateModelThreshold.value } : {}),
      ...(vadStartGateModelQualifiedFrames.value !== undefined
        ? { vadStartGateModelQualifiedFrames: vadStartGateModelQualifiedFrames.value }
        : {}),
      ...(vadStartGateModelConfirmedAtMs.value !== undefined
        ? { vadStartGateModelConfirmedAtMs: vadStartGateModelConfirmedAtMs.value }
        : {}),
      ...(vadStartGateFallbackUsed !== undefined ? { vadStartGateFallbackUsed } : {}),
      ...(vadStartGateFallbackReason !== undefined ? { vadStartGateFallbackReason } : {}),
      ...(sttSkipped !== undefined ? { sttSkipped } : {}),
      ...(sttSkipReason !== undefined ? { sttSkipReason } : {}),
      ...(vadModelPreloadAttempted !== undefined ? { vadModelPreloadAttempted } : {}),
      ...(vadModelPreloadCompleted !== undefined ? { vadModelPreloadCompleted } : {}),
      ...(vadModelPreloadMs.value !== undefined ? { vadModelPreloadMs: vadModelPreloadMs.value } : {}),
      ...(vadModelWasPreloadedAtRecordingStart !== undefined ? { vadModelWasPreloadedAtRecordingStart } : {}),
      ...(vadContinuationMode !== undefined ? { vadContinuationMode } : {}),
      ...(vadContinuationModelThreshold.value !== undefined
        ? { vadContinuationModelThreshold: vadContinuationModelThreshold.value }
        : {}),
      ...(vadContinuationModelLastSpeechAtMs.value !== undefined
        ? { vadContinuationModelLastSpeechAtMs: vadContinuationModelLastSpeechAtMs.value }
        : {}),
      ...(vadContinuationModelSilenceCandidateAtMs.value !== undefined
        ? { vadContinuationModelSilenceCandidateAtMs: vadContinuationModelSilenceCandidateAtMs.value }
        : {}),
      ...(vadContinuationModelSilenceConfirmedAtMs.value !== undefined
        ? { vadContinuationModelSilenceConfirmedAtMs: vadContinuationModelSilenceConfirmedAtMs.value }
        : {}),
      ...(vadContinuationFallbackUsed !== undefined ? { vadContinuationFallbackUsed } : {}),
      ...(vadContinuationFallbackReason !== undefined ? { vadContinuationFallbackReason } : {}),
      ...(vadLegacyStopSuppressedByModelCount.value !== undefined
        ? { vadLegacyStopSuppressedByModelCount: vadLegacyStopSuppressedByModelCount.value }
        : {}),
      // VOICE NEXT LEVEL, Phase D (2026-08-24): see voice-latency-logic.ts's
      // own VoiceLatencyTerminalDiagnostics doc comment for what each
      // answers.
      ...(consultationAttempt1.ms !== undefined ? { consultationAttempt1Ms: consultationAttempt1.ms } : {}),
      ...(consultationAttempt1.outcome !== undefined ? { consultationAttempt1Outcome: consultationAttempt1.outcome } : {}),
      ...(consultationAttempt1.httpStatus !== undefined ? { consultationAttempt1HttpStatus: consultationAttempt1.httpStatus } : {}),
      ...(consultationAttempt2.ms !== undefined ? { consultationAttempt2Ms: consultationAttempt2.ms } : {}),
      ...(consultationAttempt2.outcome !== undefined ? { consultationAttempt2Outcome: consultationAttempt2.outcome } : {}),
      ...(consultationAttempt2.httpStatus !== undefined ? { consultationAttempt2HttpStatus: consultationAttempt2.httpStatus } : {}),
      ...(ttsAttempt1.ms !== undefined ? { ttsAttempt1Ms: ttsAttempt1.ms } : {}),
      ...(ttsAttempt1.outcome !== undefined ? { ttsAttempt1Outcome: ttsAttempt1.outcome } : {}),
      ...(ttsAttempt1.httpStatus !== undefined ? { ttsAttempt1HttpStatus: ttsAttempt1.httpStatus } : {}),
      ...(ttsAttempt2.ms !== undefined ? { ttsAttempt2Ms: ttsAttempt2.ms } : {}),
      ...(ttsAttempt2.outcome !== undefined ? { ttsAttempt2Outcome: ttsAttempt2.outcome } : {}),
      ...(ttsAttempt2.httpStatus !== undefined ? { ttsAttempt2HttpStatus: ttsAttempt2.httpStatus } : {}),
      ...(sttAttempt1.ms !== undefined ? { sttAttempt1Ms: sttAttempt1.ms } : {}),
      ...(sttAttempt1.outcome !== undefined ? { sttAttempt1Outcome: sttAttempt1.outcome } : {}),
      ...(sttAttempt1.httpStatus !== undefined ? { sttAttempt1HttpStatus: sttAttempt1.httpStatus } : {}),
      ...(sttAttempt2.ms !== undefined ? { sttAttempt2Ms: sttAttempt2.ms } : {}),
      ...(sttAttempt2.outcome !== undefined ? { sttAttempt2Outcome: sttAttempt2.outcome } : {}),
      ...(sttAttempt2.httpStatus !== undefined ? { sttAttempt2HttpStatus: sttAttempt2.httpStatus } : {}),
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
