// Voice latency instrumentation (2026-08-18): a single, additive timing
// layer spanning one whole voice turn -- mic press through TTS playback
// starting -- correlated by the SAME attemptId already used for STT
// reliability (teach-ai-panel-logic.ts's generateAttemptId, reused here as
// the turn's own id since it's already generated at the earliest possible
// point, mic-press time). This does NOT replace or duplicate the existing
// VOICE_TRANSCRIPT_CLIENT/VOICE_REPLY_CLIENT event streams -- those keep
// logging their own per-stage detail exactly as before. This module adds
// exactly one new thing: a single VOICE_LATENCY summary line, computed
// from real performance.now() timestamps recorded as the turn actually
// progressed, never estimated and never guessed.
//
// Audit finding (why a pure, standalone tracker rather than a live event
// bus): the turn's stages span three structurally separate layers --
// use-voice-recording.ts/teach-ai-panel-logic.ts (mic + STT), consultation-
// chat.tsx's sendMessage (Consult AI), and its speakMessage (TTS) -- with
// no existing shared state between them beyond the one attemptId. A plain
// marks object, threaded through and merged at each layer's own callback
// boundary (finishRecording's onSuccess, sendMessage's own return,
// speakMessage's own audio.onplay), is the smallest mechanism that can
// reconstruct the full timeline without introducing a new cross-component
// event system this app does not otherwise have.
//
// Follow-up (2026-08-19): a real production test proved this file's own
// console.log-based logVoiceLatencySummary below is NOT enough on its own
// -- it runs inside "use client" components, so it executes in the
// stylist's browser and never reaches the Node server process, and
// therefore never appears in Railway Deploy Logs no matter what string is
// searched for. reportVoiceLatencySummary (bottom of this file) is the
// fix: a fire-and-forget POST of the SAME summary to the new
// POST /api/v1/clients/[id]/voice-latency endpoint, whose own server-side
// log line is what actually becomes visible in Railway. The outcome enum
// it uses is owned by @/lib/voice-latency-telemetry-logic (the server's
// own strict validation contract), not duplicated here.

import { VOICE_LATENCY_TURN_OUTCOMES, type VoiceLatencyTurnOutcome } from "@/lib/voice-latency-telemetry-logic";

export { VOICE_LATENCY_TURN_OUTCOMES, type VoiceLatencyTurnOutcome };

export type VoiceLatencyStage =
  | "mic_requested"
  | "mic_ready"
  | "recording_started"
  | "recording_stopped"
  | "blob_created"
  | "conversion_started"
  | "conversion_completed"
  | "stt_request_started"
  | "stt_response_received"
  | "transcript_ready"
  | "consultation_request_started"
  | "consultation_response_received"
  | "tts_request_started"
  | "tts_audio_received"
  | "audio_ready"
  | "playback_started"
  | "playback_ended";

// A plain, immutable record of stage -> the performance.now() timestamp
// (milliseconds, monotonic, sub-millisecond precision -- deliberately not
// Date.now(), which is wall-clock and can jump) it was reached. Partial
// because a turn that fails partway (e.g. STT never succeeds) or has no
// Voice Reply enabled never reaches every stage -- computeVoiceLatencySummary
// below already treats a missing mark as "not measurable", never a
// fabricated zero.
export type VoiceLatencyMarks = Partial<Record<VoiceLatencyStage, number>>;

export function markVoiceLatencyStage(
  marks: VoiceLatencyMarks,
  stage: VoiceLatencyStage,
  timestamp: number,
): VoiceLatencyMarks {
  // Never overwrites an already-recorded mark -- the FIRST time a stage is
  // reached is the real measurement; a stage should never legitimately
  // fire twice for one turn, but if some future caller did call this
  // again for the same stage, silently overwriting would corrupt an
  // already-accurate measurement.
  if (stage in marks) {
    return marks;
  }
  return { ...marks, [stage]: timestamp };
}

export function mergeVoiceLatencyMarks(a: VoiceLatencyMarks, b: VoiceLatencyMarks): VoiceLatencyMarks {
  return { ...a, ...b };
}

