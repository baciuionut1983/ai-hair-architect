import { randomUUID } from "crypto";

import { NextResponse } from "next/server";

import { recordAiUsageEvent } from "@/lib/ai-usage-repository";
import { resolveOwnedClient } from "@/lib/client-repository";
import { checkRateLimit } from "@/lib/hardening";
import { isCloudTtsLanguageCode, toCloudTtsLanguageCode } from "@/lib/language-registry";
import { authenticateSessionRequest } from "@/lib/session-request-auth";
import { isValidWavHeader, parseSampleRateFromMimeType, wrapPcmAsWav } from "@/lib/tts-audio-format";
import { GeminiTtsProvider, type TtsProviderError } from "@/lib/tts-provider-gemini";

// Server-side only, by design (requirement 9 / "API key doar server-side"):
// the browser never sees TEXT_TO_SPEECH_API_KEY. This route's only job is
// to read the AI's reply text back aloud in the correct language -- it
// never calls any AI provider to generate NEW text, and it never persists
// the reply text or the generated audio anywhere (see the module doc
// comment at the bottom for the storage decision).
const MAX_VOICE_REPLY_TEXT_LENGTH = 4000;
const PROVIDER_TIMEOUT_MS = 20_000;
const MAX_LOGGED_PROVIDER_ERROR_LENGTH = 500;

// Same JSON-line, safe-fields-only convention as voice-transcript/route.ts's
// VOICE_TRANSCRIPT gate -- that logging is exactly what made the live
// Gemini 429 regression diagnosable from Railway's Deploy Logs alone. Never
// the reply text itself (requirement 9: "fără logarea textului integral al
// conversației") -- only its length, the resolved language, and the
// provider's own status/error shape.
function logVoiceReply(status: "SUCCEEDED" | "FAILED" | "INFO", stage: string, details: Record<string, unknown> = {}): void {
  const line = JSON.stringify({ gate: "VOICE_REPLY", status, stage, ...details });
  if (status === "FAILED") {
    console.error(line);
  } else {
    console.log(line);
  }
}

