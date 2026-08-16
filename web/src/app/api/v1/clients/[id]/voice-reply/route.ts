import { NextResponse } from "next/server";

import { resolveOwnedClient } from "@/lib/client-repository";
import { checkRateLimit } from "@/lib/hardening";
import { isCloudTtsLanguageCode, toCloudTtsLanguageCode } from "@/lib/language-registry";
import { authenticateSessionRequest } from "@/lib/session-request-auth";
import { parseSampleRateFromMimeType, wrapPcmAsWav } from "@/lib/tts-audio-format";
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
    return NextResponse.json(errorBody, { status });
  }

  const sampleRateHz = parseSampleRateFromMimeType(result.mimeType);
  const wav = wrapPcmAsWav(Buffer.from(result.audioBase64, "base64"), sampleRateHz);

  logVoiceReply("SUCCEEDED", "complete", {
    model,
    language,
    languageCode,
    textLength: text.length,
    audioBytes: wav.length,
  });

  return new Response(new Uint8Array(wav), {
    status: 200,
    headers: {
      "Content-Type": "audio/wav",
      "Cache-Control": "no-store",
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