// Every duration this app was explicitly asked to be able to report.
// `null` (never 0, never a fabricated estimate) whenever either endpoint
// mark is missing -- e.g. sttProviderMs/consultationProviderMs/ttsProviderMs
// require a value the SERVER reported back (see the corresponding route's
// own providerLatencyMs field), never invented client-side when it wasn't.
export interface VoiceLatencySummary {
  recordingFinalizeMs: number | null;
  conversionMs: number | null;
  sttNetworkAndServerMs: number | null;
  sttProviderMs: number | null;
  sttTotalMs: number | null;
  consultationProviderMs: number | null;
  consultationTotalMs: number | null;
  // Voice latency Round 12: the server-side decomposition of
  // consultationTotalMs - consultationProviderMs, mirroring TTS's own
  // ttsPreProviderMs/ttsServerTotalMs/ttsNetworkAndTransferMs pattern
  // (Round 7) exactly -- see consultation-chat-service.ts's own
  // SendConsultationMessageResult doc comment. consultationServerTotalMs
  // is the server's own authoritative total (preProviderReadsMs +
  // providerLatencyMs [+ failedFirstAttemptMs if a retry happened] +
  // replyWriteMs + its own unattributedMs remainder);
  // consultationNetworkAndTransferMs is computed here exactly like
  // ttsNetworkAndTransferMs: consultationTotalMs minus
  // consultationServerTotalMs.
  consultationPreProviderMs: number | null;
  consultationReplyWriteMs: number | null;
  consultationFailedFirstAttemptMs: number | null;
  consultationServerTotalMs: number | null;
  consultationUnattributedMs: number | null;
  consultationNetworkAndTransferMs: number | null;
  ttsProviderMs: number | null;
  ttsTotalMs: number | null;
  // TTS latency root-cause (2026-08-19, Round 7): the server-side
  // decomposition of ttsTotalMs - ttsProviderMs (see voice-reply/route.ts's
  // own preProviderMs/usageWriteMs/audioProcessingMs/serverTotalMs and
  // CloudVoiceReplyServerTiming) -- null whenever the corresponding
  // response header was absent, never fabricated. ttsNetworkAndTransferMs
  // is computed here exactly like sttNetworkAndServerMs: ttsTotalMs minus
  // the server's own authoritative ttsServerTotalMs, isolating pure
  // network/client-side time (request + response transfer, response.blob()
  // read) from anything the server itself accounted for.
  ttsPreProviderMs: number | null;
  ttsUsageWriteMs: number | null;
  ttsAudioProcessingMs: number | null;
  ttsServerTotalMs: number | null;
  ttsNetworkAndTransferMs: number | null;
  audioPreparationMs: number | null;
  timeToFirstAudioMs: number | null;
  voiceTurnTotalMs: number | null;
  // Production observability follow-up (2026-08-19): total mic-stop-to-
  // playback-COMPLETE latency (as opposed to timeToFirstAudioMs, which
  // stops at playback START) -- only measurable for a turn that actually
  // finished playing the reply aloud, null otherwise.
  timeToPlaybackCompleteMs: number | null;
  // Round 8 (2026-08-19): a real production test showed timeToFirstAudioMs
  // (~52.9s) nearly DOUBLE the sum of sttTotalMs + consultationTotalMs +
  // ttsTotalMs (~25.5s) -- a ~27.4s gap with no single field showing where
  // it goes. Code review of every stage transition between the three
  // phases (transcript_ready -> consultation_request_started,
  // consultation_response_received -> tts_request_started) proved those
  // are synchronous, same-tick React callbacks with no await in between --
  // structurally near-zero, not a place latency can hide. That leaves
  // exactly the three phases already computed above but not summed
  // anywhere: recordingFinalizeMs, conversionMs (the WAV decode/resample --
  // see audio-wav-encode.ts's Round 7 16kHz change, real CPU work that
  // scales with recording length), and audioPreparationMs. This mirrors
  // consultationTotalMs's own unattributedMs pattern exactly: never
  // fabricated, null unless every named component AND the total were
  // actually measured.
  voiceTurnUnattributedMs: number | null;
}

