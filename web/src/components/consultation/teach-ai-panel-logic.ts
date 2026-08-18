// Speak to AI's voice-note lifecycle, pulled out of teach-ai-panel.tsx so it
// is unit-testable without a rendering environment (no .test.tsx convention
// exists in this repo -- see analysis-original-photo-logic.ts).
//
// Regression: a live report where, after manually stopping the recorder,
// "Listening..." stayed on screen forever -- no transcript, no processing
// message, no error. Root cause: MediaRecorder's onstop was an async arrow
// function with no try/catch; any failure inside it (a network error, a
// non-ok response, response.json() throwing on a non-JSON body) became a
// silently swallowed unhandled promise rejection, so nothing ever updated
// the UI again. finishRecording is now the single place that both (a)
// always replaces "Listening..." the instant the recorder actually stops
// -- via onStopped, called synchronously before anything async runs, so it
// fires regardless of whether the stop was a manual click or the browser/
// OS ending the track itself -- and (b) wraps the entire transcription
// request in a try/catch so no failure path can ever leave the UI stuck.
//
// Voice reliability hardening (2026-08-18): a production incident report
// ("Voice transcription failed") could not be root-caused with certainty
// (no reproducing evidence was ever obtained -- see the commit report for
// this change). Rather than guess at a fix, this hardens the whole
// attempt lifecycle so a transient failure of ANY kind -- network blip,
// a momentary provider/DB hiccup, or landing on a different instance
// mid-deploy -- recovers automatically at most once, and any failure
// (transient or not) always leaves the mic ready for a fresh attempt
// with no reload required.

import type { LanguageCode } from "@/lib/language-registry";

export interface VoiceNoteStreamLike {
  getTracks(): { stop(): void }[];
}

// Voice reliability hardening (2026-08-18) -- proven production evidence
// (a real Gemini 503, correctly retried once, still failed) showed the
// generic "Voice transcription failed" message read as "the microphone is
// broken" even though the recording completed and uploaded successfully.
// This reason is ALWAYS derivable from what genuinely happened (never
// guessed): "providerUnavailable" only after a real request reached the
// server and the server reported a transient provider/network problem;
// "saveUnavailable" only when the transcription itself succeeded but
// persisting it did not; "unsupportedFormat"/"invalidAudio" only from the
// server's own specific rejection codes; "emptyRecording" only from this
// file's own 0-byte check, before any request is ever sent. The caller
// (use-voice-recording.ts, teach-ai-panel.tsx) maps this to a translated,
// honest message -- never implying the microphone failed when it
// demonstrably didn't.
export type VoiceTranscriptionFailureReason =
  | "providerUnavailable"
  | "saveUnavailable"
  | "unsupportedFormat"
  | "invalidAudio"
  | "emptyRecording"
  | "unknown";

export interface FinishRecordingCallbacks {
  onStopped: () => void;
  onFailure: (message: string, reason: VoiceTranscriptionFailureReason) => void;
  onSuccess: (transcript: string, transcriptId: string | undefined) => void;
}

export interface FinishRecordingDeps {
  fetch: typeof fetch;
  // Converts the raw recorded Blob to a Gemini-supported WAV Blob before
  // upload -- see audio-wav-encode.ts's own module comment for the full
  // root cause this exists for: MediaRecorder's own container format
  // (audio/webm;codecs=opus on Chrome/Android) is not among Gemini's
  // documented supported audio input formats and reliably fails
  // generateContent with a provider-side 500, on every platform, not just
  // iOS. Injected (not called directly) so this stays unit-testable
  // without a real AudioContext, which jsdom does not implement. Omitted,
  // or rejecting, falls back to uploading the original recording
  // unchanged -- this must never be the only path to a working upload,
  // only the fix for that one specific, demonstrated format failure.
  encodeAsWav?: (blob: Blob) => Promise<Blob>;
}

const GENERIC_TRANSCRIPTION_FAILURE_MESSAGE = "Voice transcription failed. You can still type your note.";
const EMPTY_RECORDING_MESSAGE = "The recording was empty. Please try again and speak for a moment before stopping.";

// A hung upload (a dropped connection, or landing on an instance that never
// responds during a rolling deploy) must not leave the mic permanently
// disabled -- the server's own Gemini call already bounds itself to 30s
// (voice-transcript/route.ts's PROVIDER_TIMEOUT_MS); this client-side
// budget is deliberately generous above that so a genuinely slow-but-
// working request is never aborted prematurely, while a truly hung one
// still resolves (as a retryable failure) instead of hanging forever.
const CLIENT_UPLOAD_TIMEOUT_MS = 45_000;