// Mirrors consultation-chat-service.ts's own classifyProviderFailure ->
// CONSULTATION_CHAT_RESULT_HTTP_STATUS mapping exactly (TIMEOUT->504,
// RATE_LIMITED->503, NOT_CONFIGURED->502, INVALID_FORMAT->502,
// PROVIDER_ERROR->503 if retryable else 502) -- the same provider, the
// same failure taxonomy, the same HTTP status per code everywhere in this
// app. This is also the direct fix for the live regression where a real
// upstream 429 was masked as a generic 502 with no distinguishing status:
// RATE_LIMITED gets its own branch here, never falls into a shared bucket.
function mapProviderErrorToResponse(error: TtsProviderError): { status: number; body: { error: string; message: string } } {
  switch (error.code) {
    case "TIMEOUT":
      return {
        status: 504,
        body: { error: "VOICE_REPLY_TIMEOUT", message: "Voice reply took too long. The text reply above is still available." },
      };
    case "RATE_LIMITED":
      return {
        status: 503,
        body: {
          error: "VOICE_REPLY_RATE_LIMITED",
          message: "Voice reply is temporarily busy. The text reply above is still available.",
        },
      };
    case "NOT_CONFIGURED":
      return {
        status: 502,
        body: { error: "VOICE_REPLY_NOT_CONFIGURED", message: "Voice reply is not configured correctly. The text reply above is still available." },
      };
    case "INVALID_FORMAT":
      return {
        status: 502,
        body: { error: "VOICE_REPLY_FAILED", message: "Voice reply returned no audio. The text reply above is still available." },
      };
    case "PROVIDER_ERROR":
    default:
      return error.retryable
        ? {
            status: 503,
            body: { error: "VOICE_REPLY_UNAVAILABLE", message: "Voice reply is temporarily unavailable. The text reply above is still available." },
          }
        : {
            status: 502,
            body: { error: "VOICE_REPLY_FAILED", message: "Voice reply returned an unexpected response. The text reply above is still available." },
          };
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  logVoiceReply("INFO", "endpoint_entered");

  let body: { text?: unknown; language?: unknown };
  try {
    body = await request.json();
  } catch {
    logVoiceReply("FAILED", "invalid_request", { resultCode: "INVALID_REQUEST", reason: "json_parse_threw" });
    return NextResponse.json({ error: "INVALID_REQUEST", message: "Invalid request." }, { status: 400 });
  }

  const user = await authenticateSessionRequest();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const limiter = checkRateLimit(`voice-reply:${user.id}`, 20, 60_000);
  if (!limiter.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded." }, { status: 429 });
  }

  const { id } = await context.params;
  const client = await resolveOwnedClient(user.id, id);
  if (client instanceof Response) return client;
  if (!client) {
    return NextResponse.json({ error: "Client not found." }, { status: 404 });
  }

  const text = typeof body.text === "string" ? body.text.trim() : "";
  const language = typeof body.language === "string" ? body.language : "";

  if (!text) {
    logVoiceReply("FAILED", "invalid_request", { resultCode: "INVALID_REQUEST", reason: "empty_text" });
    return NextResponse.json({ error: "INVALID_REQUEST", message: "No text to speak." }, { status: 400 });
  }
  // Cost control (requirement 7): bounds the worst-case audio-output-token
  // cost of a single request. A genuine Consult AI reply is a handful of
  // sentences; this is a safety ceiling against abuse/bugs, not a normal-
  // path limit -- rejected outright rather than silently truncated, since
  // truncating spoken audio without truncating the on-screen text would
  // make the two disagree about what was actually said.
  if (text.length > MAX_VOICE_REPLY_TEXT_LENGTH) {
    logVoiceReply("FAILED", "invalid_request", { resultCode: "TEXT_TOO_LONG", reason: "text_exceeds_max_length", textLength: text.length });
    return NextResponse.json({ error: "TEXT_TOO_LONG", message: "This reply is too long for voice reply." }, { status: 400 });
  }
  if (!isCloudTtsLanguageCode(language)) {
    logVoiceReply("FAILED", "invalid_request", { resultCode: "UNSUPPORTED_LANGUAGE", reason: "language_not_cloud_tts_supported", language });
    return NextResponse.json({ error: "UNSUPPORTED_LANGUAGE", message: "Voice reply is not available for this language." }, { status: 400 });
  }

  if (process.env.TEXT_TO_SPEECH_PROVIDER !== "gemini") {
    logVoiceReply("FAILED", "config_check", { resultCode: "VOICE_REPLY_PROVIDER_NOT_CONFIGURED", reason: "provider_not_gemini" });
    return NextResponse.json(
      { error: "VOICE_REPLY_PROVIDER_NOT_CONFIGURED", message: "Voice reply is not configured. The text reply above is still available." },
      { status: 503 },
    );
  }

  const apiKey = process.env.TEXT_TO_SPEECH_API_KEY;
  const model = process.env.TEXT_TO_SPEECH_MODEL || "gemini-2.5-flash-preview-tts";
  if (!apiKey) {
    logVoiceReply("FAILED", "config_check", { resultCode: "VOICE_REPLY_PROVIDER_NOT_CONFIGURED", reason: "api_key_missing" });
    return NextResponse.json(
      { error: "VOICE_REPLY_PROVIDER_NOT_CONFIGURED", message: "Voice reply is not configured. The text reply above is still available." },
      { status: 503 },
    );
  }

  const provider = new GeminiTtsProvider({ apiKey, model, timeoutMs: PROVIDER_TIMEOUT_MS });
  const languageCode = toCloudTtsLanguageCode(language);

  // AI Usage & Cost Metering Phase 1: one correlationId per logical
  // synthesize attempt -- this route never retries the provider call
  // itself internally, so attemptNumber is always the default (1).
  // Purely additive instrumentation: no existing behavior, timing, or
  // response above/below this block changes.
  const usageCorrelationId = randomUUID();
  const providerCallStartedAt = Date.now();

  let result;
  try {
    result = await provider.synthesize(text, languageCode);
  } catch (error) {
    const providerError = error as TtsProviderError;
    const { status, body: errorBody } = mapProviderErrorToResponse(providerError);
    logVoiceReply("FAILED", "provider_call", {
      resultCode: errorBody.error,
      providerErrorCode: providerError.code,
      providerHttpStatus: providerError.status,
      providerErrorMessage: providerError.message?.slice(0, MAX_LOGGED_PROVIDER_ERROR_LENGTH),
      model,
      language,
      languageCode,
      textLength: text.length,
    });
    // Defense-in-depth, on top of recordAiUsageEvent's own never-throws
    // contract: a metering problem must never turn an already-failed
    // synthesis attempt into a DIFFERENT, worse failure for the caller.
    try {
      await recordAiUsageEvent({
        ownerUserId: user.id,
        clientId: id,
        feature: "voice_reply",
        modality: "TTS",
        correlationId: usageCorrelationId,
        provider: "gemini",
        model,
        outcome: "FAILED",
        errorCategory: providerError.code,
        latencyMs: Date.now() - providerCallStartedAt,
      });
    } catch {
      // Intentionally swallowed -- see comment above.
    }
    return NextResponse.json(errorBody, { status });
  }

  // Voice latency audit (2026-08-18): the exact same measurement AI Usage
  // Metering already computes below, captured once and reused rather than
  // calling Date.now() twice for what must be the same number. Exposed as
  // a response header (the success body is raw audio bytes, not JSON, so
  // it cannot carry a field the way the STT/Consult AI routes do) --
  // X-Provider-Latency-Ms, read by the client so it can report a real
  // ttsProviderMs distinct from its own round-trip measurement.
  const providerLatencyMs = Date.now() - providerCallStartedAt;

  // Defense-in-depth, on top of recordAiUsageEvent's own never-throws
  // contract: a metering problem must never turn a successful voice
  // reply into a user-visible failure.
  try {
    await recordAiUsageEvent({
      ownerUserId: user.id,
      clientId: id,
      feature: "voice_reply",
      modality: "TTS",
      correlationId: usageCorrelationId,
      provider: "gemini",
      model,
      providerRequestId: result.providerRequestId,
      usage: result.usage,
      outcome: "SUCCEEDED",
      latencyMs: providerLatencyMs,
    });
  } catch {
    // Intentionally swallowed -- see comment above.
  }

  const sampleRateHz = parseSampleRateFromMimeType(result.mimeType);
  const pcm = Buffer.from(result.audioBase64, "base64");
  const wav = wrapPcmAsWav(pcm, sampleRateHz);

  // Fail-closed runtime safety net: a live production investigation
  // proved cloud TTS can deliver real, correctly-sized bytes end-to-end
  // while playback still fails for an unrelated reason (that specific
  // case turned out to be a missing CSP media-src directive, not a
  // malformed file) -- but wrapPcmAsWav is still the one place a genuine
  // future regression in the header-writing logic itself could ship
  // broken audio silently. Checking the actual magic bytes/chunk sizes
  // here, not just trusting the function that just built them, means
  // that class of bug fails loudly (a real error) instead of being
  // discovered again the same way this one was -- a stylist hearing an
  // English fallback voice with no diagnostic trail.
  const wavValidation = isValidWavHeader(wav);
  if (!wavValidation.valid) {
    logVoiceReply("FAILED", "wav_validation", {
      resultCode: "VOICE_REPLY_FAILED",
      reason: wavValidation.reason,
      model,
      language,
      languageCode,
      providerMimeType: result.mimeType,
      sampleRateHz,
      pcmBytes: pcm.length,
    });
    return NextResponse.json(
      { error: "VOICE_REPLY_FAILED", message: "Voice reply returned an unexpected response. The text reply above is still available." },
      { status: 502 },
    );
  }

  // providerMimeType/sampleRateHz/pcmBytes are logged explicitly (not
  // just the final wav.length) so a live retest can directly confirm
  // what Gemini actually returned -- e.g. that it really is the assumed
  // 16-bit/mono/24kHz raw PCM this route wraps as WAV -- rather than
  // that assumption only ever being verified against documentation.
  logVoiceReply("SUCCEEDED", "complete", {
    model,
    language,
    languageCode,
    textLength: text.length,
    providerMimeType: result.mimeType,
    sampleRateHz,
    pcmBytes: pcm.length,
    audioBytes: wav.length,
  });

  return new Response(new Uint8Array(wav), {
    status: 200,
    headers: {
      "Content-Type": "audio/wav",
      "Cache-Control": "no-store",
      "X-Provider-Latency-Ms": String(providerLatencyMs),
    },
  });
}

// STORAGE (requirement 8): this route deliberately never writes the
// generated audio anywhere -- not S3, not the database. It is returned
// once, directly in the HTTP response, and the browser plays it from
// memory. Rationale: Voice Reply audio is conversational and ephemeral by
// nature (the underlying text is already durably persisted as the
// ConsultationMessage itself); persisting a second, redundant copy of the
// same content as an audio file would add S3 cost/retention complexity
// for content nobody has asked to replay later, and would require a
// retention policy of its own. If a future requirement needs replay-past-
// messages audio, that is a deliberate product decision to make
// explicitly, not a default this route should assume.
