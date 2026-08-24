"use client";

// A microphone entry point for the NORMAL chat composer (Consult AI's "Type
// a message" box) -- structurally separate from Teach the AI's own
// recording orchestration in teach-ai-panel.tsx (left untouched, to avoid
// any regression risk to its already live-validated flow), but reusing the
// exact same core STT logic (finishRecording/bindFetch/logClient from
// teach-ai-panel-logic.ts) rather than duplicating a second parallel
// system. This hook is never imported by teach-ai-panel.tsx, and
// teach-ai-panel.tsx's own recorder/chunks refs are never shared with it --
// the only thing shared is the stateless transcription call itself.
//
// Isolation guarantee: this hook only ever calls the caller's own
// onTranscript callback, and ONLY with a real, non-empty transcript (see
// shouldAutoSubmitTranscript) -- it has no knowledge of Teach the AI's
// draft/transcriptId state, never calls its save endpoint, and never
// proposes or saves a ProfessionalMemory.
//
// Natural-conversation upgrade: recording now auto-stops on its own after
// ~2s of silence following detected speech (Voice Activity Detection, via
// Web Audio API's AnalyserNode -- see voice-activity-logic.ts for the pure,
// unit-tested stop/no-stop decision itself; this file only supplies the
// real audio-level samples, which cannot be unit tested without a browser).
// The caller is expected to auto-submit whenever onTranscript fires --
// this hook fires it identically whether the recording ended by VAD or by
// a manual Stop click, so both behave the same way ("Stop manual încă
// funcționează", not a second, different code path).

import { useCallback, useEffect, useRef, useState } from "react";

import type { LanguageCode } from "@/lib/language-registry";
import type { ProviderAttemptTelemetry } from "@/lib/provider-attempt-telemetry-logic";
import type { TranslationKey } from "@/lib/translations";

import { decodeBlobAsWav } from "./audio-wav-encode";
import {
  DEFAULT_SILERO_CONTINUATION_GATE_CONFIG,
  initSileroContinuationGateState,
  resolveSileroContinuationAuthority,
} from "./silero-continuation-gate-logic";
import { DEFAULT_SILERO_START_GATE_CONFIG, resolveSileroStartAuthority } from "./silero-start-gate-logic";
import { summarizeSileroShadowDiagnostics, type SileroShadowDiagnosticsState } from "./silero-vad-shadow-logic";
import {
  getSileroPreloadTelemetry,
  preloadSileroModel,
  startSileroVadShadow,
  type SileroPreloadTelemetry,
  type SileroShadowModelInfo,
} from "./silero-vad-shadow-runtime";
import {
  bindFetch,
  classifyMicrophoneStartError,
  finishRecording,
  generateAttemptId,
  logClient,
  type VoiceTranscriptionFailureReason,
} from "./teach-ai-panel-logic";
import {
  computeVoiceActivityDiagnostics,
  evaluateVadSample,
  hasConfirmedSpeechForSubmission,
  initVadState,
  shouldAutoSubmitTranscript,
  type VadState,
  type VoiceActivityAutoStopReason,
  type VoiceActivityDiagnostics,
} from "./voice-activity-logic";
import {
  computeElapsedSinceMicRequestMs,
  computeVoiceLatencySummary,
  logVoiceLatencySummary,
  markVoiceLatencyStage,
  mergeVoiceLatencyMarks,
  reportVoiceLatencySummary,
  type VoiceLatencyMarks,
  type VoiceLatencyTerminalDiagnostics,
} from "./voice-latency-logic";

const AUDIO_LEVEL_SAMPLE_INTERVAL_MS = 100;
// End-of-speech hardening (2026-08-20): bumped from 512 -> 1024 for finer
// frequency-bin resolution, needed by computeSpeechBandRatio below to
// isolate the ~300-3400 Hz speech band cleanly. Still a tiny, cheap FFT --
// this analysis runs at most 10 times/second (AUDIO_LEVEL_SAMPLE_INTERVAL_MS),
// nowhere near enough for the doubled bin count to be CPU-meaningful on any
// device this app targets.
const ANALYSER_FFT_SIZE = 1024;
// The ~300-3400 Hz "telephony band" -- a standard signal-processing range
// known to capture the large majority of speech intelligibility (the
// fundamental plus the first few formants for most voices). Real ambient
// sources this product's own salon environment contains -- music, a hair
// dryer, general room hum -- typically do NOT concentrate energy here the
// way a voice does; see voice-activity-logic.ts's own module comment for
// the full reasoning.
const SPEECH_BAND_MIN_HZ = 300;
const SPEECH_BAND_MAX_HZ = 3400;
// Identifies which VAD algorithm version produced a given telemetry
// report -- lets a future round's production data be filtered/compared
// against the OLD amplitude-only classifier's own historical reports
// without ambiguity.
const VAD_MODE = "heuristic-rms-spectral-v1";

// VAD Round 11 (2026-08-23), Phase B: build-time flag (NEXT_PUBLIC_* vars
// are inlined at build time, same mechanism as NEXT_PUBLIC_APP_COMMIT_SHA
// in next.config.ts -- toggling this requires a rebuild, not just a
// runtime env change) controlling whether Silero's own START gate (see
// silero-start-gate-logic.ts) gets to decide hasDetectedSpeech, or
// whether the existing heuristic (voice-activity-logic.ts) stays fully
// authoritative exactly as it was before Phase B, i.e. Phase A's own
// shadow-only behavior. OFF by default (undefined !== "true") -- Phase B
// must be explicitly enabled, never silently active.
//
// SCOPE (this round's own explicit constraint): this flag affects ONLY
// which signal is allowed to flip hasDetectedSpeech from false to true.
// Once true (by either authority), voice-activity-logic.ts's own existing
// continuation/silence-countdown/stop machinery governs completely
// unchanged -- this flag is never consulted again for the rest of that
// recording. See the interval loop below for the exact authority rule:
// Silero confirms when healthy (loaded, no runtime errors), the
// heuristic's own unmodified confirmation is the fallback whenever Silero
// is still loading, failed to load, or has thrown a runtime error --
// "model failure != microphone failure" holds exactly as it does for
// Phase A's own shadow mode.
const SILERO_START_GATE_ENABLED = process.env.NEXT_PUBLIC_VAD_SILERO_START_GATE_ENABLED === "true";

// VAD Round 14 (2026-08-24), Phase C: a SEPARATE build-time flag from
// SILERO_START_GATE_ENABLED above -- Phase C is its own, independently
// toggleable rollout, per this round's own explicit "flag separat"
// requirement. OFF by default, matching every prior Silero flag in this
// saga.
//
// SCOPE: this flag affects ONLY which signal is allowed to declare
// CONTINUATION/end-of-speech, and ONLY once hasDetectedSpeech is already
// true (by either authority -- Phase B's Silero START gate, or the
// legacy heuristic, independent of whether Phase B's own flag is on).
// See silero-continuation-gate-logic.ts's own resolveSileroContinuationAuthority
// for the exact rule: Silero becomes authoritative when healthy, the
// heuristic's own unmodified continuation decision is the fallback
// whenever Silero is still loading, failed to load, or has thrown a
// runtime error -- "model failure != microphone failure" holds exactly as
// it does for Phase A/B. OFF reproduces Phase B/B.2 behavior exactly (the
// heuristic's own continuation/silence-countdown/stop machinery, fully
// unmodified, stays the sole authority for anything after START).
const SILERO_CONTINUATION_ENABLED = process.env.NEXT_PUBLIC_VAD_SILERO_CONTINUATION_ENABLED === "true";

// Voice reliability hardening (2026-08-18): maps finishRecording's own
// honest failure reason to this app's centralized i18n dictionary (see
// translations.ts's consultAi.voiceError.* keys) -- the caller's `t`
// translates it into the stylist's own UI language. A getUserMedia/
// MediaRecorder unsupported-browser failure (never reaches finishRecording
// at all) reuses "microphoneUnavailable": from the stylist's point of
// view, "voice input doesn't work here" and "the mic isn't available" are
// the same honest situation.
function translationKeyForReason(reason: VoiceTranscriptionFailureReason): TranslationKey {
  switch (reason) {
    case "providerUnavailable":
      return "consultAi.voiceError.providerUnavailable";
    case "saveUnavailable":
      return "consultAi.voiceError.saveUnavailable";
    case "unsupportedFormat":
      return "consultAi.voiceError.unsupportedFormat";
    case "invalidAudio":
      return "consultAi.voiceError.invalidAudio";
    case "emptyRecording":
      return "consultAi.voiceError.emptyRecording";
    case "unknown":
    default:
      return "consultAi.voiceError.unknown";
  }
}