function diff(marks: VoiceLatencyMarks, from: VoiceLatencyStage, to: VoiceLatencyStage): number | null {
  const a = marks[from];
  const b = marks[to];
  if (typeof a !== "number" || typeof b !== "number") return null;
  // Rounds to whole milliseconds for a readable log line -- performance.now()'s
  // own sub-millisecond precision is more resolution than a human-readable
  // duration summary needs. max(0, ...) guards only against clock/ordering
  // anomalies (e.g. two marks recorded in the same microtask on a platform
  // with coarser timer resolution) -- never hides a real negative gap
  // caused by a logic bug, which would already be an obviously wrong
  // (implausibly large or clearly out-of-order) value elsewhere in the
  // summary.
  return Math.max(0, Math.round(b - a));
}

// providerLatencyMs values are reported by the server (see voice-transcript/
// route.ts, consultation-chat-service.ts, voice-reply/route.ts -- all
// already compute this for AI Usage Metering; this reuses that exact same
// number rather than a second, client-side approximation) and merged into
// the marks object's own pseudo-stages by the caller before this is
// called -- see consultation-chat.tsx's own usage.
export interface VoiceLatencyProviderTimings {
  sttProviderMs?: number;
  consultationProviderMs?: number;
  ttsProviderMs?: number;
  // Round 7: threaded through from CloudVoiceReplyServerTiming exactly
  // like ttsProviderMs above -- undefined (never a fabricated 0) whenever
  // the caller never received the corresponding response header.
  ttsPreProviderMs?: number;
  ttsUsageWriteMs?: number;
  ttsAudioProcessingMs?: number;
  ttsServerTotalMs?: number;
  // Round 12: threaded through from consultation-chat.tsx's own reading of
  // ConsultationChatResponse -- undefined (never a fabricated 0) whenever
  // the response genuinely didn't include one (e.g. an older cached
  // response, or a failed turn with no successful reply to read from).
  consultationPreProviderMs?: number;
  consultationReplyWriteMs?: number;
  consultationFailedFirstAttemptMs?: number;
  consultationServerTotalMs?: number;
  consultationUnattributedMs?: number;
}