// Regression: a live report showed this exact generic message with no
// further clue, and -- critically -- Railway's Deploy Logs showed zero
// VOICE_TRANSCRIPT lines at all after reproducing it, meaning the request
// may never have reached the backend's route handler in the first place.
// Without client-side visibility, "fetch threw before ever reaching the
// server" and "server rejected the request" were indistinguishable. These
// logs (safe fields only -- never audio bytes, never transcript text,
// never any token/cookie) let a single browser-console read settle which
// one actually happened.
const CLIENT_LOG_TAG = "VOICE_TRANSCRIPT_CLIENT";

// Exported so teach-ai-panel.tsx can log the one step that happens before
// finishRecording is ever called (recording actually starting) with the
// exact same tag/shape.
export function logClient(event: string, details: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ tag: CLIENT_LOG_TAG, event, ...details }));
}

// Regression: the demonstrated root cause of the live "Voice transcription
// failed" report. `{ fetch }` (object shorthand for `{ fetch: fetch }`)
// stores the bare global function reference as a plain object's property.
// A real browser's native fetch is a *branded* method -- it requires
// `this` to be exactly the window/global object it's defined on. Calling
// it later as `deps.fetch(...)` invokes it with `this === deps` (plain
// method-call syntax always binds `this` to the object before the dot),
// which throws "TypeError: Failed to execute 'fetch' on 'Window': Illegal
// invocation" -- synchronously, before any network request is ever made.
// This was invisible in every test because a mocked fetch (vi.fn()) never
// checks `this` at all; only a real browser's native implementation does.
// bindFetch fixes this at the one place a real fetch reference is ever
// captured, so it works correctly no matter how it's later invoked.
export function bindFetch(nativeFetch: typeof fetch): typeof fetch {
  return nativeFetch.bind(globalThis);
}

