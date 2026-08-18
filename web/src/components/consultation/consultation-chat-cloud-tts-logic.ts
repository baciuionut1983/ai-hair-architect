// The network half of cloud Voice Reply -- calling POST
// /api/v1/clients/{id}/voice-reply and turning its response into either a
// playable audio Blob or a classified failure reason. Pulled out of
// consultation-chat.tsx for the same reason teach-ai-panel-logic.ts's
// finishRecording is separate from use-voice-recording.ts's MediaRecorder
// wiring: this half is pure enough to unit-test with a mocked fetch (no
// .test.tsx convention exists in this repo), while the actual Audio-
// element/object-URL playback mechanics are DOM-only and stay in the
// component, exactly like MediaRecorder's own wiring does.
//
// This never generates a second, separately-worded reply -- callers must
// pass the EXACT text already shown in the message bubble; this function
// only ever forwards it.
//
// Regression this logging exists for: a live production report showed
// Romanian Voice Reply falling straight to "No Romanian voice is
// installed... reading with the browser's default voice instead" -- the
// LOCAL fallback's own honest message, which only proves cloud TTS was
// attempted and failed, never says WHY. Before this, that failure was
// silently swallowed: onFailure's `reason` parameter told the caller
// "fall back" but was never logged anywhere, so distinguishing "cloud not
// configured on Railway yet" from "a real provider error" required
// guessing. Same tag/shape/safe-fields convention as teach-ai-panel-
// logic.ts's VOICE_TRANSCRIPT_CLIENT (never the reply text, never a
// token/cookie) -- a single browser-console read now settles which one
// actually happened.
//
// Naming regression found on the FIRST live retest of this logging: this
// tag ("VOICE_REPLY_CLIENT") collides with an older, separate log source
// -- consultation-chat-tts-logic.ts's own local-Web-Speech-only logging,
// which ALSO used this exact tag (pre-dating cloud TTS entirely). A
// retest that filtered the console by this tag saw only that older
// source's "speak_requested" event and NONE of this file's events at
// all -- which, combined with every other diagnostic check, points to
// the deployed bundle predating this file, not a live bug in it. Event
// names are now prefixed "cloud_" specifically so the SOURCE is
// unambiguous from the event name alone, without requiring two different
// tags (the local file's own event is now "local_speak_requested" -- see
// consultation-chat-tts-logic.ts).

import type { LanguageCode } from "@/lib/language-registry";

export const VOICE_REPLY_CLIENT_LOG_TAG = "VOICE_REPLY_CLIENT";

export function logVoiceReplyClientEvent(event: string, details: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ tag: VOICE_REPLY_CLIENT_LOG_TAG, event, ...details }));
}

export type CloudVoiceReplyFailureReason = "network" | "unavailable";

export interface SynthesizeCloudVoiceReplyDeps {
  fetch: typeof fetch;
  // Voice reliability hardening (2026-08-18): optional -- when the caller
  // supersedes this attempt (a second message sent, or Stop pressed)
  // before this request resolves, aborting it stops wasting network/
  // provider effort on a response nobody will act on (consultation-
  // chat.tsx's own voiceReplyAttemptRef guard already makes acting on a
  // stale response impossible regardless; this only avoids the wasted
  // round-trip). Omitted entirely, the request simply runs to completion
  // as it always has.
  signal?: AbortSignal;
}