export function computeVoiceLatencySummary(
  marks: VoiceLatencyMarks,
  providerTimings: VoiceLatencyProviderTimings = {},
): VoiceLatencySummary {
  const sttTotalMs = diff(marks, "stt_request_started", "transcript_ready");
  const sttProviderMs = typeof providerTimings.sttProviderMs === "number" ? Math.round(providerTimings.sttProviderMs) : null;
  const consultationTotalMs = diff(marks, "consultation_request_started", "consultation_response_received");
  const consultationProviderMs =
    typeof providerTimings.consultationProviderMs === "number" ? Math.round(providerTimings.consultationProviderMs) : null;
  const consultationPreProviderMs =
    typeof providerTimings.consultationPreProviderMs === "number" ? Math.round(providerTimings.consultationPreProviderMs) : null;
  const consultationReplyWriteMs =
    typeof providerTimings.consultationReplyWriteMs === "number" ? Math.round(providerTimings.consultationReplyWriteMs) : null;
  const consultationFailedFirstAttemptMs =
    typeof providerTimings.consultationFailedFirstAttemptMs === "number"
      ? Math.round(providerTimings.consultationFailedFirstAttemptMs)
      : null;
  const consultationServerTotalMs =
    typeof providerTimings.consultationServerTotalMs === "number" ? Math.round(providerTimings.consultationServerTotalMs) : null;
  const consultationUnattributedMs =
    typeof providerTimings.consultationUnattributedMs === "number" ? Math.round(providerTimings.consultationUnattributedMs) : null;
  const consultationNetworkAndTransferMs =
    consultationTotalMs !== null && consultationServerTotalMs !== null
      ? Math.max(0, consultationTotalMs - consultationServerTotalMs)
      : null;
  const ttsTotalMs = diff(marks, "tts_request_started", "tts_audio_received");
  const ttsProviderMs = typeof providerTimings.ttsProviderMs === "number" ? Math.round(providerTimings.ttsProviderMs) : null;
  const ttsPreProviderMs = typeof providerTimings.ttsPreProviderMs === "number" ? Math.round(providerTimings.ttsPreProviderMs) : null;
  const ttsUsageWriteMs = typeof providerTimings.ttsUsageWriteMs === "number" ? Math.round(providerTimings.ttsUsageWriteMs) : null;
  const ttsAudioProcessingMs =
    typeof providerTimings.ttsAudioProcessingMs === "number" ? Math.round(providerTimings.ttsAudioProcessingMs) : null;
  const ttsServerTotalMs = typeof providerTimings.ttsServerTotalMs === "number" ? Math.round(providerTimings.ttsServerTotalMs) : null;
  const ttsNetworkAndTransferMs =
    ttsTotalMs !== null && ttsServerTotalMs !== null ? Math.max(0, ttsTotalMs - ttsServerTotalMs) : null;

  const recordingFinalizeMs = diff(marks, "recording_stopped", "blob_created");
  const conversionMs = diff(marks, "conversion_started", "conversion_completed");
  const audioPreparationMs = diff(marks, "tts_audio_received", "audio_ready");
  const timeToFirstAudioMs = diff(marks, "recording_stopped", "playback_started");
  const voiceTurnUnattributedMs =
    timeToFirstAudioMs !== null &&
    recordingFinalizeMs !== null &&
    conversionMs !== null &&
    sttTotalMs !== null &&
    consultationTotalMs !== null &&
    ttsTotalMs !== null &&
    audioPreparationMs !== null
      ? Math.max(
          0,
          timeToFirstAudioMs - (recordingFinalizeMs + conversionMs + sttTotalMs + consultationTotalMs + ttsTotalMs + audioPreparationMs),
        )
      : null;

  return {
    recordingFinalizeMs,
    conversionMs,
    sttNetworkAndServerMs: sttTotalMs !== null && sttProviderMs !== null ? Math.max(0, sttTotalMs - sttProviderMs) : null,
    sttProviderMs,
    sttTotalMs,
    consultationProviderMs,
    consultationTotalMs,
    consultationPreProviderMs,
    consultationReplyWriteMs,
    consultationFailedFirstAttemptMs,
    consultationServerTotalMs,
    consultationUnattributedMs,
    consultationNetworkAndTransferMs,
    ttsProviderMs,
    ttsTotalMs,
    ttsPreProviderMs,
    ttsUsageWriteMs,
    ttsAudioProcessingMs,
    ttsServerTotalMs,
    ttsNetworkAndTransferMs,
    audioPreparationMs,
    // Requirement: "utilizatorul trebuie să simtă că AI-ul răspunde cât mai
    // natural după ce termină de vorbit" -- measured from the moment
    // speaking stopped (recording_stopped), not from mic_requested, since
    // the stylist doesn't experience the earlier permission-grant/setup
    // time as "waiting for a reply".
    timeToFirstAudioMs,
    voiceTurnTotalMs: diff(marks, "mic_requested", "playback_started"),
    timeToPlaybackCompleteMs: diff(marks, "recording_stopped", "playback_ended"),
    voiceTurnUnattributedMs,
  };
}

// Production observability follow-up (2026-08-19): "elapsed time until
// failure" for a turn that never reaches a named end-stage mark at all
// (a failed turn has no playback_started/playback_ended to diff against)
// -- measured from mic_requested to the moment of the failure itself
// (the caller's own `nowMs`, always performance.now() at the point the
// failure/conclusion is detected). null only when mic_requested itself
// was never reached (should not happen in practice -- it's marked first
// -- but never assumed).
export function computeElapsedSinceMicRequestMs(marks: VoiceLatencyMarks, nowMs: number): number | null {
  const start = marks.mic_requested;
  if (typeof start !== "number") return null;
  return Math.max(0, Math.round(nowMs - start));
}

const VOICE_LATENCY_TAG = "VOICE_LATENCY";

// One summary line per completed (or abandoned) voice turn -- safe fields
// only: an attemptId (already the established correlation id for this
// exact turn's VOICE_TRANSCRIPT_CLIENT/VOICE_TRANSCRIPT/AI_USAGE_METERING
// lines) and whole-millisecond durations. Never the transcript, never the
// AI reply text, never audio bytes.
export function logVoiceLatencySummary(attemptId: string, summary: VoiceLatencySummary): void {
  console.log(JSON.stringify({ tag: VOICE_LATENCY_TAG, attemptId, ...summary }));
}

