import { randomUUID } from "crypto";

import { NextResponse } from "next/server";

import { recordAiUsageEvent } from "@/lib/ai-usage-repository";
import { resolveOwnedClient } from "@/lib/client-repository";
import { checkRateLimit } from "@/lib/hardening";
import { isCloudTtsLanguageCode, toCloudTtsLanguageCode } from "@/lib/language-registry";
import { authenticateSessionRequest } from "@/lib/session-request-auth";
import type { TtsProviderError } from "@/lib/tts-provider-gemini";
import { GeminiTtsStreamingProvider, type StreamingTtsChunk } from "@/lib/tts-provider-gemini-streaming";

// TRUE Gemini TTS streaming (architecture experiment) -- a NEW,
// EXPERIMENTAL, completely SEPARATE route from voice-reply/route.ts. This
// file neither modifies nor imports from that route; it only reuses the
// same, already-battle-tested utilities (auth, rate limiting, client
// ownership, language support, usage metering) the same way that route
// does. See tts-provider-gemini-streaming.ts's own module doc comment for
// the real, live-measured latency evidence this route exists to let a
// human compare against the existing full-WAV path.
//
// Explicit opt-in, disabled by default in EVERY real environment --
// mirrors CONSULTATION_VOICE_THINKING_LEVEL's own established
// "reversible with zero effect if unset" contract (see
// consultation-chat-service.ts's own identical env-var check): unless an
// operator explicitly sets TEXT_TO_SPEECH_STREAMING_MODEL, this whole
// route is a true no-op -- the very first line of the handler below,
// before authentication, rate limiting, or any DB/provider work.
const MAX_VOICE_REPLY_STREAM_TEXT_LENGTH = 4_000;
const PROVIDER_TIMEOUT_MS = 20_000;
const MAX_LOGGED_PROVIDER_ERROR_LENGTH = 500;

// Same JSON-line, safe-fields-only logging convention as voiceReply's own
// logVoiceReply (voice-reply/route.ts) -- a distinct gate name
// ('VOICE_REPLY_STREAM') so this experimental path's own logs are never
// confused with the production route's. Never the reply text itself.
function logVoiceReplyStream(status: "SUCCEEDED" | "FAILED" | "INFO", stage: string, details: Record<string, unknown> = {}): void {
  const line = JSON.stringify({ gate: "VOICE_REPLY_STREAM", status, stage, ...details });
  if (status === "FAILED") {
    console.error(line);
  } else {
    console.log(line);
  }
}