// Voice reliability hardening: one attemptId ties together every log line
// (client console AND, once threaded through to the request, the server's
// own VOICE_TRANSCRIPT lines and its AI usage metering row) for a single
// logical mic-press-to-result cycle -- including its retry, if any, which
// shares the same attemptId with a different attemptNumber. A stylist-
// reported incident can now be found by this one id across both sides,
// instead of correlating by approximate timestamp.
export function generateAttemptId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `attempt-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export type MicrophoneStartFailureReason = "denied" | "unavailable";

// Shared by both microphone entry points (use-voice-recording.ts's chat
// composer and teach-ai-panel.tsx's own recorder) so a permission denial
// is never confused with every other kind of startup failure (no
// microphone present, hardware already claimed by another app/tab, or
// MediaRecorder itself throwing for an unsupported mimeType) -- the two
// need different guidance: a denial is something only the stylist can fix
// in their own browser's site settings, "unavailable" is worth a plain
// retry. NotAllowedError is the current DOM spec's name for a user/OS
// permission refusal; PermissionDeniedError is the older, non-standard
// name some browsers historically used for the exact same condition.
export function classifyMicrophoneStartError(error: unknown): MicrophoneStartFailureReason {
  const name = error instanceof Error ? error.name : "";
  return name === "NotAllowedError" || name === "PermissionDeniedError" ? "denied" : "unavailable";
}

// The exact server-side error codes (voice-transcript/route.ts's own
// vocabulary) that represent a genuinely transient condition -- a provider
// hiccup or a momentary persistence problem, never a permanent one.
// Retrying VOICE_PROVIDER_NOT_CONFIGURED, an invalid/unsupported format,
// a rate limit, or an auth failure would never change the outcome and
// would only waste a second attempt (and, for the provider path, a second
// real Gemini call) -- so only these two are ever eligible for the single
// automatic retry below. VOICE_TRANSCRIPT_PERSISTENCE_UNAVAILABLE is a
// deliberate inclusion despite the retry re-spending real provider cost
// (the transcription itself already succeeded once) -- the alternative is
// the stylist's note being silently lost, which is worse.
const RETRYABLE_ERROR_CODES = new Set(["VOICE_TRANSCRIPTION_FAILED", "VOICE_TRANSCRIPT_PERSISTENCE_UNAVAILABLE"]);

// Maps the server's own error vocabulary (voice-transcript/route.ts) to the
// honest, distinguishable reason shown to the stylist. Every code the
// server can genuinely return is listed explicitly -- an unrecognized one
// (should never happen, but never trusted blindly) falls back to
// "unknown", the same generic message this app always showed before this
// change, never a fabricated specific claim.
function reasonForServerErrorCode(errorCode: string | null): VoiceTranscriptionFailureReason {
  switch (errorCode) {
    case "VOICE_TRANSCRIPTION_FAILED":
    case "VOICE_PROVIDER_NOT_CONFIGURED":
      // Both genuinely mean "the AI transcription service isn't available
      // right now" from the stylist's point of view -- whether the real
      // cause is a transient provider hiccup or a missing server
      // configuration is an operator-facing distinction (see the
      // corresponding Railway logs), never a useful one for the stylist,
      // and conflating them here never overstates certainty either way.
      return "providerUnavailable";
    case "VOICE_TRANSCRIPT_PERSISTENCE_UNAVAILABLE":
      return "saveUnavailable";
    case "UNSUPPORTED_AUDIO_FORMAT":
      return "unsupportedFormat";
    case "Invalid audio.":
      return "invalidAudio";
    default:
      return "unknown";
  }
}

type UploadAttemptResult =
  | { outcome: "success"; transcript: string; transcriptId: string | undefined }
  | { outcome: "failure"; message: string; reason: VoiceTranscriptionFailureReason; retryable: boolean };

async function attemptUpload(
  clientId: string,
  audioBlob: Blob,
  language: LanguageCode | undefined,
  attemptId: string,
  attemptNumber: number,
  fetchFn: typeof fetch,
): Promise<UploadAttemptResult> {
  const form = new FormData();
  form.append("audio", audioBlob, audioBlob.type === "audio/wav" ? "note.wav" : "note.webm");
  if (language) {
    form.append("language", language);
  }
  // Threaded straight through to recordAiUsageEvent's own correlationId/
  // attemptNumber (see voice-transcript/route.ts) so a retry is recorded
  // as a second, distinct usage event under the SAME logical attempt --
  // never silently merged into one, since two real HTTP calls can mean
  // two real provider charges.
  form.append("attemptId", attemptId);
  form.append("attemptNumber", String(attemptNumber));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CLIENT_UPLOAD_TIMEOUT_MS);

  let response: Response;
  try {
    logClient("request_initiated", { attemptId, attemptNumber });
    response = await fetchFn(`/api/v1/clients/${clientId}/voice-transcript`, { method: "POST", body: form, signal: controller.signal });
    logClient("response_received", { attemptId, attemptNumber, status: response.status, ok: response.ok });
  } catch (error) {
    // The exact previously-invisible failure mode: fetch itself throwing
    // (a network error, a CORS/CSP rejection, the client-side timeout
    // above firing, or the request never leaving the browser at all)
    // means the backend's own VOICE_TRANSCRIPT logging (added separately)
    // can never fire, no matter how thorough it is -- this is the only
    // place that failure is observable. Treated as retryable: a dropped
    // connection or a momentarily unreachable instance (e.g. mid-deploy)
    // is exactly the class of failure a single retry is meant for.
    logClient("fetch_threw", {
      attemptId,
      attemptNumber,
      errorName: error instanceof Error ? error.name : "unknown",
      errorMessage: error instanceof Error ? error.message : String(error),
      aborted: controller.signal.aborted,
    });
    // A network-level failure never distinguishes "recording problem" from
    // "service problem" the way a real server response does -- honestly
    // the least specific case, so "unknown" here (the same generic
    // message this app always showed) rather than overclaiming the AI
    // service specifically is at fault when the request may never have
    // reached it at all.
    return { outcome: "failure", message: GENERIC_TRANSCRIPTION_FAILURE_MESSAGE, reason: "unknown", retryable: true };
  } finally {
    clearTimeout(timer);
  }

  let payload: { transcript?: string; transcriptId?: string; message?: string; error?: string };
  try {
    payload = await response.json();
  } catch (error) {
    // Distinct from fetch_threw: the request DID reach some server (a
    // response with a real status came back), but its body wasn't valid
    // JSON -- e.g. an HTML error page from an edge/proxy layer in front
    // of the Next.js app, never the app's own route handler at all, or a
    // momentary mismatch while Railway rotates to a new deployment.
    // Retryable for the same reason: the SAME request a moment later is
    // very likely to land on a healthy instance.
    logClient("response_json_parse_threw", {
      attemptId,
      attemptNumber,
      status: response.status,
      errorName: error instanceof Error ? error.name : "unknown",
    });
    return { outcome: "failure", message: GENERIC_TRANSCRIPTION_FAILURE_MESSAGE, reason: "unknown", retryable: true };
  }

  if (!response.ok) {
    const errorCode = payload.error ?? null;
    logClient("response_not_ok", { attemptId, attemptNumber, status: response.status, errorCode, hasMessage: Boolean(payload.message) });
    const retryable = typeof errorCode === "string" && RETRYABLE_ERROR_CODES.has(errorCode);
    return {
      outcome: "failure",
      message: payload.message || GENERIC_TRANSCRIPTION_FAILURE_MESSAGE,
      reason: reasonForServerErrorCode(errorCode),
      retryable,
    };
  }

  logClient("success", { attemptId, attemptNumber, transcriptLength: (payload.transcript ?? "").length });
  return { outcome: "success", transcript: payload.transcript ?? "", transcriptId: payload.transcriptId };
}

export async function finishRecording(
  stream: VoiceNoteStreamLike,
  chunks: Blob[],
  mimeType: string,
  clientId: string,
  callbacks: FinishRecordingCallbacks,
  deps: FinishRecordingDeps,
  // Appended as a new trailing optional param (not inserted earlier) so
  // every existing positional call site keeps compiling unchanged. Passed
  // straight through to voice-transcript/route.ts's own optional "language"
  // form field -- see that route for why this can only be a prompt-text
  // hint, never a real provider config option.
  language?: LanguageCode,
  // Voice reliability hardening: lets a caller that already generated an
  // attemptId at recording-start time (see use-voice-recording.ts's
  // mic_requested/mic_granted/recorder_started events) carry the SAME id
  // through to this call, so the full mic-press-to-result lifecycle is
  // one traceable id, not two. Defaults to a fresh one so every pre-
  // existing call site (which never passes this) keeps working unchanged.
  attemptId: string = generateAttemptId(),
): Promise<void> {
  stream.getTracks().forEach((track) => track.stop());
  callbacks.onStopped();
  logClient("recording_stopped", { attemptId });

  try {
    let blob = new Blob(chunks, { type: mimeType || "audio/webm" });
    logClient("blob_created", { attemptId, mimeType: blob.type, sizeBytes: blob.size });

    if (deps.encodeAsWav) {
      try {
        blob = await deps.encodeAsWav(blob);
        logClient("wav_reencode_succeeded", { attemptId, mimeType: blob.type, sizeBytes: blob.size });
      } catch (error) {
        // Falls back to the original recording unchanged -- see
        // FinishRecordingDeps.encodeAsWav's own doc comment. Still worth
        // an honest attempt at transcription rather than failing the
        // whole flow here: the original format may happen to be one
        // Gemini does accept (e.g. Safari's audio/mp4).
        logClient("wav_reencode_failed", {
          attemptId,
          errorName: error instanceof Error ? error.name : "unknown",
          errorMessage: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Voice reliability hardening: a recording that produced literally no
    // audio data (chunks.current stayed empty -- the mic was tapped and
    // released faster than MediaRecorder's own first dataavailable event)
    // is caught here, before ever spending a network round-trip or a real
    // provider call on a request that could only ever come back empty.
    // Deliberately the same "0 bytes" threshold the server itself already
    // enforces (voice-transcript/route.ts's own audio.size === 0 check),
    // not a fragile "too short in duration" heuristic that could reject a
    // legitimate quick "yes"/"no" note.
    if (blob.size === 0) {
      logClient("request_failed", { attemptId, reason: "empty_recording" });
      callbacks.onFailure(EMPTY_RECORDING_MESSAGE, "emptyRecording");
      logClient("cleanup_completed", { attemptId });
      return;
    }

    let attemptNumber = 1;
    let result = await attemptUpload(clientId, blob, language, attemptId, attemptNumber, deps.fetch);

    // Never more than one retry, and only for a failure explicitly
    // classified as transient -- a permanent failure (wrong format, no
    // provider configured, rate limited, unauthenticated) is retried zero
    // times, since retrying could never change the outcome.
    if (result.outcome === "failure" && result.retryable) {
      attemptNumber = 2;
      logClient("retry_started", { attemptId, attemptNumber });
      result = await attemptUpload(clientId, blob, language, attemptId, attemptNumber, deps.fetch);
    }

    if (result.outcome === "success") {
      callbacks.onSuccess(result.transcript, result.transcriptId);
    } else {
      logClient("request_failed", { attemptId, attemptNumber, reason: "upload_failed", failureReason: result.reason });
      callbacks.onFailure(result.message, result.reason);
    }
    logClient("cleanup_completed", { attemptId });
  } catch (error) {
    // Defensive catch-all preserving the original fix's own guarantee:
    // nothing here can ever leave the UI stuck on "Listening...", even an
    // unexpected failure in Blob/FormData construction itself.
    logClient("unexpected_error", {
      attemptId,
      errorName: error instanceof Error ? error.name : "unknown",
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    callbacks.onFailure(GENERIC_TRANSCRIPTION_FAILURE_MESSAGE, "unknown");
    logClient("cleanup_completed", { attemptId });
  }
}