export interface ReportVoiceLatencySummaryDeps {
  fetch: typeof fetch;
}

// Terminal diagnostics for a FAILED (or otherwise non-fully-completed)
// turn -- optional, and meaningless/omitted for a fully successful one.
// `errorCode` is whichever specific, already-existing classification code
// was available at the point of conclusion (e.g. finishRecording's own
// VoiceTranscriptionFailureReason for STT, the chat route's
// ConsultationChatResultCode for Consult AI, the TTS route's own
// VOICE_REPLY_* error code) -- never a raw provider error message, never
// conversation content. `providerAttemptCount` mirrors STT/Consult AI's
// own "at most one retry" accounting. `elapsedSinceMicRequestMs` is
// computeElapsedSinceMicRequestMs's own output, letting an operator see
// "how long before this failed" even when no named end-stage mark was
// ever reached.
export interface VoiceLatencyTerminalDiagnostics {
  errorCode?: string;
  providerAttemptCount?: number;
  elapsedSinceMicRequestMs?: number | null;
  // Telemetry bug investigation (2026-08-19, Round 8): see
  // CloudVoiceReplyServerTiming.responseHeaderNames's own doc comment --
  // a comma-separated list of every header name the browser actually saw
  // on the TTS response, present only when a real response existed to
  // inspect (both tts_completed and tts_fallback_local originate from a
  // successful HTTP response; tts_failed and other outcomes have none).
  ttsResponseHeaders?: string;
  // Round 11 (gemini-2.5-flash-lite STT evaluation): the exact STT model
  // string the server actually resolved and used for this turn
  // (voice-transcript/route.ts's own SPEECH_TO_TEXT_MODEL/AI_ANALYSIS_MODEL/
  // hardcoded-default resolution) -- lets a real production test be
  // attributed to a model directly from this one log line, never
  // fabricated when the STT response genuinely didn't include one.
  sttModel?: string;
  // End-of-speech hardening (2026-08-20): see voice-activity-logic.ts's own
  // VoiceActivityDiagnostics doc comments for exactly what each of these
  // means and when it's null/omitted -- never fabricated, and
  // vadSilenceAfterSpeechMs specifically is only ever populated for
  // autoStopReason "stop_silence".
  vadAutoStopReason?: string;
  vadRecordingDurationMs?: number;
  vadSpeechDurationMs?: number;
  vadSilenceAfterSpeechMs?: number;
  vadSpeechDetectedAtMs?: number;
  vadSpeechEndedAtMs?: number;
  vadMaxDurationTriggered?: boolean;
  vadMode?: string;
  // STT Flash-Lite root-cause diagnosis (2026-08-20): the real Gemini
  // provider failure detail voice-transcript/route.ts's own !response.ok
  // and fetch-threw branches now return to the client (see that file's own
  // doc comments) -- previously captured ONLY in the server's own
  // VOICE_TRANSCRIPT log line, never in this summary, so a provider HTTP
  // error, a network/timeout failure, and an empty-transcript response all
  // collapsed into the same generic errorCode with no way to tell them
  // apart without manually cross-referencing a separate log line by
  // attemptId. Never fabricated -- undefined whenever the failure never
  // reached (or never returned from) the provider at all.
  sttProviderHttpStatus?: number;
  sttProviderErrorStatus?: string;
  // STT 404 root-cause diagnosis (2026-08-21): Google's own diagnostic
  // message for the error, sanitized/bounded server-side (see
  // voice-transcript/route.ts's own sanitizeProviderErrorMessage) --
  // genuinely free text, unlike sttProviderErrorStatus's fixed vocabulary.
  sttProviderErrorMessage?: string;
  sttProviderFetchErrorName?: string;
  // Consult AI 404/PROVIDER_UNAVAILABLE root-cause diagnosis (2026-08-21):
  // the same real Gemini failure detail as the stt* fields above, for the
  // consultation stage instead -- see consultation-chat-provider.ts's own
  // ChatProviderError doc comment for exactly what each means.
  consultationProviderHttpStatus?: number;
  consultationProviderErrorStatus?: string;
  consultationProviderErrorMessage?: string;
  // Voice latency optimization audit (2026-08-21): a real production test
  // showed both consultationProviderMs (~4.8s) and ttsProviderMs (~10.6s)
  // dominated by provider-side generation time, with only ~350ms of this
  // app's own overhead in either case -- the single most actionable, safe
  // lever for both is the LENGTH of the reply text itself (Consult AI
  // generates it, TTS speaks it verbatim). Lets a real production test
  // correlate reply length directly against both provider latencies from
  // this one log line, without guessing. Never fabricated -- undefined
  // whenever no reply text exists yet.
  voiceReplyTextLength?: number;
  // Consult AI provider latency variance audit (2026-08-21): a real
  // production comparison showed consultationProviderMs swinging from
  // ~4.8s to ~19.5s for structurally the same call, with this app's own
  // overhead staying flat at ~350ms both times -- these let a real test
  // correlate that swing against real Gemini-supplied token usage
  // (thinking/reasoning tokens especially, since neither request set an
  // explicit thinkingConfig, so the model's own default/automatic
  // reasoning budget is a live candidate) and the actual context size sent
  // (history/memory/input), never fabricated when the provider or the
  // context genuinely didn't produce one.
  consultationPromptTokens?: number;
  consultationOutputTokens?: number;
  consultationThinkingTokens?: number;
  consultationCachedTokens?: number;
  consultationHistoryMessageCount?: number;
  consultationHistoryChars?: number;
  consultationMemoryChars?: number;
  consultationInputChars?: number;
  // Consult AI voice thinking A/B (2026-08-21): the real Gemini
  // thinking_level this exact reply used, or "default" when no override
  // applied -- see consultation-chat-provider.ts's own ConsultationChatResult
  // doc comment. Lets a real production A/B test tell, from this one log
  // line, which mode actually produced a given reply.
  consultationThinkingMode?: string;
  // VAD false-negative hardening (2026-08-21): see voice-activity-logic.ts's
  // own VoiceActivityDiagnostics doc comments for exactly what each of
  // these answers -- always a real number (0 is truthful, never a
  // fabricated placeholder) whenever VAD ran at all for this attempt.
  vadPeakRms?: number;
  vadPeakSpeechBandRatio?: number;
  vadFinalNoiseFloor?: number;
  vadMaxCandidateSpeechMs?: number;
  vadCandidateResetCount?: number;
  vadFullyQualifiedSampleCount?: number;
}