export interface UseVoiceRecordingOptions {
  clientId: string;
  // The current STT language hint (mirrors the conversation's language
  // selector) -- forwarded straight through to finishRecording's own
  // trailing optional param, prompt-text-only, never a forced constraint.
  language?: LanguageCode;
  // The app's own UI-language translator (see useUiLanguage) -- every
  // stylist-facing failure message this hook produces is translated
  // through it, never a hardcoded English string, so a stylist working in
  // any of the app's supported UI languages sees an honest message in
  // their own language, not just en/ro.
  t: (key: TranslationKey) => string;
  // Fired ONLY with a real, non-empty transcript -- never for a failed
  // transcription, never for an empty one. The caller is expected to treat
  // this as "the stylist finished speaking a real message" and act on it
  // immediately (e.g. auto-submit), same as a typed Send.
  //
  // Voice latency audit (2026-08-18): `latency` carries the mic+STT phase
  // marks/attemptId for this exact turn, so the caller (consultation-
  // chat.tsx) can continue the SAME turn's instrumentation through
  // Consult AI and TTS, ending in one combined VOICE_LATENCY summary --
  // see voice-latency-logic.ts's own module comment for why this is
  // threaded through callbacks rather than a shared event bus.
  onTranscript: (transcript: string, latency: VoiceTurnLatencyInfo) => void;
}

export interface VoiceTurnLatencyInfo {
  attemptId: string;
  marks: VoiceLatencyMarks;
  sttProviderMs: number | null;
  // Round 11 (gemini-2.5-flash-lite STT evaluation): the server's own
  // resolved STT model string, never fabricated when absent.
  sttModel: string | null;
  // End-of-speech hardening (2026-08-20): null only when VAD itself never
  // ran for this attempt (setup failed -- see the try/catch in
  // toggleRecording), never fabricated.
  vadDiagnostics: VoiceActivityDiagnostics | null;
  // VAD Round 10 (2026-08-23), Silero shadow mode, Phase A: carried
  // through to consultation-chat.tsx the same way vadDiagnostics already
  // is, so the SAME final VOICE_LATENCY report (after Consult AI/TTS)
  // includes the shadow detector's own diagnostics for a successful turn,
  // not just the early-failure branches inside this file. Null whenever
  // shadow mode was never attempted for this recording -- never fabricated.
  sileroShadow: SileroShadowReportData | null;
  // VAD Round 11 (2026-08-23), Phase B: carried through to
  // consultation-chat.tsx the same way sileroShadow already is. Null
  // whenever SILERO_START_GATE_ENABLED was off for this build.
  sileroStartGate: SileroStartGateReportContext | null;
  // VAD Round 14 (2026-08-24), Phase C: carried through the same way as
  // sileroStartGate, for the same reason. Null whenever
  // SILERO_CONTINUATION_ENABLED was off for this build.
  sileroContinuation: SileroContinuationReportContext | null;
  // VOICE NEXT LEVEL, Phase D (2026-08-24): STT's own per-attempt
  // telemetry -- see teach-ai-panel-logic.ts's own UploadAttemptResult.telemetry
  // doc comment. attempt2 undefined whenever no retry happened.
  sttAttempt1?: ProviderAttemptTelemetry;
  sttAttempt2?: ProviderAttemptTelemetry;
}

export interface UseVoiceRecordingResult {
  // True only while actively capturing audio -- drives the Mic/Square
  // button icon and whether a manual Stop click does anything.
  recording: boolean;
  // True while the recorded audio is being transcribed (no audio capture
  // happening anymore, but not yet ready to record again either).
  processing: boolean;
  // The last recording/transcription failure, if any (unsupported
  // browser, permission denied, transcription failed) -- cleared the next
  // time the mic is pressed. Distinct from a status label: this is
  // specifically something that went wrong.
  error: string | null;
  toggleRecording: () => void;
}

type AudioContextConstructor = new () => AudioContext;

