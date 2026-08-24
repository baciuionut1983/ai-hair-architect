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

// TTS latency root-cause (2026-08-19, Round 7): a real production test
// showed ttsTotalMs roughly double ttsProviderMs with no way to tell why.
// This bundles the server's own granular breakdown (voice-reply/route.ts's
// new X-Pre-Provider-Ms/X-Usage-Write-Ms/X-Audio-Processing-Ms/
// X-Server-Total-Ms headers) so the caller can compute exactly where the
// rest of that gap goes, the same "never fabricate, null when the header
// is genuinely absent" contract every other field here already follows.
export interface CloudVoiceReplyServerTiming {
  ttsProviderMs: number | null;
  providerAttemptCount: number | null;
  preProviderMs: number | null;
  usageWriteMs: number | null;
  audioProcessingMs: number | null;
  serverTotalMs: number | null;
  // Telemetry bug investigation (2026-08-19, Round 8): a real production
  // test showed ttsProviderMs correctly populated from X-Provider-Latency-Ms
  // while the four newer Round 7 headers (X-Pre-Provider-Ms etc.) all read
  // as null, despite voice-reply/route.ts's own success log proving it
  // computed and sent real values -- server code and this file's own
  // header-reading code (identical numericHeader mechanism for all six)
  // were both reviewed and are correct as written. This captures exactly
  // which header names the browser actually saw on the response, so the
  // next real test tells us definitively whether this is headers being
  // dropped in transit (this list would be missing the new ones) or
  // something else -- never guessed.
  responseHeaderNames: string;
  // VOICE NEXT LEVEL, Phase D (2026-08-24): the real per-attempt
  // breakdown -- see voice-reply/route.ts's own X-Attempt1-*/X-Attempt2-*
  // headers and provider-attempt-telemetry-logic.ts's own doc comment for
  // the real production gap this closes. null (never fabricated) whenever
  // that attempt's own header is genuinely absent -- attempt2* stays null
  // for every turn that never retried.
  attempt1Ms: number | null;
  attempt1Outcome: string | null;
  attempt1HttpStatus: number | null;
  attempt2Ms: number | null;
  attempt2Outcome: string | null;
  attempt2HttpStatus: number | null;
}

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
  // Voice latency audit (2026-08-18) / Round 7: `timing` is entirely the
  // SERVER's own measured breakdown (see CloudVoiceReplyServerTiming's own
  // field docs and voice-reply/route.ts's X-*-Ms response headers), never
  // a client-side approximation -- each field is `null` individually when
  // its header is absent (e.g. an older cached/proxied response), never
  // fabricated.
  onSuccess: (audioBlob: Blob, timing: CloudVoiceReplyServerTiming) => void;
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
  // VOICE NEXT LEVEL, Phase D (2026-08-24): attempt1/attempt2 mirror
  // CloudVoiceReplyServerTiming's own identical fields, read from the
  // failure JSON body instead of response headers (a failure response has
  // a real JSON body, unlike a success response's raw audio bytes) --
  // undefined only for a genuine "network" failure, where no server
  // response body exists at all to read them from.
  onFailure: (
    reason: CloudVoiceReplyFailureReason,
    errorCode?: string,
    providerAttemptCount?: number,
    attempt1?: { ms: number; outcome: string; httpStatus?: number },
    attempt2?: { ms: number; outcome: string; httpStatus?: number },
  ) => void;
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
    type FailureBody = {
      error?: string;
      providerAttemptCount?: number;
      ttsAttempt1Ms?: number;
      ttsAttempt1Outcome?: string;
      ttsAttempt1HttpStatus?: number;
      ttsAttempt2Ms?: number;
      ttsAttempt2Outcome?: string;
      ttsAttempt2HttpStatus?: number;
    };
    const parsedBody = await response
      .clone()
      .json()
      .then((body: FailureBody) => body)
      .catch(() => null as FailureBody | null);
    const errorCode = parsedBody?.error ?? "unknown";
    logVoiceReplyClientEvent("cloud_response_not_ok", { status: response.status, errorCode });
    callbacks.onFailure(
      "unavailable",
      errorCode,
      parsedBody?.providerAttemptCount,
      parsedBody?.ttsAttempt1Ms !== undefined && parsedBody?.ttsAttempt1Outcome !== undefined
        ? { ms: parsedBody.ttsAttempt1Ms, outcome: parsedBody.ttsAttempt1Outcome, httpStatus: parsedBody.ttsAttempt1HttpStatus }
        : undefined,
      parsedBody?.ttsAttempt2Ms !== undefined && parsedBody?.ttsAttempt2Outcome !== undefined
        ? { ms: parsedBody.ttsAttempt2Ms, outcome: parsedBody.ttsAttempt2Outcome, httpStatus: parsedBody.ttsAttempt2HttpStatus }
        : undefined,
    );
    return;
  }

  try {
    const blob = await response.blob();
    const numericHeader = (name: string): number | null => {
      const raw = response.headers.get(name);
      return raw !== null && Number.isFinite(Number(raw)) ? Number(raw) : null;
    };
    const timing: CloudVoiceReplyServerTiming = {
      ttsProviderMs: numericHeader("X-Provider-Latency-Ms"),
      providerAttemptCount: numericHeader("X-Provider-Attempt-Count"),
      preProviderMs: numericHeader("X-Pre-Provider-Ms"),
      usageWriteMs: numericHeader("X-Usage-Write-Ms"),
      audioProcessingMs: numericHeader("X-Audio-Processing-Ms"),
      serverTotalMs: numericHeader("X-Server-Total-Ms"),
      responseHeaderNames: Array.from(response.headers.keys()).join(","),
      attempt1Ms: numericHeader("X-Attempt1-Ms"),
      attempt1Outcome: response.headers.get("X-Attempt1-Outcome"),
      attempt1HttpStatus: numericHeader("X-Attempt1-Http-Status"),
      attempt2Ms: numericHeader("X-Attempt2-Ms"),
      attempt2Outcome: response.headers.get("X-Attempt2-Outcome"),
      attempt2HttpStatus: numericHeader("X-Attempt2-Http-Status"),
    };
    logVoiceReplyClientEvent("cloud_success", { audioBytes: blob.size });
    callbacks.onSuccess(blob, timing);
  } catch (error) {
    logVoiceReplyClientEvent("cloud_blob_read_threw", {
      errorName: error instanceof Error ? error.name : "unknown",
    });
    callbacks.onFailure("unavailable");
  }
}