export interface SynthesizeCloudVoiceReplyCallbacks {
  // Voice latency audit (2026-08-18): ttsProviderMs is the SERVER's own
  // measured Gemini TTS call duration (see voice-reply/route.ts's
  // X-Provider-Latency-Ms response header -- the same number it already
  // computes for AI Usage Metering), never a client-side approximation.
  // `null` when the header is absent (e.g. an older cached/proxied
  // response) -- never fabricated. TTS reliability hardening
  // (2026-08-19): providerAttemptCount is the server's own real count (1,
  // or 2 if its single automatic retry recovered a transient failure),
  // read from X-Provider-Attempt-Count -- null only when the header is
  // genuinely absent.
  onSuccess: (audioBlob: Blob, ttsProviderMs: number | null, providerAttemptCount: number | null) => void;
  // "network": the request never completed (fetch threw -- offline, CORS,
  // the request never left the browser). "unavailable": a real HTTP
  // response came back, but not 2xx (provider not configured, rate
  // limited, timed out server-side, unsupported language, etc.) -- the
  // SPECIFIC reason (e.g. VOICE_REPLY_PROVIDER_NOT_CONFIGURED vs
  // VOICE_REPLY_RATE_LIMITED) is read from the response body and logged
  // via logVoiceReplyClientEvent above, not lost -- this callback
  // parameter only needs to know "cloud didn't work, fall back" for
  // either case. TTS reliability hardening (2026-08-19): errorCode/
  // providerAttemptCount surface the server's own final classification
  // and real attempt count (after its own retry was already exhausted)
  // for voice latency telemetry -- undefined only when genuinely
  // unavailable (e.g. "network", where no server response body exists at
  // all), never fabricated.
  onFailure: (reason: CloudVoiceReplyFailureReason, errorCode?: string, providerAttemptCount?: number) => void;
}

export async function synthesizeCloudVoiceReply(
  clientId: string,
  text: string,
  language: LanguageCode,
  deps: SynthesizeCloudVoiceReplyDeps,
  callbacks: SynthesizeCloudVoiceReplyCallbacks,
  // End-to-end voice turn correlation (2026-08-19): the SAME id already
  // used for STT (use-voice-recording.ts's own attemptId) -- appended as a
  // new trailing optional param so every existing call site keeps
  // compiling unchanged. undefined for a typed message's Voice Reply
  // (voiceTurnId simply omitted from the request body, never invented).
  voiceTurnId?: string,
): Promise<void> {
  let response: Response;
  try {
    logVoiceReplyClientEvent("cloud_request_initiated", { language, textLength: text.length });
    response = await deps.fetch(`/api/v1/clients/${clientId}/voice-reply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, language, ...(voiceTurnId ? { voiceTurnId } : {}) }),
      ...(deps.signal ? { signal: deps.signal } : {}),
    });
    logVoiceReplyClientEvent("cloud_response_received", { status: response.status, ok: response.ok });
  } catch (error) {
    logVoiceReplyClientEvent("cloud_fetch_threw", {
      errorName: error instanceof Error ? error.name : "unknown",
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    callbacks.onFailure("network");
    return;
  }

  if (!response.ok) {
    // Best-effort: the route always returns a JSON { error, message,
    // providerAttemptCount? } body on failure, but this must never throw
    // the whole flow into the catch-all below if that body is somehow
    // missing/malformed.
    const parsedBody = await response
      .clone()
      .json()
      .then((body: { error?: string; providerAttemptCount?: number }) => body)
      .catch(() => null as { error?: string; providerAttemptCount?: number } | null);
    const errorCode = parsedBody?.error ?? "unknown";
    logVoiceReplyClientEvent("cloud_response_not_ok", { status: response.status, errorCode });
    callbacks.onFailure("unavailable", errorCode, parsedBody?.providerAttemptCount);
    return;
  }

  try {
    const blob = await response.blob();
    const latencyHeader = response.headers.get("X-Provider-Latency-Ms");
    const ttsProviderMs = latencyHeader !== null && Number.isFinite(Number(latencyHeader)) ? Number(latencyHeader) : null;
    const attemptCountHeader = response.headers.get("X-Provider-Attempt-Count");
    const providerAttemptCount =
      attemptCountHeader !== null && Number.isFinite(Number(attemptCountHeader)) ? Number(attemptCountHeader) : null;
    logVoiceReplyClientEvent("cloud_success", { audioBytes: blob.size });
    callbacks.onSuccess(blob, ttsProviderMs, providerAttemptCount);
  } catch (error) {
    logVoiceReplyClientEvent("cloud_blob_read_threw", {
      errorName: error instanceof Error ? error.name : "unknown",
    });
    callbacks.onFailure("unavailable");
  }
}