// Own, local copy of voice-reply/route.ts's own mapProviderErrorToResponse
// -- deliberately NOT imported (that file is on the do-not-modify list,
// and this route must stay fully independent of it), but the exact same
// switch cases/HTTP status per code, so the two routes' failure
// vocabularies stay recognizable to the same human comparing them.
function mapProviderErrorToResponse(error: TtsProviderError): { status: number; body: { error: string; message: string } } {
  switch (error.code) {
    case "TIMEOUT":
      return {
        status: 504,
        body: { error: "VOICE_REPLY_STREAM_TIMEOUT", message: "Streaming voice reply took too long. The text reply above is still available." },
      };
    case "RATE_LIMITED":
      return {
        status: 503,
        body: { error: "VOICE_REPLY_STREAM_RATE_LIMITED", message: "Streaming voice reply is temporarily busy. The text reply above is still available." },
      };
    case "NOT_CONFIGURED":
      return {
        status: 502,
        body: { error: "VOICE_REPLY_STREAM_NOT_CONFIGURED", message: "Streaming voice reply is not configured correctly. The text reply above is still available." },
      };
    case "INVALID_FORMAT":
      return {
        status: 502,
        body: { error: "VOICE_REPLY_STREAM_FAILED", message: "Streaming voice reply returned no audio. The text reply above is still available." },
      };
    case "PROVIDER_ERROR":
    default:
      return error.retryable
        ? {
            status: 503,
            body: { error: "VOICE_REPLY_STREAM_UNAVAILABLE", message: "Streaming voice reply is temporarily unavailable. The text reply above is still available." },
          }
        : {
            status: 502,
            body: { error: "VOICE_REPLY_STREAM_FAILED", message: "Streaming voice reply returned an unexpected response. The text reply above is still available." },
          };
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  // FIRST check, before any other work whatsoever -- see this file's own
  // module doc comment for why. No auth, no rate limit, no DB read, no
  // provider construction happens above this line.
  const streamingModel = process.env.TEXT_TO_SPEECH_STREAMING_MODEL;
  if (!streamingModel || streamingModel.trim().length === 0) {
    return NextResponse.json(
      { error: "VOICE_REPLY_STREAM_NOT_CONFIGURED", message: "Streaming voice reply is not enabled." },
      { status: 503 },
    );
  }

  // Anchors every timing this route logs -- see logVoiceReplyStream's own
  // "complete" call below for timeToFirstProviderByteMs/totalProviderStreamMs,
  // both measured from this single instant.
  const requestReceivedAt = Date.now();
  logVoiceReplyStream("INFO", "endpoint_entered", { model: streamingModel });

  const user = await authenticateSessionRequest();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const limiter = checkRateLimit(`voice-reply-stream:${user.id}`, 20, 60_000);
  if (!limiter.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded." }, { status: 429 });
  }

  let body: { text?: unknown; language?: unknown };
  try {
    body = await request.json();
  } catch {
    logVoiceReplyStream("FAILED", "invalid_request", { resultCode: "INVALID_REQUEST", reason: "json_parse_threw" });
    return NextResponse.json({ error: "INVALID_REQUEST", message: "Invalid request." }, { status: 400 });
  }

  const text = typeof body.text === "string" ? body.text.trim() : "";
  const language = typeof body.language === "string" ? body.language : "";

  if (!text) {
    logVoiceReplyStream("FAILED", "invalid_request", { resultCode: "INVALID_REQUEST", reason: "empty_text" });
    return NextResponse.json({ error: "INVALID_REQUEST", message: "No text to speak." }, { status: 400 });
  }
  // Same cost-control ceiling as voice-reply/route.ts's own
  // MAX_VOICE_REPLY_TEXT_LENGTH -- identical limit, never a different one
  // for the experimental path.
  if (text.length > MAX_VOICE_REPLY_STREAM_TEXT_LENGTH) {
    logVoiceReplyStream("FAILED", "invalid_request", { resultCode: "TEXT_TOO_LONG", reason: "text_exceeds_max_length", textLength: text.length });
    return NextResponse.json({ error: "TEXT_TOO_LONG", message: "This reply is too long for voice reply." }, { status: 400 });
  }

  const { id } = await context.params;
  const client = await resolveOwnedClient(user.id, id);
  if (client instanceof Response) return client;
  if (!client) {
    return NextResponse.json({ error: "Client not found." }, { status: 404 });
  }

  if (!isCloudTtsLanguageCode(language)) {
    logVoiceReplyStream("FAILED", "invalid_request", { resultCode: "UNSUPPORTED_LANGUAGE", reason: "language_not_cloud_tts_supported", language });
    return NextResponse.json({ error: "UNSUPPORTED_LANGUAGE", message: "Voice reply is not available for this language." }, { status: 400 });
  }

  const apiKey = process.env.TEXT_TO_SPEECH_API_KEY;
  if (!apiKey) {
    logVoiceReplyStream("FAILED", "config_check", { resultCode: "VOICE_REPLY_STREAM_NOT_CONFIGURED", reason: "api_key_missing" });
    return NextResponse.json(
      { error: "VOICE_REPLY_STREAM_NOT_CONFIGURED", message: "Streaming voice reply is not configured. The text reply above is still available." },
      { status: 503 },
    );
  }

  const languageCode = toCloudTtsLanguageCode(language);
  // AI Usage & Cost Metering: one correlationId for this logical
  // synthesize-stream attempt, exactly like voice-reply/route.ts's own
  // usageCorrelationId.
  const usageCorrelationId = randomUUID();

  let provider: GeminiTtsStreamingProvider;
  try {
    provider = new GeminiTtsStreamingProvider({ apiKey, model: streamingModel, timeoutMs: PROVIDER_TIMEOUT_MS });
  } catch (constructionError) {
    const providerError = constructionError as TtsProviderError;
    const { status, body: errorBody } = mapProviderErrorToResponse(providerError);
    return NextResponse.json(errorBody, { status });
  }

  // providerCallStartedAt anchors ONLY the provider-stream-duration used
  // for AI usage metering's latencyMs -- deliberately separate from
  // requestReceivedAt (which the *logged* timeToFirstProviderByteMs/
  // totalProviderStreamMs fields are measured against, per this route's
  // own contract), mirroring voice-reply/route.ts's own
  // providerCallStartedAt/providerLatencyMs split.
  const providerCallStartedAt = Date.now();
  const generator = provider.synthesizeStream(text, languageCode);

  // The response's HTTP status must be decided BEFORE any bytes are sent
  // -- so the very first chunk (or a genuine "no chunk was ever produced"
  // failure) is fetched here, still inside the handler, before the
  // ReadableStream/Response is ever constructed. This is the one
  // necessary structural difference from a plain `for await` over
  // provider.synthesizeStream directly inside start(): a failure here
  // becomes a real, honest JSON error response (mapped through the exact
  // same TIMEOUT/RATE_LIMITED/NOT_CONFIGURED/PROVIDER_ERROR switch as the
  // non-streaming route), never a 200 response whose body immediately
  // errors.
  let firstResult: IteratorResult<StreamingTtsChunk>;
  try {
    firstResult = await generator.next();
  } catch (firstChunkError) {
    const providerError = firstChunkError as TtsProviderError;
    const totalProviderStreamMs = Date.now() - requestReceivedAt;
    logVoiceReplyStream("FAILED", "provider_call", {
      resultCode: mapProviderErrorToResponse(providerError).body.error,
      providerErrorCode: providerError.code,
      providerHttpStatus: providerError.status,
      providerErrorMessage: providerError.message?.slice(0, MAX_LOGGED_PROVIDER_ERROR_LENGTH),
      model: streamingModel,
      language,
      languageCode,
      textLength: text.length,
      chunkCount: 0,
      pcmBytesTotal: 0,
      totalProviderStreamMs,
    });
    // Fire-and-forget, exactly like this route's success path below --
    // see that call site's own comment for why this never awaits.
    // recordAiUsageEvent itself never throws (see its own doc comment in
    // ai-usage-repository.ts) -- .catch() here is defense-in-depth only,
    // so a hypothetical future regression there still can never turn
    // into an unhandled rejection.
    recordAiUsageEvent({
      ownerUserId: user.id,
      clientId: id,
      feature: "voice_reply_stream",
      modality: "TTS",
      correlationId: usageCorrelationId,
      attemptNumber: 1,
      provider: "gemini",
      model: streamingModel,
      outcome: "FAILED",
      errorCategory: providerError.code,
      latencyMs: Date.now() - providerCallStartedAt,
    }).catch(() => {});

    const { status, body: errorBody } = mapProviderErrorToResponse(providerError);
    return NextResponse.json(errorBody, { status });
  }

  // Build and return the streaming response. The generator (and its
  // already-fetched firstResult) is reused, never re-invoked -- a second
  // call to provider.synthesizeStream would start a second, real, billed
  // API request.
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let chunkCount = 0;
      let pcmBytesTotal = 0;
      let timeToFirstProviderByteMs: number | null = null;

      try {
        let current = firstResult;
        while (!current.done) {
          const chunk = current.value;
          if (chunkCount === 0) {
            timeToFirstProviderByteMs = Date.now() - requestReceivedAt;
          }
          chunkCount += 1;
          pcmBytesTotal += chunk.pcm.length;
          controller.enqueue(new Uint8Array(chunk.pcm));
          current = await generator.next();
        }
        controller.close();

        const totalProviderStreamMs = Date.now() - requestReceivedAt;
        logVoiceReplyStream("SUCCEEDED", "complete", {
          model: streamingModel,
          language,
          languageCode,
          textLength: text.length,
          chunkCount,
          timeToFirstProviderByteMs,
          totalProviderStreamMs,
          pcmBytesTotal,
        });
        // Fire-and-forget: unlike voice-reply/route.ts's own AWAITED
        // usage write (a deliberate, documented trade-off there), this
        // experimental route never blocks the response on this DB write
        // completing -- the streaming Response has already been returned
        // to the caller by the time this line runs.
        recordAiUsageEvent({
          ownerUserId: user.id,
          clientId: id,
          feature: "voice_reply_stream",
          modality: "TTS",
          correlationId: usageCorrelationId,
          attemptNumber: 1,
          provider: "gemini",
          model: streamingModel,
          outcome: "SUCCEEDED",
          latencyMs: Date.now() - providerCallStartedAt,
        }).catch(() => {});
      } catch (streamError) {
        controller.error(streamError);

        const providerError = streamError as TtsProviderError;
        const totalProviderStreamMs = Date.now() - requestReceivedAt;
        logVoiceReplyStream("FAILED", "provider_call", {
          resultCode: mapProviderErrorToResponse(providerError).body.error,
          providerErrorCode: providerError.code,
          providerHttpStatus: providerError.status,
          providerErrorMessage: providerError.message?.slice(0, MAX_LOGGED_PROVIDER_ERROR_LENGTH),
          model: streamingModel,
          language,
          languageCode,
          textLength: text.length,
          chunkCount,
          timeToFirstProviderByteMs,
          totalProviderStreamMs,
          pcmBytesTotal,
        });
        recordAiUsageEvent({
          ownerUserId: user.id,
          clientId: id,
          feature: "voice_reply_stream",
          modality: "TTS",
          correlationId: usageCorrelationId,
          attemptNumber: 1,
          provider: "gemini",
          model: streamingModel,
          outcome: "FAILED",
          errorCategory: providerError.code,
          latencyMs: Date.now() - providerCallStartedAt,
        }).catch(() => {});
      }
    },
  });

  // Headers must be fully decided before any body byte streams -- so no
  // per-chunk timing rides along here (see the module doc comment above);
  // every timing this route captures is logged server-side instead, via
  // logVoiceReplyStream above.
  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "application/octet-stream",
      "Cache-Control": "no-store",
      "X-Audio-Sample-Rate-Hz": "24000",
      "X-Audio-Format": "pcm_s16le_mono",
    },
  });
}
