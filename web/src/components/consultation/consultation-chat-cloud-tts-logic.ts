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
}

export interface SynthesizeCloudVoiceReplyCallbacks {
  onSuccess: (audioBlob: Blob) => void;
  // "network": the request never completed (fetch threw -- offline, CORS,
  // the request never left the browser). "unavailable": a real HTTP
  // response came back, but not 2xx (provider not configured, rate
  // limited, timed out server-side, unsupported language, etc.) -- the
  // SPECIFIC reason (e.g. VOICE_REPLY_PROVIDER_NOT_CONFIGURED vs
  // VOICE_REPLY_RATE_LIMITED) is read from the response body and logged
  // via logVoiceReplyClientEvent above, not lost -- this callback
  // parameter only needs to know "cloud didn't work, fall back" for
  // either case.
  onFailure: (reason: CloudVoiceReplyFailureReason) => void;
}

export async function synthesizeCloudVoiceReply(
  clientId: string,
  text: string,
  language: LanguageCode,
  deps: SynthesizeCloudVoiceReplyDeps,
  callbacks: SynthesizeCloudVoiceReplyCallbacks,
): Promise<void> {
  let response: Response;
  try {
    logVoiceReplyClientEvent("cloud_request_initiated", { language, textLength: text.length });
    response = await deps.fetch(`/api/v1/clients/${clientId}/voice-reply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, language }),
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
    // Best-effort: the route always returns a JSON { error, message } body
    // on failure, but this must never throw the whole flow into the
    // catch-all below if that body is somehow missing/malformed.
    const errorCode = await response
      .clone()
      .json()
      .then((body: { error?: string }) => body.error ?? "unknown")
      .catch(() => "unknown");
    logVoiceReplyClientEvent("cloud_response_not_ok", { status: response.status, errorCode });
    callbacks.onFailure("unavailable");
    return;
  }

  try {
    const blob = await response.blob();
    logVoiceReplyClientEvent("cloud_success", { audioBytes: blob.size });
    callbacks.onSuccess(blob);
  } catch (error) {
    logVoiceReplyClientEvent("cloud_blob_read_threw", {
      errorName: error instanceof Error ? error.name : "unknown",
    });
    callbacks.onFailure("unavailable");
  }
}