function resolveAudioContextConstructor(): AudioContextConstructor | null {
  if (typeof window === "undefined") return null;
  const w = window as typeof window & { webkitAudioContext?: AudioContextConstructor };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

function computeRmsLevel(analyser: AnalyserNode, buffer: Uint8Array<ArrayBuffer>): number {
  analyser.getByteTimeDomainData(buffer);
  let sumSquares = 0;
  for (let i = 0; i < buffer.length; i += 1) {
    const normalized = (buffer[i] - 128) / 128;
    sumSquares += normalized * normalized;
  }
  return Math.sqrt(sumSquares / buffer.length);
}

// End-of-speech hardening (2026-08-20): the second, independent signal
// voice-activity-logic.ts's evaluateVadSample needs -- see that module's
// own doc comment for why amplitude alone (computeRmsLevel above) cannot
// tell a stylist's voice apart from sustained ambient background music.
// Reuses the SAME AnalyserNode already sampled for RMS, just its
// frequency-domain output (getByteFrequencyData) instead of time-domain --
// no new browser API, no new dependency. Returns 0 (never speech-shaped)
// when there is no energy at all to compute a ratio from, rather than
// dividing by zero.
function computeSpeechBandRatio(analyser: AnalyserNode, audioContext: AudioContext, freqBuffer: Uint8Array<ArrayBuffer>): number {
  analyser.getByteFrequencyData(freqBuffer);
  const binHz = audioContext.sampleRate / analyser.fftSize;
  const minBin = Math.max(0, Math.floor(SPEECH_BAND_MIN_HZ / binHz));
  const maxBin = Math.min(freqBuffer.length - 1, Math.ceil(SPEECH_BAND_MAX_HZ / binHz));

  let speechBandEnergy = 0;
  let totalEnergy = 0;
  for (let i = 0; i < freqBuffer.length; i += 1) {
    const magnitude = freqBuffer[i];
    totalEnergy += magnitude;
    if (i >= minBin && i <= maxBin) {
      speechBandEnergy += magnitude;
    }
  }
  return totalEnergy > 0 ? speechBandEnergy / totalEnergy : 0;
}

// VOICE NEXT LEVEL, Phase D (2026-08-24): maps STT's own per-attempt
// telemetry (see teach-ai-panel-logic.ts's own UploadAttemptResult.telemetry
// doc comment) onto reportVoiceLatencySummary's own flat, sttAttempt*
// fields -- {} for attempt2 when no retry ever happened, never a
// fabricated placeholder.
function sttAttemptReportFields(
  attempt1: ProviderAttemptTelemetry | undefined,
  attempt2: ProviderAttemptTelemetry | undefined,
): Partial<VoiceLatencyTerminalDiagnostics> {
  return {
    ...(attempt1 ? { sttAttempt1Ms: attempt1.ms, sttAttempt1Outcome: attempt1.outcome, ...(attempt1.httpStatus !== undefined ? { sttAttempt1HttpStatus: attempt1.httpStatus } : {}) } : {}),
    ...(attempt2 ? { sttAttempt2Ms: attempt2.ms, sttAttempt2Outcome: attempt2.outcome, ...(attempt2.httpStatus !== undefined ? { sttAttempt2HttpStatus: attempt2.httpStatus } : {}) } : {}),
  };
}

// End-of-speech hardening (2026-08-20), Task E: maps the pure
// VoiceActivityDiagnostics shape onto reportVoiceLatencySummary's own flat,
// vad-prefixed diagnostic fields -- {} (nothing added) when VAD never ran
// at all for this attempt (setup failed, see the try/catch below), never
// fabricated zeros.
export function vadDiagnosticsToReportFields(diagnostics: VoiceActivityDiagnostics | null): Partial<VoiceLatencyTerminalDiagnostics> {
  if (!diagnostics) return {};
  return {
    vadAutoStopReason: diagnostics.autoStopReason ?? undefined,
    vadRecordingDurationMs: diagnostics.recordingDurationMs ?? undefined,
    vadSpeechDurationMs: diagnostics.speechDurationMs ?? undefined,
    vadSilenceAfterSpeechMs: diagnostics.silenceAfterSpeechMs ?? undefined,
    vadSpeechDetectedAtMs: diagnostics.speechDetectedAtMs ?? undefined,
    vadSpeechEndedAtMs: diagnostics.speechEndedAtMs ?? undefined,
    vadMaxDurationTriggered: diagnostics.maxDurationTriggered,
    vadMode: diagnostics.vadMode,
    // VAD false-negative hardening (2026-08-21): see
    // VoiceActivityDiagnostics's own doc comments for what each answers.
    vadPeakRms: diagnostics.peakRms,
    vadPeakSpeechBandRatio: diagnostics.peakSpeechBandRatio,
    vadFinalNoiseFloor: diagnostics.finalNoiseFloor,
    vadMaxCandidateSpeechMs: diagnostics.maxCandidateSpeechMs,
    vadCandidateResetCount: diagnostics.candidateResetCount,
    vadFullyQualifiedSampleCount: diagnostics.fullyQualifiedSampleCount,
    // VAD false-negative hardening, ROUND 2 (2026-08-22): see
    // VoiceActivityDiagnostics's own ROUND 2 doc comments for what each
    // answers.
    vadTotalSampleCount: diagnostics.totalSampleCount,
    vadAmplitudeQualifiedSampleCount: diagnostics.amplitudeQualifiedSampleCount,
    vadSpectralQualifiedSampleCount: diagnostics.spectralQualifiedSampleCount,
    vadLongestCandidateGapMs: diagnostics.longestCandidateGapMs,
    vadPeakNoiseFloor: diagnostics.peakNoiseFloor,
    // VAD false-negative hardening, ROUND 4 (2026-08-22): see
    // VoiceActivityDiagnostics's own ROUND 4 doc comment for what this
    // answers.
    vadWindowedCandidateSampleCount: diagnostics.windowedCandidateSampleCount,
    // VAD end-of-speech hardening, ROUND 6 (2026-08-22): see
    // VoiceActivityDiagnostics's own ROUND 6 doc comments for what each
    // answers -- undefined (never fabricated) whenever speech was never
    // confirmed at all this recording.
    vadPostConfirmationSampleCount: diagnostics.postConfirmationSampleCount ?? undefined,
    vadContinuationQualifiedSampleCount: diagnostics.continuationQualifiedSampleCount ?? undefined,
    vadContinuationSpectralOnlySampleCount: diagnostics.continuationSpectralOnlySampleCount ?? undefined,
    vadContinuationAmplitudeOnlySampleCount: diagnostics.continuationAmplitudeOnlySampleCount ?? undefined,
    vadLongestPostConfirmationGapMs: diagnostics.longestPostConfirmationGapMs ?? undefined,
    vadLastStrongEvidenceAgeAtStopMs: diagnostics.lastStrongEvidenceAgeAtStopMs ?? undefined,
    // VAD start-detection hardening, ROUND 7 (2026-08-22): see
    // VoiceActivityDiagnostics's own ROUND 7 doc comments for what each
    // answers.
    vadAmbientSpectralRatioEstimate: diagnostics.ambientSpectralRatioEstimate,
    vadPeakAmbientSpectralRatioEstimate: diagnostics.peakAmbientSpectralRatioEstimate,
    vadSpectralLiftQualifiedSampleCount: diagnostics.spectralLiftQualifiedSampleCount,
    // VAD start-detection hardening, ROUND 8 (2026-08-22): see
    // VoiceActivityDiagnostics's own ROUND 8 doc comments for what each
    // answers.
    vadLongestSpectralQualifiedRunMs: diagnostics.longestSpectralQualifiedRunMs,
    vadSpectralQualifiedRunCount: diagnostics.spectralQualifiedRunCount,
    vadLongestFullyQualifiedRunMs: diagnostics.longestFullyQualifiedRunMs,
    vadFullyQualifiedRunCount: diagnostics.fullyQualifiedRunCount,
    // VAD start-detection hardening, ROUND 9 (2026-08-23): see
    // VoiceActivityDiagnostics's own ROUND 9 doc comment for what this
    // answers.
    vadPeakStreakSpectralHitCount: diagnostics.peakStreakSpectralHitCount,
  };
}

// VAD Round 10 (2026-08-23), Silero shadow mode, Phase A: a snapshot of
// the shadow detector's own model-level and per-frame diagnostics for ONE
// recording -- carried through onTranscript (see VoiceTurnLatencyInfo
// below) exactly the way vadDiagnostics already is, so consultation-chat.tsx
// can fold it into the SAME final VOICE_LATENCY report for a successful
// turn, not just the early-failure branches inside this file.
export interface SileroShadowReportData {
  modelInfo: SileroShadowModelInfo;
  diagnostics: SileroShadowDiagnosticsState;
  // VAD Round 13 (2026-08-24), Phase B.2: the shared preload singleton's
  // own state (see silero-vad-shadow-runtime.ts's own
  // getSileroPreloadTelemetry) -- a session-level fact, not specific to
  // this one recording (modelInfo.wasPreloaded above is the per-recording
  // half of the same story).
  preload: SileroPreloadTelemetry;
}

// Maps SileroShadowReportData onto reportVoiceLatencySummary's own flat,
// vad-prefixed diagnostic fields -- {} (nothing added) when shadow mode
// was never even attempted for this recording, mirroring
// vadDiagnosticsToReportFields's own "never fabricated" contract exactly.
// STRICT SHADOW MODE: every field here is diagnostic-only telemetry --
// nothing in this function, or anywhere it is called from, feeds back
// into evaluateVadSample/the existing heuristic decision path.
export function sileroShadowDiagnosticsToReportFields(data: SileroShadowReportData | null): Partial<VoiceLatencyTerminalDiagnostics> {
  if (!data) return {};
  const summary = summarizeSileroShadowDiagnostics(data.diagnostics);
  // vadModelError prefers a genuine SETUP failure (model/WASM/worklet
  // never loaded at all) over a per-frame inference error, since a setup
  // failure is the more informative, root-cause-level fact -- both are
  // still real, sanitized, bounded messages (see silero-vad-shadow-runtime.ts's
  // own sanitizeErrorMessage), never a raw error object.
  const error = data.modelInfo.error ?? (summary.errorCount > 0 ? (summary.lastError ?? undefined) : undefined);
  return {
    vadModelAvailable: data.modelInfo.available,
    vadModelName: data.modelInfo.name,
    vadModelVersion: data.modelInfo.version,
    vadModelLoadMs: data.modelInfo.loadMs ?? undefined,
    vadModelPeakSpeechProbability: summary.peakSpeechProbability,
    vadModelMeanSpeechProbability: summary.meanSpeechProbability ?? undefined,
    vadModelSpeechQualifiedSampleCount: summary.speechQualifiedSampleCount,
    vadModelTotalSampleCount: summary.totalSampleCount,
    vadModelInferencePeakMs: summary.peakInferenceMs,
    vadModelInferenceMeanMs: summary.meanInferenceMs ?? undefined,
    vadModelSpeechProbabilityStdDev: summary.speechProbabilityStdDev ?? undefined,
    ...(error !== undefined ? { vadModelError: error } : {}),
    // VAD Round 13 (2026-08-24), Phase B.2: see
    // silero-vad-shadow-runtime.ts's own getSileroPreloadTelemetry doc
    // comment and SileroShadowModelInfo.wasPreloaded doc comment for what
    // each answers -- lets a real production report show directly
    // whether preload avoided a model_loading wait for this recording.
    vadModelPreloadAttempted: data.preload.attempted,
    vadModelPreloadCompleted: data.preload.completed,
    ...(data.preload.preloadMs !== null ? { vadModelPreloadMs: data.preload.preloadMs } : {}),
    vadModelWasPreloadedAtRecordingStart: data.modelInfo.wasPreloaded,
  };
}

// VAD Round 11 (2026-08-23), Phase B: a snapshot of the START gate's own
// per-recording outcome -- carried through onTranscript exactly like
// SileroShadowReportData/vadDiagnostics, so a successful turn's final
// VOICE_LATENCY report can show, from one line, who confirmed START, when,
// and whether fallback was used -- see sileroStartGateToReportFields's own
// doc comment for what each field answers.
export interface SileroStartGateReportContext {
  fallbackUsed: boolean;
  fallbackReason: "model_loading" | "model_unavailable" | "model_error" | null;
  // Offset from recording start (this app's own established telemetry
  // convention -- see voice-activity-logic.ts's own computeVoiceActivityDiagnostics),
  // null whenever Silero's own gate never confirmed (either fallback was
  // used, or the recording ended before any confirmation happened at all).
  confirmedAtMs: number | null;
  // The highest recurrence (distinct qualifying-frame count) the longest-
  // forming Silero streak ever reached this recording -- see
  // silero-start-gate-logic.ts's own peakQualifiedFrameCount doc comment.
  qualifiedFrameCount: number;
}

// Maps SileroStartGateReportContext onto reportVoiceLatencySummary's own
// flat, vad-prefixed fields. vadStartGateMode is reported UNCONDITIONALLY
// (it describes this build's own configuration -- SILERO_START_GATE_ENABLED
// -- a fact that is always genuinely known, independent of whether Silero
// itself ever became available for this specific recording); every other
// field is gated on `context` being non-null (i.e. the flag was actually
// ON for this recording), matching this app's "never fabricated" contract.
export function sileroStartGateToReportFields(context: SileroStartGateReportContext | null): Partial<VoiceLatencyTerminalDiagnostics> {
  return {
    vadStartGateMode: SILERO_START_GATE_ENABLED ? "silero" : "legacy",
    ...(context
      ? {
          vadStartGateModelThreshold: DEFAULT_SILERO_START_GATE_CONFIG.probabilityThreshold,
          vadStartGateModelQualifiedFrames: context.qualifiedFrameCount,
          ...(context.confirmedAtMs !== null ? { vadStartGateModelConfirmedAtMs: context.confirmedAtMs } : {}),
          vadStartGateFallbackUsed: context.fallbackUsed,
          ...(context.fallbackReason !== null ? { vadStartGateFallbackReason: context.fallbackReason } : {}),
        }
      : {}),
  };
}

// VAD Round 14 (2026-08-24), Phase C: a snapshot of the CONTINUATION
// gate's own per-recording outcome -- carried through onTranscript exactly
// like SileroStartGateReportContext, so a successful turn's final
// VOICE_LATENCY report can show, from one line, whether Silero's own
// continuation authority was ever engaged, when it last saw speech, when
// it flagged/confirmed silence, whether fallback was used, and -- the
// decisive proof this round's own fix is working -- how many ticks the
// legacy heuristic would have stopped prematurely had Silero not
// suppressed it.
export interface SileroContinuationReportContext {
  fallbackUsed: boolean;
  fallbackReason: "model_loading" | "model_unavailable" | "model_error" | null;
  // Offsets from recording start (this app's own established telemetry
  // convention), null whenever the underlying gate field itself is still
  // null (speech never confirmed by this gate, or the recording ended
  // before a candidate/confirmation ever happened).
  lastSpeechAtMs: number | null;
  silenceCandidateAtMs: number | null;
  silenceConfirmedAtMs: number | null;
  // How many ticks this recording's own legacy heuristic decision was
  // "stop_silence" while Silero's own continuation gate had NOT confirmed
  // silence -- i.e. how many times a premature stop was actually
  // suppressed. Counted per TICK (not per distinct episode), so this
  // number is roughly proportional to how much real speech time was saved
  // from being cut off -- the direct, per-recording proof of the
  // regression this round fixes. 0 is a truthful "never needed", not a
  // fabricated placeholder.
  legacyStopSuppressedCount: number;
}

// Maps SileroContinuationReportContext onto reportVoiceLatencySummary's
// own flat, vad-prefixed fields -- mirrors sileroStartGateToReportFields
// exactly. vadContinuationMode is reported UNCONDITIONALLY (describes this
// build's own configuration, always genuinely known); every other field
// is gated on `context` being non-null (the flag was actually ON for this
// recording).
export function sileroContinuationToReportFields(context: SileroContinuationReportContext | null): Partial<VoiceLatencyTerminalDiagnostics> {
  return {
    vadContinuationMode: SILERO_CONTINUATION_ENABLED ? "silero" : "legacy",
    ...(context
      ? {
          vadContinuationModelThreshold: DEFAULT_SILERO_CONTINUATION_GATE_CONFIG.probabilityThreshold,
          ...(context.lastSpeechAtMs !== null ? { vadContinuationModelLastSpeechAtMs: context.lastSpeechAtMs } : {}),
          ...(context.silenceCandidateAtMs !== null ? { vadContinuationModelSilenceCandidateAtMs: context.silenceCandidateAtMs } : {}),
          ...(context.silenceConfirmedAtMs !== null ? { vadContinuationModelSilenceConfirmedAtMs: context.silenceConfirmedAtMs } : {}),
          vadContinuationFallbackUsed: context.fallbackUsed,
          ...(context.fallbackReason !== null ? { vadContinuationFallbackReason: context.fallbackReason } : {}),
          vadLegacyStopSuppressedByModelCount: context.legacyStopSuppressedCount,
        }
      : {}),
  };
}

export function useVoiceRecording({ clientId, language, t, onTranscript }: UseVoiceRecordingOptions): UseVoiceRecordingResult {
  const [recording, setRecording] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // VAD Round 13 (2026-08-24), Phase B.2: background warm-up. Fires once,
  // on mount -- this hook is only ever used by consultation-chat.tsx (see
  // this file's own module doc comment on the isolation guarantee from
  // teach-ai-panel.tsx's own, separate recording flow, which never mounts
  // this hook and therefore never triggers this), so "this hook mounted"
  // already means "the stylist opened Consult AI", exactly the trigger
  // this round's own task asked for -- no separate signal needed.
  //
  // Deliberately fire-and-forget and deliberately NOT gated on
  // SILERO_START_GATE_ENABLED: Phase A's own shadow mode already runs
  // unconditionally on every recording regardless of that flag (collecting
  // telemetry even when Phase B is off) -- warming the SAME assets earlier
  // is a direct, non-breaking extension of that already-established
  // behavior, not something new tied to the flag.
  //
  // Deferred via requestIdleCallback (falling back to a short setTimeout
  // on Safari, which has never implemented it) so this ~15MB fetch does
  // not compete with Consult AI's own, more urgent initial data loads
  // (history, client context) for bandwidth/main-thread time immediately
  // on mount -- "idle preload after mount", per this round's own task.
  // Zero getUserMedia, zero MediaStream, zero microphone permission
  // prompt -- preloadSileroModel() only ever touches the model/WASM
  // loading path (see silero-vad-shadow-runtime.ts's own ROUND 13 doc
  // comment on exactly why that is safe to do without a stream at all).
  useEffect(() => {
    const w = window as typeof window & {
      requestIdleCallback?: (callback: () => void) => number;
      cancelIdleCallback?: (handle: number) => void;
    };
    if (typeof w.requestIdleCallback === "function") {
      const handle = w.requestIdleCallback(() => preloadSileroModel());
      return () => w.cancelIdleCallback?.(handle);
    }
    const timeoutId = window.setTimeout(() => preloadSileroModel(), 1000);
    return () => window.clearTimeout(timeoutId);
  }, []);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  // Guards against the VAD sampling loop (which polls every ~100ms) and a
  // manual Stop click racing to trigger the same stop twice -- MediaRecorder
  // itself only fires onstop once per session regardless, but this also
  // stops the VAD interval from doing any further work once a stop has
  // already been decided.
  const hasStoppedRef = useRef(false);
  const vadCleanupRef = useRef<(() => void) | null>(null);
  // Voice reliability hardening (2026-08-18): guards the async window
  // between a click and getUserMedia's own promise resolving -- `recording`
  // (React state) does not flip to true until AFTER that promise settles,
  // so a rapid second click in that window would otherwise see
  // `recording === false` and start a SECOND, fully independent
  // getUserMedia()/MediaRecorder setup, racing the first one for the same
  // physical microphone. A plain ref (not state) so the check is exact and
  // synchronous, unlike a state update which only takes effect on the next
  // render.
  const startingRef = useRef(false);
  // One id per logical mic-press-to-result cycle, generated the moment a
  // start is actually accepted (not on every click, which could double-
  // generate if startingRef already rejected the click) -- carried through
  // every log event for this cycle, including into finishRecording, so a
  // stylist-reported incident can be found by this one id end to end.
  const attemptIdRef = useRef<string | null>(null);
  // Voice latency audit (2026-08-18): mic-phase marks (mic_requested,
  // mic_ready, recording_started) for the CURRENT attempt cycle only --
  // reset the moment a new attemptId is generated. Merged with
  // finishRecording's own (recording_stopped..transcript_ready) marks at
  // the onSuccess/onFailure boundary below, since those are the two
  // structurally separate layers this turn's timeline spans before
  // Consult AI/TTS (see use-voice-recording.ts's own onTranscript doc
  // comment above).
  const micMarksRef = useRef<VoiceLatencyMarks>({});
  // End-of-speech hardening (2026-08-20), Task E: raw ingredients for
  // computeVoiceActivityDiagnostics, populated by the VAD interval (or the
  // manual-stop branch) below and read once, in media.onstop, to build the
  // actual telemetry report -- see readVoiceActivityDiagnostics. All reset
  // to null at the start of every new recording. vadRecordingStartedAtRef
  // stays null if VAD setup itself failed (see the try/catch around the
  // AudioContext graph below) -- readVoiceActivityDiagnostics treats that
  // as "no VAD diagnostics to report" rather than fabricating zeros.
  const vadRecordingStartedAtRef = useRef<number | null>(null);
  const vadSpeechDetectedAtRef = useRef<number | null>(null);
  const vadLastSpeechAtRef = useRef<number | null>(null);
  const vadAutoStopReasonRef = useRef<VoiceActivityAutoStopReason | null>(null);
  const vadStopDecidedAtRef = useRef<number | null>(null);
  // VAD false-negative hardening (2026-08-21): the full latest VadState,
  // written on every interval tick (see below) -- the source for the new
  // diagnostic accumulators (peakRms/peakSpeechBandRatio/etc.), which
  // aren't individually derivable from the other refs above the way
  // speechDetectedAt/lastSpeechAt are. Reset to null at the start of every
  // new recording, same as the others -- null stays null if VAD setup
  // itself failed or the interval never ticked before a manual stop.
  const vadStateRef = useRef<VadState | null>(null);
  // VAD Round 10 (2026-08-23), Silero shadow mode, Phase A: the shadow
  // detector's own handle for the CURRENT recording only -- reset to null
  // at the start of every new recording (same convention as the vad*Ref
  // fields above), NOT nulled in media.onstop, so
  // readSileroShadowReportData below can still read its final
  // diagnostics/model info after the recording has already stopped and
  // its own resources released (see silero-vad-shadow-runtime.ts's own
  // doc comment: getDiagnostics()/getModelInfo() remain valid after
  // stop()). Stays null for the whole recording if setup itself never
  // even started (e.g. this app's own STRICT lazy-loading -- see below --
  // never triggers it) or if startSileroVadShadow's own internal setup
  // failed entirely before returning a handle at all is impossible by
  // that function's own contract (it always resolves to SOME handle,
  // never rejects) -- null here specifically means "shadow mode was never
  // even attempted for this recording", distinct from "attempted and
  // unavailable" (which readSileroShadowReportData's own modelInfo.available
  // already reports honestly).
  const sileroShadowHandleRef = useRef<Awaited<ReturnType<typeof startSileroVadShadow>> | null>(null);
  // VAD Round 11 (2026-08-23), Phase B: whether the heuristic's own
  // fallback confirmation was ever relied on for THIS recording (only
  // meaningful when SILERO_START_GATE_ENABLED), and why -- set once, at
  // the first tick fallback engages, never overwritten afterward (a
  // "first cause" record, not a running log). Reset per recording, same
  // convention as the other vad*Ref fields.
  const sileroStartGateFallbackUsedRef = useRef(false);
  const sileroStartGateFallbackReasonRef = useRef<"model_loading" | "model_unavailable" | "model_error" | null>(null);
  // VAD Round 14 (2026-08-24), Phase C: independent from Phase B's own
  // fallback refs above -- START and CONTINUATION fallback are separate
  // events (Silero could confirm START healthily and only degrade later,
  // mid-utterance). Reset per recording, same convention.
  const sileroContinuationFallbackUsedRef = useRef(false);
  const sileroContinuationFallbackReasonRef = useRef<"model_loading" | "model_unavailable" | "model_error" | null>(null);
  // The direct, per-recording proof of the regression this round fixes --
  // see SileroContinuationReportContext.legacyStopSuppressedCount's own
  // doc comment. Reset per recording, same convention.
  const vadLegacyStopSuppressedByModelCountRef = useRef(0);

  const readSileroShadowReportData = useCallback((): SileroShadowReportData | null => {
    const handle = sileroShadowHandleRef.current;
    if (!handle) return null;
    return { modelInfo: handle.getModelInfo(), diagnostics: handle.getDiagnostics(), preload: getSileroPreloadTelemetry() };
  }, []);

  // VAD Round 11 (2026-08-23), Phase B: null whenever the flag was OFF
  // for this recording (Phase B fields simply don't apply) -- the
  // fallback/qualified-frame-count facts are meaningful even if Silero
  // never became available at all, so this is read independently of
  // readSileroShadowReportData's own null-when-shadow-mode-never-ran gate.
  const readSileroStartGateReportContext = useCallback((): SileroStartGateReportContext | null => {
    if (!SILERO_START_GATE_ENABLED) return null;
    const startGateState = sileroShadowHandleRef.current?.getStartGateState() ?? null;
    const recordingStartedAt = vadRecordingStartedAtRef.current;
    const confirmedAtAbsolute = startGateState?.confirmedAtMs ?? null;
    return {
      fallbackUsed: sileroStartGateFallbackUsedRef.current,
      fallbackReason: sileroStartGateFallbackReasonRef.current,
      confirmedAtMs:
        confirmedAtAbsolute !== null && recordingStartedAt !== null
          ? Math.max(0, Math.round(confirmedAtAbsolute - recordingStartedAt))
          : null,
      qualifiedFrameCount: startGateState?.peakQualifiedFrameCount ?? 0,
    };
  }, []);

  // VAD Round 14 (2026-08-24), Phase C: null whenever the flag was OFF for
  // this recording (Phase C fields simply don't apply), same convention as
  // readSileroStartGateReportContext above.
  const readSileroContinuationReportContext = useCallback((): SileroContinuationReportContext | null => {
    if (!SILERO_CONTINUATION_ENABLED) return null;
    const continuationGateState = sileroShadowHandleRef.current?.getContinuationGateState() ?? null;
    const recordingStartedAt = vadRecordingStartedAtRef.current;
    const toOffset = (absolute: number | null): number | null =>
      absolute !== null && recordingStartedAt !== null ? Math.max(0, Math.round(absolute - recordingStartedAt)) : null;
    return {
      fallbackUsed: sileroContinuationFallbackUsedRef.current,
      fallbackReason: sileroContinuationFallbackReasonRef.current,
      lastSpeechAtMs: toOffset(continuationGateState?.lastSpeechAtMs ?? null),
      silenceCandidateAtMs: toOffset(continuationGateState?.silenceCandidateAtMs ?? null),
      silenceConfirmedAtMs: toOffset(continuationGateState?.silenceConfirmedAtMs ?? null),
      legacyStopSuppressedCount: vadLegacyStopSuppressedByModelCountRef.current,
    };
  }, []);

  const readVoiceActivityDiagnostics = useCallback((): VoiceActivityDiagnostics | null => {
    if (vadRecordingStartedAtRef.current === null || vadStopDecidedAtRef.current === null || vadAutoStopReasonRef.current === null) {
      return null;
    }
    return computeVoiceActivityDiagnostics({
      recordingStartedAt: vadRecordingStartedAtRef.current,
      stopDecidedAt: vadStopDecidedAtRef.current,
      speechDetectedAt: vadSpeechDetectedAtRef.current,
      lastSpeechAt: vadLastSpeechAtRef.current,
      autoStopReason: vadAutoStopReasonRef.current,
      vadMode: VAD_MODE,
      // Never fabricated in the sense of a guessed value -- 0 here is a
      // truthful "the interval never ticked before recording stopped"
      // (e.g. an instant manual stop), not a placeholder.
      peakRms: vadStateRef.current?.peakRms ?? 0,
      peakSpeechBandRatio: vadStateRef.current?.peakSpeechBandRatio ?? 0,
      finalNoiseFloor: vadStateRef.current?.noiseFloorEstimate ?? 0,
      maxCandidateSpeechMs: vadStateRef.current?.maxCandidateStreakMs ?? 0,
      candidateResetCount: vadStateRef.current?.candidateResetCount ?? 0,
      fullyQualifiedSampleCount: vadStateRef.current?.fullyQualifiedSampleCount ?? 0,
      // VAD false-negative hardening, ROUND 2 (2026-08-22): same "0 is
      // truthful, never fabricated" contract as the round-1 fields above.
      totalSampleCount: vadStateRef.current?.totalSampleCount ?? 0,
      amplitudeQualifiedSampleCount: vadStateRef.current?.amplitudeQualifiedSampleCount ?? 0,
      spectralQualifiedSampleCount: vadStateRef.current?.spectralQualifiedSampleCount ?? 0,
      longestCandidateGapMs: vadStateRef.current?.longestCandidateGapMs ?? 0,
      peakNoiseFloor: vadStateRef.current?.peakNoiseFloor ?? 0,
      // VAD false-negative hardening, ROUND 4 (2026-08-22): same "0 is
      // truthful, never fabricated" contract as the earlier fields above.
      windowedCandidateSampleCount: vadStateRef.current?.windowedCandidateSampleCount ?? 0,
      // VAD end-of-speech hardening, ROUND 6 (2026-08-22): same "0 is
      // truthful, never fabricated" contract -- computeVoiceActivityDiagnostics
      // itself nulls these out when speech was never confirmed at all.
      postConfirmationSampleCount: vadStateRef.current?.postConfirmationSampleCount ?? 0,
      continuationQualifiedSampleCount: vadStateRef.current?.continuationQualifiedSampleCount ?? 0,
      continuationSpectralOnlySampleCount: vadStateRef.current?.continuationSpectralOnlySampleCount ?? 0,
      continuationAmplitudeOnlySampleCount: vadStateRef.current?.continuationAmplitudeOnlySampleCount ?? 0,
      longestPostConfirmationGapMs: vadStateRef.current?.longestPostConfirmationGapMs ?? 0,
      lastWindowedCandidateAt: vadStateRef.current?.lastWindowedCandidateAt ?? null,
      // VAD start-detection hardening, ROUND 7 (2026-08-22): same "0 is
      // truthful, never fabricated" contract as the earlier fields above.
      ambientSpectralRatioEstimate: vadStateRef.current?.ambientSpectralRatioEstimate ?? 0,
      peakAmbientSpectralRatioEstimate: vadStateRef.current?.peakAmbientSpectralRatioEstimate ?? 0,
      spectralLiftQualifiedSampleCount: vadStateRef.current?.spectralLiftQualifiedSampleCount ?? 0,
      // VAD start-detection hardening, ROUND 8 (2026-08-22): same "0 is
      // truthful, never fabricated" contract as the earlier fields above.
      longestSpectralQualifiedRunMs: vadStateRef.current?.longestSpectralQualifiedRunMs ?? 0,
      spectralQualifiedRunCount: vadStateRef.current?.spectralQualifiedRunCount ?? 0,
      longestFullyQualifiedRunMs: vadStateRef.current?.longestFullyQualifiedRunMs ?? 0,
      fullyQualifiedRunCount: vadStateRef.current?.fullyQualifiedRunCount ?? 0,
      // VAD start-detection hardening, ROUND 9 (2026-08-23): same "0 is
      // truthful, never fabricated" contract as the earlier fields above.
      peakStreakSpectralHitCount: vadStateRef.current?.peakStreakSpectralHitCount ?? 0,
    });
  }, []);

  const toggleRecording = useCallback(() => {
    if (recording) {
      // Guards a rare race: VAD's own interval (see below) may have
      // already decided to stop in the same tick as a manual click.
      // MediaRecorder.stop() throws if called on an already-inactive/
      // stopping recorder, so this must never call it a second time --
      // onstop (and therefore finishRecording/auto-submit) already only
      // ever runs once regardless, this just avoids the redundant call.
      if (!hasStoppedRef.current) {
        hasStoppedRef.current = true;
        // Recorded BEFORE stop() -- a manual click racing VAD's own
        // interval must never be misattributed as a VAD decision (VAD's
        // own interval bails out immediately once hasStoppedRef is true,
        // so whichever of the two set these refs first wins honestly).
        vadAutoStopReasonRef.current = "manual_stop";
        vadStopDecidedAtRef.current = performance.now();
        recorder.current?.stop();
      }
      return;
    }

    // See startingRef's own doc comment -- rejects a second start attempt
    // that lands while the first one's getUserMedia() promise is still
    // pending, before `recording` state has had a chance to become true.
    if (startingRef.current) {
      return;
    }
    startingRef.current = true;

    setError(null);

    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      startingRef.current = false;
      setError(t("consultAi.voiceError.microphoneUnavailable"));
      return;
    }

    const attemptId = generateAttemptId();
    attemptIdRef.current = attemptId;
    micMarksRef.current = {};
    vadRecordingStartedAtRef.current = null;
    vadSpeechDetectedAtRef.current = null;
    vadLastSpeechAtRef.current = null;
    vadAutoStopReasonRef.current = null;
    vadStopDecidedAtRef.current = null;
    vadStateRef.current = null;
    // VAD Round 10 (2026-08-23): reset per-recording, same convention as
    // the vad*Ref fields above -- see this ref's own doc comment for why
    // this is NOT also nulled in media.onstop.
    sileroShadowHandleRef.current = null;
    // VAD Round 11 (2026-08-23), Phase B: reset per-recording, same
    // convention as the refs above.
    sileroStartGateFallbackUsedRef.current = false;
    sileroStartGateFallbackReasonRef.current = null;
    // VAD Round 14 (2026-08-24), Phase C: reset per-recording, same
    // convention as the refs above -- prevents any leakage between
    // recordings (required test 20).
    sileroContinuationFallbackUsedRef.current = false;
    sileroContinuationFallbackReasonRef.current = null;
    vadLegacyStopSuppressedByModelCountRef.current = 0;

    void (async () => {
      try {
        logClient("mic_requested", { attemptId, source: "chat_composer" });
        micMarksRef.current = markVoiceLatencyStage(micMarksRef.current, "mic_requested", performance.now());
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        logClient("mic_granted", { attemptId, source: "chat_composer" });
        micMarksRef.current = markVoiceLatencyStage(micMarksRef.current, "mic_ready", performance.now());
        streamRef.current = stream;
        chunks.current = [];
        hasStoppedRef.current = false;
        const media = new MediaRecorder(stream);
        recorder.current = media;
        media.ondataavailable = (event) => {
          if (event.data.size) chunks.current.push(event.data);
        };
        media.onstop = () => {
          hasStoppedRef.current = true;
          vadCleanupRef.current?.();
          vadCleanupRef.current = null;
          // VAD Round 10 (2026-08-23): releases ONLY the shadow
          // detector's own dedicated AudioContext/nodes/ONNX session --
          // never the shared stream (see silero-vad-shadow-runtime.ts's
          // own doc comment on stream safety). Deliberately NOT nulling
          // sileroShadowHandleRef.current here -- see that ref's own doc
          // comment for why readSileroShadowReportData must still be able
          // to read its final diagnostics after this point.
          sileroShadowHandleRef.current?.stop();
          streamRef.current = null;
          // The MediaRecorder instance itself is genuinely done the
          // moment onstop fires, regardless of how long the async
          // upload below takes -- nulling it here (not just on unmount)
          // guarantees the NEXT toggleRecording call always constructs a
          // fully fresh MediaRecorder rather than retaining any
          // reference to this now-inactive one.
          recorder.current = null;
          // VAD Round 12 (2026-08-23): the single source of truth for
          // whether this recording's audio is even eligible for
          // transcription -- read from vadStateRef.current at the EXACT
          // moment the recording stops, reflecting whichever authority
          // (Phase B's Silero START gate, or the legacy heuristic alone)
          // actually confirmed speech, if either did. See
          // hasConfirmedSpeechForSubmission's own doc comment
          // (voice-activity-logic.ts) for the real production bug this
          // closes and why VAD never having run at all defaults to
          // eligible (the pre-VAD fallback).
          const hasConfirmedSpeech = hasConfirmedSpeechForSubmission(vadStateRef.current);
          void finishRecording(
            stream,
            chunks.current,
            media.mimeType,
            clientId,
            {
              onStopped: () => {
                setRecording(false);
                setProcessing(true);
              },
              onNoSpeechDetected: (marks) => {
                setProcessing(false);
                setError(t("consultAi.voiceError.noSpeechDetected"));
                // Honest, local termination: STT was never attempted, so
                // this is reported as a SKIP, never "stt_failed" -- no
                // speech != provider failure (this round's own explicit
                // requirement). No transcript is ever produced, so
                // onTranscript (and therefore Consult AI/TTS/conversation
                // history) is structurally never reached on this path --
                // not by convention, since this callback simply never
                // calls it.
                const mergedMarks = mergeVoiceLatencyMarks(micMarksRef.current, marks);
                const summary = computeVoiceLatencySummary(mergedMarks);
                logVoiceLatencySummary(attemptId, summary);
                reportVoiceLatencySummary(clientId, attemptId, "stt_skipped_no_speech", summary, { fetch: bindFetch(fetch) }, {
                  sttSkipped: true,
                  sttSkipReason: "no_confirmed_speech",
                  elapsedSinceMicRequestMs: computeElapsedSinceMicRequestMs(mergedMarks, performance.now()),
                  ...vadDiagnosticsToReportFields(readVoiceActivityDiagnostics()),
                  ...sileroShadowDiagnosticsToReportFields(readSileroShadowReportData()),
                  ...sileroStartGateToReportFields(readSileroStartGateReportContext()),
                  ...sileroContinuationToReportFields(readSileroContinuationReportContext()),
                });
              },
              onFailure: (_message, reason, marks, attemptNumber, providerDiagnostics, sttAttempt1, sttAttempt2) => {
                setProcessing(false);
                setError(t(translationKeyForReason(reason)));
                // The turn ends here (no Consult AI/TTS stage will ever
                // run for a failed transcription) -- log the summary now
                // rather than deferring to a caller that will never
                // receive this attempt at all. Reported server-side too
                // (see voice-latency-logic.ts's own doc comment) -- the
                // browser-only console.log above is not, on its own,
                // visible in Railway.
                const mergedMarks = mergeVoiceLatencyMarks(micMarksRef.current, marks);
                const summary = computeVoiceLatencySummary(mergedMarks);
                logVoiceLatencySummary(attemptId, summary);
                reportVoiceLatencySummary(clientId, attemptId, "stt_failed", summary, { fetch: bindFetch(fetch) }, {
                  errorCode: reason,
                  ...(attemptNumber > 0 ? { providerAttemptCount: attemptNumber } : {}),
                  elapsedSinceMicRequestMs: computeElapsedSinceMicRequestMs(mergedMarks, performance.now()),
                  // STT Flash-Lite root-cause diagnosis (2026-08-20): the
                  // real Gemini failure detail, never fabricated when the
                  // failure never reached the provider at all.
                  sttProviderHttpStatus: providerDiagnostics?.providerHttpStatus,
                  sttProviderErrorStatus: providerDiagnostics?.providerErrorStatus,
                  sttProviderErrorMessage: providerDiagnostics?.providerErrorMessage,
                  sttProviderFetchErrorName: providerDiagnostics?.providerFetchErrorName,
                  ...sttAttemptReportFields(sttAttempt1, sttAttempt2),
                  ...vadDiagnosticsToReportFields(readVoiceActivityDiagnostics()),
                  ...sileroShadowDiagnosticsToReportFields(readSileroShadowReportData()),
                  ...sileroStartGateToReportFields(readSileroStartGateReportContext()),
                  ...sileroContinuationToReportFields(readSileroContinuationReportContext()),
                });
              },
              onSuccess: (transcript, _transcriptId, marks, sttProviderMs, attemptNumber, sttModel, sttAttempt1, sttAttempt2) => {
                setProcessing(false);
                const mergedMarks = mergeVoiceLatencyMarks(micMarksRef.current, marks);
                const vadDiagnostics = readVoiceActivityDiagnostics();
                const sileroShadow = readSileroShadowReportData();
                const sileroStartGate = readSileroStartGateReportContext();
                const sileroContinuation = readSileroContinuationReportContext();
                // Empty/whitespace-only would only ever come from a
                // genuinely unexpected backend response (the route itself
                // already fails closed on an empty transcript) -- this is
                // belt-and-suspenders, not the primary guard.
                if (shouldAutoSubmitTranscript(transcript)) {
                  onTranscript(transcript, {
                    attemptId,
                    marks: mergedMarks,
                    sttProviderMs,
                    sttModel,
                    vadDiagnostics,
                    sileroShadow,
                    sileroStartGate,
                    sileroContinuation,
                    sttAttempt1,
                    sttAttempt2,
                  });
                } else {
                  // Same reasoning as the onFailure branch above: this
                  // turn also ends here, since onTranscript (and therefore
                  // any downstream Consult AI/TTS instrumentation) is
                  // never reached.
                  const summary = computeVoiceLatencySummary(mergedMarks, { sttProviderMs: sttProviderMs ?? undefined });
                  logVoiceLatencySummary(attemptId, summary);
                  reportVoiceLatencySummary(clientId, attemptId, "stt_success_not_submitted", summary, { fetch: bindFetch(fetch) }, {
                    providerAttemptCount: attemptNumber,
                    sttModel: sttModel ?? undefined,
                    elapsedSinceMicRequestMs: computeElapsedSinceMicRequestMs(mergedMarks, performance.now()),
                    ...sttAttemptReportFields(sttAttempt1, sttAttempt2),
                    ...vadDiagnosticsToReportFields(vadDiagnostics),
                    ...sileroShadowDiagnosticsToReportFields(sileroShadow),
                    ...sileroStartGateToReportFields(sileroStartGate),
                    ...sileroContinuationToReportFields(sileroContinuation),
                  });
                }
              },
            },
            { fetch: bindFetch(fetch), encodeAsWav: decodeBlobAsWav },
            language,
            attemptId,
            hasConfirmedSpeech,
          );
        };
        media.start();
        setRecording(true);
        startingRef.current = false;
        logClient("recorder_started", { attemptId, mimeType: media.mimeType || null, source: "chat_composer" });
        micMarksRef.current = markVoiceLatencyStage(micMarksRef.current, "recording_started", performance.now());

        // VAD Round 10 (2026-08-23), Silero shadow mode, Phase A: fully
        // independent of the heuristic VAD block below -- started on the
        // SAME stream (a read-only tap, never getUserMedia'd again and
        // never capable of stopping its tracks -- see
        // silero-vad-shadow-runtime.ts's own doc comment on stream
        // safety), but never blocks or depends on the heuristic block
        // succeeding or failing. Lazy by construction: the dynamic
        // import() inside startSileroVadShadow/loadOnnxRuntime is only
        // ever reached once a recording actually starts, never on page
        // load. Fire-and-forget: startSileroVadShadow's own contract
        // guarantees it never throws/rejects (every failure degrades to
        // an "unavailable" handle instead) -- this outer try/catch is
        // pure defense-in-depth, matching this project's own established
        // "never trust a single layer" discipline for anything touching
        // browser-only audio APIs. STRICT SHADOW MODE: nothing in this
        // block ever reads from or writes to hasStoppedRef/recorder.current
        // in a way that could affect the real recording -- hasStoppedRef
        // is only ever READ (to avoid leaving an orphaned AudioContext
        // running past a recording that already ended), never set here.
        void (async () => {
          try {
            const handle = await startSileroVadShadow(stream);
            if (hasStoppedRef.current) {
              handle.stop();
              return;
            }
            sileroShadowHandleRef.current = handle;
          } catch {
            // Belt-and-suspenders only -- see this block's own doc
            // comment above.
          }
        })();

        const AudioContextCtor = resolveAudioContextConstructor();
        if (AudioContextCtor) {
          try {
            const audioContext = new AudioContextCtor();
            const source = audioContext.createMediaStreamSource(stream);
            const analyser = audioContext.createAnalyser();
            analyser.fftSize = ANALYSER_FFT_SIZE;
            source.connect(analyser);
            const timeBuffer = new Uint8Array(new ArrayBuffer(analyser.fftSize));
            const freqBuffer = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));
            let vadState: VadState = initVadState(performance.now());
            vadRecordingStartedAtRef.current = vadState.recordingStartedAt;

            const intervalId = window.setInterval(() => {
              if (hasStoppedRef.current) return;
              const rmsLevel = computeRmsLevel(analyser, timeBuffer);
              const speechBandRatio = computeSpeechBandRatio(analyser, audioContext, freqBuffer);
              const now = performance.now();
              const wasSpeechConfirmed = vadState.hasDetectedSpeech;
              const { state: rawState, decision: rawDecision } = evaluateVadSample(vadState, { rmsLevel, speechBandRatio }, now);
              let decision = rawDecision;
              // VAD Round 11 (2026-08-23), Phase B: while not yet confirmed
              // BEFORE this tick, Silero (when enabled and healthy) is the
              // ONLY thing allowed to flip hasDetectedSpeech true -- see
              // resolveSileroStartAuthority's own doc comment for the full
              // authority rule. This is a PURE function specifically so it
              // is unit-tested (this interval callback itself cannot be --
              // jsdom has no real AudioContext/AudioWorklet/WASM). Once
              // wasSpeechConfirmed is already true, the function is a pure
              // pass-through -- continuation/end-of-speech stay on
              // voice-activity-logic.ts's own unmodified machinery,
              // structurally, not by convention.
              let state = rawState;
              if (SILERO_START_GATE_ENABLED) {
                const shadowHandle = sileroShadowHandleRef.current;
                const modelInfo = shadowHandle?.getModelInfo() ?? null;
                const shadowDiagnostics = shadowHandle?.getDiagnostics() ?? null;
                const startGate = shadowHandle?.getStartGateState() ?? null;
                const authority = resolveSileroStartAuthority({
                  wasSpeechConfirmedBeforeThisTick: wasSpeechConfirmed,
                  heuristicHasDetectedSpeech: rawState.hasDetectedSpeech,
                  heuristicLastSpeechAt: rawState.lastSpeechAt,
                  now,
                  sileroModelAvailable: modelInfo?.available ?? null,
                  sileroErrorCount: shadowDiagnostics?.errorCount ?? 0,
                  sileroStartGateConfirmed: startGate?.confirmed ?? false,
                  fallbackAlreadyUsedThisRecording: sileroStartGateFallbackUsedRef.current,
                });
                state = { ...rawState, hasDetectedSpeech: authority.hasDetectedSpeech, lastSpeechAt: authority.lastSpeechAt };
                if (authority.fallbackEngaged) {
                  // Reason captured once, at the first tick fallback
                  // engages -- never overwritten afterward (see
                  // resolveSileroStartAuthority's own fallbackEngaged doc
                  // comment).
                  sileroStartGateFallbackUsedRef.current = true;
                  sileroStartGateFallbackReasonRef.current = authority.fallbackReason;
                }
              }
              // VAD Round 14 (2026-08-24), Phase C: once START is
              // confirmed (by either authority, above), Silero's own
              // continuation gate (when enabled and healthy) becomes the
              // SOLE authority on whether this is real silence -- see
              // resolveSileroContinuationAuthority's own doc comment for
              // the full rule and the real production bug this closes.
              // Deliberately called UNCONDITIONALLY (mirroring Phase B's
              // own style) whenever the flag is on -- the function's own
              // first branch is a no-op pass-through until state.hasDetectedSpeech
              // is true, so a music-only recording (START never confirmed)
              // structurally can never reach this override at all.
              if (SILERO_CONTINUATION_ENABLED) {
                const shadowHandle = sileroShadowHandleRef.current;
                const modelInfo = shadowHandle?.getModelInfo() ?? null;
                const shadowDiagnostics = shadowHandle?.getDiagnostics() ?? null;
                const continuationGateState = shadowHandle?.getContinuationGateState() ?? initSileroContinuationGateState();
                const continuationAuthority = resolveSileroContinuationAuthority({
                  hasDetectedSpeech: state.hasDetectedSpeech,
                  heuristicDecision: decision,
                  heuristicLastSpeechAt: state.lastSpeechAt,
                  sileroModelAvailable: modelInfo?.available ?? null,
                  sileroErrorCount: shadowDiagnostics?.errorCount ?? 0,
                  continuationGateState,
                  fallbackAlreadyUsedThisRecording: sileroContinuationFallbackUsedRef.current,
                });
                decision = continuationAuthority.decision;
                state = { ...state, lastSpeechAt: continuationAuthority.lastSpeechAt };
                if (continuationAuthority.legacyStopSuppressed) {
                  vadLegacyStopSuppressedByModelCountRef.current += 1;
                }
                if (continuationAuthority.fallbackEngaged) {
                  // Reason captured once, at the first tick fallback
                  // engages -- never overwritten afterward (see
                  // resolveSileroContinuationAuthority's own
                  // fallbackEngaged doc comment).
                  sileroContinuationFallbackUsedRef.current = true;
                  sileroContinuationFallbackReasonRef.current = continuationAuthority.fallbackReason;
                }
              }
              vadState = state;
              vadStateRef.current = state;
              // End-of-speech hardening (2026-08-20): captures exactly
              // when hasDetectedSpeech first flips true (Task E's
              // speechDetectedAt), and the most recent speech-like sample
              // continuously (speechEndedAt, read at whatever moment the
              // recording actually stops) -- both feed
              // computeVoiceActivityDiagnostics once recording ends.
              if (!wasSpeechConfirmed && vadState.hasDetectedSpeech) {
                vadSpeechDetectedAtRef.current = now;
              }
              if (vadState.lastSpeechAt !== null) {
                vadLastSpeechAtRef.current = vadState.lastSpeechAt;
              }
              if (decision !== "continue") {
                hasStoppedRef.current = true;
                vadAutoStopReasonRef.current = decision;
                vadStopDecidedAtRef.current = now;
                recorder.current?.stop();
              }
            }, AUDIO_LEVEL_SAMPLE_INTERVAL_MS);

            vadCleanupRef.current = () => {
              window.clearInterval(intervalId);
              void audioContext.close().catch(() => {});
            };
          } catch (vadError) {
            // VAD is a nice-to-have on top of a working mic, never a
            // requirement for it -- if the audio graph fails to set up for
            // any reason, recording continues normally via manual Stop only.
            logClient("vad_setup_failed", {
              errorName: vadError instanceof Error ? vadError.name : "unknown",
              source: "chat_composer",
            });
          }
        }
      } catch (error) {
        const reason = classifyMicrophoneStartError(error);
        logClient(reason === "denied" ? "mic_denied" : "recording_start_failed", {
          attemptId,
          errorName: error instanceof Error ? error.name : "unknown",
          errorMessage: error instanceof Error ? error.message : String(error),
          source: "chat_composer",
        });
        logClient("cleanup_completed", { attemptId });
        startingRef.current = false;
        setError(t(reason === "denied" ? "consultAi.voiceError.permissionDenied" : "consultAi.voiceError.microphoneUnavailable"));
      }
    })();
  }, [
    recording,
    clientId,
    language,
    t,
    onTranscript,
    readVoiceActivityDiagnostics,
    readSileroShadowReportData,
    readSileroStartGateReportContext,
    readSileroContinuationReportContext,
  ]);

  // Cleanup on unmount: release the microphone and stop VAD sampling even
  // if the component goes away mid-recording -- detaching the recorder's
  // own handlers first so a track-stop-triggered onstop can never run
  // finishRecording (and therefore setState) after this component is gone.
  useEffect(() => {
    return () => {
      hasStoppedRef.current = true;
      startingRef.current = false;
      vadCleanupRef.current?.();
      vadCleanupRef.current = null;
      // VAD Round 10 (2026-08-23): mirrors media.onstop's own cleanup --
      // releases only the shadow detector's own resources, never the
      // MediaStream stopped explicitly two lines below.
      sileroShadowHandleRef.current?.stop();
      if (recorder.current) {
        recorder.current.onstop = null;
        recorder.current.ondataavailable = null;
      }
      recorder.current = null;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
  }, []);

  return { recording, processing, error, toggleRecording };
}