// Fire-and-forget: ships the SAME summary already logged locally (see
// logVoiceLatencySummary above) to the server, so it also becomes visible
// in Railway Deploy Logs (see that route's own doc comment for the root
// cause this closes). `outcome` records WHERE this turn actually
// concluded (STT failure, Consult AI failure, TTS fallback, full
// playback, ...) -- purely a technical/timing classification, never
// derived from or containing any conversation content.
//
// A failure here (network error, non-2xx response, an ad-blocker) is
// deliberately swallowed and NEVER surfaced to the stylist or allowed to
// affect the voice pipeline in any way -- this is best-effort
// observability, not a required step of the voice turn itself.
export function reportVoiceLatencySummary(
  clientId: string,
  attemptId: string,
  outcome: VoiceLatencyTurnOutcome,
  summary: VoiceLatencySummary,
  deps: ReportVoiceLatencySummaryDeps,
  diagnostics: VoiceLatencyTerminalDiagnostics = {},
): void {
  void deps
    .fetch(`/api/v1/clients/${clientId}/voice-latency`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // Round 9: clientBuildSha rides along on every report automatically
      // (never left to individual call sites to remember) -- see
      // next.config.ts's own doc comment on resolveBuildCommitSha for why
      // this exists. NEXT_PUBLIC_APP_COMMIT_SHA is statically inlined at
      // build time, so this is always the SHA of whatever bundle is
      // actually executing, not a runtime guess.
      body: JSON.stringify({
        attemptId,
        outcome,
        summary,
        ...diagnostics,
        clientBuildSha: process.env.NEXT_PUBLIC_APP_COMMIT_SHA,
      }),
    })
    .catch(() => {});
}
