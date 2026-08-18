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
  ttsProviderMs: number | null;
  ttsTotalMs: number | null;
  audioPreparationMs: number | null;
  timeToFirstAudioMs: number | null;
  voiceTurnTotalMs: number | null;
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
  const ttsTotalMs = diff(marks, "tts_request_started", "tts_audio_received");
  const ttsProviderMs = typeof providerTimings.ttsProviderMs === "number" ? Math.round(providerTimings.ttsProviderMs) : null;

  return {
    recordingFinalizeMs: diff(marks, "recording_stopped", "blob_created"),
    conversionMs: diff(marks, "conversion_started", "conversion_completed"),
    sttNetworkAndServerMs: sttTotalMs !== null && sttProviderMs !== null ? Math.max(0, sttTotalMs - sttProviderMs) : null,
    sttProviderMs,
    sttTotalMs,
    consultationProviderMs,
    consultationTotalMs,
    ttsProviderMs,
    ttsTotalMs,
    audioPreparationMs: diff(marks, "tts_audio_received", "audio_ready"),
    // Requirement: "utilizatorul trebuie să simtă că AI-ul răspunde cât mai
    // natural după ce termină de vorbit" -- measured from the moment
    // speaking stopped (recording_stopped), not from mic_requested, since
    // the stylist doesn't experience the earlier permission-grant/setup
    // time as "waiting for a reply".
    timeToFirstAudioMs: diff(marks, "recording_stopped", "playback_started"),
    voiceTurnTotalMs: diff(marks, "mic_requested", "playback_started"),
  };
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
): void {
  void deps
    .fetch(`/api/v1/clients/${clientId}/voice-latency`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ attemptId, outcome, summary }),
    })
    .catch(() => {});
}
