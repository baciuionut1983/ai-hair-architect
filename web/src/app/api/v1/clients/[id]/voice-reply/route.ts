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
  // TTS latency root-cause (2026-08-19, Round 7): a real production test
  // showed ttsTotalMs (client-measured, request-sent to audio-received)
  // roughly DOUBLE ttsProviderMs (this route's own X-Provider-Latency-Ms,
  // the Gemini synthesize() call alone) -- a ~20.7s gap with no prior way
  // to tell whether it was auth/DB overhead before the provider call,
  // response processing after it, or pure network transfer of the audio
  // bytes. requestReceivedAt anchors that full breakdown: every stage
  // below reports its own duration relative to this one instant, mirroring
  // consultation-chat-service.ts's own preProviderReadsMs/replyWriteMs
  // split -- measure precisely before optimizing, never guess.
  const requestReceivedAt = Date.now();
  logVoiceReply("INFO", "endpoint_entered");

  let body: { text?: unknown; language?: unknown; voiceTurnId?: unknown };
  try {
    body = await request.json();
  } catch {
    logVoiceReply("FAILED", "invalid_request", { resultCode: "INVALID_REQUEST", reason: "json_parse_threw" });
    return NextResponse.json({ error: "INVALID_REQUEST", message: "Invalid request." }, { status: 400 });
  }

  // End-to-end voice turn correlation (2026-08-19): when this request
  // originated from a voice-initiated turn, the client sends the SAME id
  // already used for STT (use-voice-recording.ts's own attemptId) -- never
  // a new, independently-generated id. Same defensive posture as
  // voice-transcript/route.ts's own attemptId handling: a malformed/
  // missing value simply means "no voice turn" (unreachable in practice --
  // this route is voice-only -- but never trusted blindly regardless),
  // never invented.
  const voiceTurnId: string | null =
    typeof body.voiceTurnId === "string" && /^[A-Za-z0-9-]{1,100}$/.test(body.voiceTurnId) ? body.voiceTurnId : null;

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
    logVoiceReply("FAILED", "invalid_request", { resultCode: "INVALID_REQUEST", reason: "empty_text", voiceTurnId });
    return NextResponse.json({ error: "INVALID_REQUEST", message: "No text to speak." }, { status: 400 });
  }
  // Cost control (requirement 7): bounds the worst-case audio-output-token
  // cost of a single request. A genuine Consult AI reply is a handful of
  // sentences; this is a safety ceiling against abuse/bugs, not a normal-
  // path limit -- rejected outright rather than silently truncated, since
  // truncating spoken audio without truncating the on-screen text would
  // make the two disagree about what was actually said.
  if (text.length > MAX_VOICE_REPLY_TEXT_LENGTH) {
    logVoiceReply("FAILED", "invalid_request", { resultCode: "TEXT_TOO_LONG", reason: "text_exceeds_max_length", textLength: text.length, voiceTurnId });
    return NextResponse.json({ error: "TEXT_TOO_LONG", message: "This reply is too long for voice reply." }, { status: 400 });
  }
  if (!isCloudTtsLanguageCode(language)) {
    logVoiceReply("FAILED", "invalid_request", { resultCode: "UNSUPPORTED_LANGUAGE", reason: "language_not_cloud_tts_supported", language, voiceTurnId });
    return NextResponse.json({ error: "UNSUPPORTED_LANGUAGE", message: "Voice reply is not available for this language." }, { status: 400 });
  }

  if (process.env.TEXT_TO_SPEECH_PROVIDER !== "gemini") {
    logVoiceReply("FAILED", "config_check", { resultCode: "VOICE_REPLY_PROVIDER_NOT_CONFIGURED", reason: "provider_not_gemini", voiceTurnId });
    return NextResponse.json(
      { error: "VOICE_REPLY_PROVIDER_NOT_CONFIGURED", message: "Voice reply is not configured. The text reply above is still available." },
      { status: 503 },
    );
  }

  const apiKey = process.env.TEXT_TO_SPEECH_API_KEY;
  const primaryModel = process.env.TEXT_TO_SPEECH_MODEL || "gemini-2.5-flash-preview-tts";
  if (!apiKey) {
    logVoiceReply("FAILED", "config_check", { resultCode: "VOICE_REPLY_PROVIDER_NOT_CONFIGURED", reason: "api_key_missing", voiceTurnId });
    return NextResponse.json(
      { error: "VOICE_REPLY_PROVIDER_NOT_CONFIGURED", message: "Voice reply is not configured. The text reply above is still available." },
      { status: 503 },
    );
  }

  const languageCode = toCloudTtsLanguageCode(language);

  // TTS reliability hardening (2026-08-19): a real production TIMEOUT
  // proved this call was never retried at all -- unlike STT
  // (teach-ai-panel-logic.ts) and Consult AI (consultation-chat-service.ts),
  // which already recover from the identical class of transient failure.
  // Mirrors both exactly: at most ONE retry, only when GeminiTtsProvider's
  // own classifyTtsError already marked the failure `retryable` (TIMEOUT,
  // RATE_LIMITED, or a 5xx PROVIDER_ERROR) -- never for NOT_CONFIGURED,
  // INVALID_FORMAT, or a non-5xx PROVIDER_ERROR, since a second identical
  // call could never change that outcome. Structurally impossible to
  // return or play duplicate audio: this whole retry happens inside ONE
  // request/response cycle, so the client (synthesizeCloudVoiceReply)
  // still only ever makes one fetch call and receives exactly one
  // response, either the final audio bytes or a final JSON error -- the
  // browser fallback (speakMessageLocally) is reached only once BOTH
  // attempts here are exhausted.
  //
  // No TTS fallback model config existed before this change -- added here,
  // mirroring STT_FALLBACK_MODEL/CONSULTATION_CHAT_FALLBACK_MODEL exactly:
  // unset by default, never invented, used only for the retry.
  const fallbackModel = process.env.TEXT_TO_SPEECH_FALLBACK_MODEL;
  const retryModel = fallbackModel && fallbackModel.trim().length > 0 && fallbackModel !== primaryModel ? fallbackModel : primaryModel;

  // AI Usage & Cost Metering Phase 1: one correlationId per logical
  // synthesize attempt, shared by every attempt's success/failure
  // recording call below -- each real provider call still gets its own,
  // correctly-attributed row via attemptNumber, mirroring
  // consultation-chat-service.ts's own recordAttempt scheme exactly.
  const usageCorrelationId = randomUUID();

  // Everything above this point -- request.json(), voiceTurnId validation,
  // authenticateSessionRequest (a real DB-backed session lookup),
  // checkRateLimit, resolveOwnedClient (a real DB lookup), and every
  // validation/config check -- is exactly the bucket consultation-chat-
  // service.ts calls preProviderReadsMs. Never previously measured for
  // this route at all.
  const preProviderMs = Date.now() - requestReceivedAt;

  let activeModel = primaryModel;
  let attemptNumber: 1 | 2 = 1;
  let providerCallStartedAt = Date.now();
  let result;
  try {
    result = await new GeminiTtsProvider({ apiKey, model: activeModel, timeoutMs: PROVIDER_TIMEOUT_MS }).synthesize(text, languageCode);
  } catch (firstError) {
    const firstProviderError = firstError as TtsProviderError;
    logVoiceReply("FAILED", "provider_call", {
      resultCode: mapProviderErrorToResponse(firstProviderError).body.error,
      providerErrorCode: firstProviderError.code,
      providerHttpStatus: firstProviderError.status,
      providerErrorMessage: firstProviderError.message?.slice(0, MAX_LOGGED_PROVIDER_ERROR_LENGTH),
      model: activeModel,
      language,
      languageCode,
      textLength: text.length,
      voiceTurnId,
      providerAttemptNumber: attemptNumber,
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
        attemptNumber,
        provider: "gemini",
        model: activeModel,
        outcome: "FAILED",
        errorCategory: firstProviderError.code,
        latencyMs: Date.now() - providerCallStartedAt,
      });
    } catch {
      // Intentionally swallowed -- see comment above.
    }

    if (firstProviderError.retryable !== true) {
      const { status, body: errorBody } = mapProviderErrorToResponse(firstProviderError);
      return NextResponse.json({ ...errorBody, providerAttemptCount: attemptNumber }, { status });
    }

    attemptNumber = 2;
    activeModel = retryModel;
    providerCallStartedAt = Date.now();
    try {
      result = await new GeminiTtsProvider({ apiKey, model: activeModel, timeoutMs: PROVIDER_TIMEOUT_MS }).synthesize(text, languageCode);
    } catch (secondError) {
      const secondProviderError = secondError as TtsProviderError;
      logVoiceReply("FAILED", "provider_call", {
        resultCode: mapProviderErrorToResponse(secondProviderError).body.error,
        providerErrorCode: secondProviderError.code,
        providerHttpStatus: secondProviderError.status,
        providerErrorMessage: secondProviderError.message?.slice(0, MAX_LOGGED_PROVIDER_ERROR_LENGTH),
        model: activeModel,
        language,
        languageCode,
        textLength: text.length,
        voiceTurnId,
        providerAttemptNumber: attemptNumber,
      });
      try {
        await recordAiUsageEvent({
          ownerUserId: user.id,
          clientId: id,
          feature: "voice_reply",
          modality: "TTS",
          correlationId: usageCorrelationId,
          attemptNumber,
          provider: "gemini",
          model: activeModel,
          outcome: "FAILED",
          errorCategory: secondProviderError.code,
          latencyMs: Date.now() - providerCallStartedAt,
        });
      } catch {
        // Intentionally swallowed -- see comment above.
      }
      const { status, body: errorBody } = mapProviderErrorToResponse(secondProviderError);
      return NextResponse.json({ ...errorBody, providerAttemptCount: attemptNumber }, { status });
    }
  }

  // Voice latency audit (2026-08-18): the exact same measurement AI Usage
  // Metering already computes below, captured once and reused rather than
  // calling Date.now() twice for what must be the same number. Exposed as
  // a response header (the success body is raw audio bytes, not JSON, so
  // it cannot carry a field the way the STT/Consult AI routes do) --
  // X-Provider-Latency-Ms, read by the client so it can report a real
  // ttsProviderMs distinct from its own round-trip measurement. Reflects
  // whichever attempt (1 or 2) actually succeeded.
  const providerLatencyMs = Date.now() - providerCallStartedAt;

  // TTS latency root-cause (2026-08-19, Round 7): this AWAITED DB write
  // sits directly in the critical path between the provider call finishing
  // and the audio response being sent -- structurally identical to the
  // consultationProviderMs bug fixed earlier (a DB write silently
  // inflating a number that looks like pure provider time), except here
  // it inflates the client's ttsTotalMs instead of a mislabeled provider
  // field. Measured, not yet changed: whether to make this fire-and-forget
  // is a real trade-off against AI Usage Metering's accounting integrity
  // (every other route in this app awaits the identical call) -- a
  // decision documented for Round 8, not made unilaterally here. This
  // round's job is only to prove, with a real number, how much of the
  // ~20.7s gap this actually accounts for.
  const usageWriteStartedAt = Date.now();
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
      attemptNumber,
      provider: "gemini",
      model: activeModel,
      providerRequestId: result.providerRequestId,
      usage: result.usage,
      outcome: "SUCCEEDED",
      latencyMs: providerLatencyMs,
    });
  } catch {
    // Intentionally swallowed -- see comment above.
  }
  const usageWriteMs = Date.now() - usageWriteStartedAt;

  const audioProcessingStartedAt = Date.now();
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
      model: activeModel,
      language,
      languageCode,
      providerMimeType: result.mimeType,
      sampleRateHz,
      pcmBytes: pcm.length,
      voiceTurnId,
      providerAttemptNumber: attemptNumber,
    });
    return NextResponse.json(
      { error: "VOICE_REPLY_FAILED", message: "Voice reply returned an unexpected response. The text reply above is still available.", providerAttemptCount: attemptNumber },
      { status: 502 },
    );
  }

  // audioProcessingMs covers base64-decoding the provider's response,
  // building the WAV header/buffer, and validating the actual bytes --
  // entirely in-memory, no I/O, so this is the bucket expected to be
  // small; if a real test shows otherwise, that itself is a finding.
  const audioProcessingMs = Date.now() - audioProcessingStartedAt;
  // The single authoritative "how much of ttsTotalMs did the server
  // itself account for" number -- measured end-to-end from
  // requestReceivedAt rather than summed from the parts above, so it's
  // correct regardless of whether a retry happened (a failed first
  // attempt's own duration is automatically included, with no separate
  // failedFirstAttemptMs bookkeeping needed the way consultation-chat-
  // service.ts required -- there the total was reconstructed by
  // subtracting named parts; here it's measured directly). The client
  // computes ttsNetworkAndTransferMs as ttsTotalMs - ttsServerTotalMs,
  // mirroring sttNetworkAndServerMs's own subtraction exactly.
  const serverTotalMs = Date.now() - requestReceivedAt;

  // providerMimeType/sampleRateHz/pcmBytes are logged explicitly (not
  // just the final wav.length) so a live retest can directly confirm
  // what Gemini actually returned -- e.g. that it really is the assumed
  // 16-bit/mono/24kHz raw PCM this route wraps as WAV -- rather than
  // that assumption only ever being verified against documentation.
  logVoiceReply("SUCCEEDED", "complete", {
    model: activeModel,
    language,
    languageCode,
    textLength: text.length,
    providerMimeType: result.mimeType,
    sampleRateHz,
    pcmBytes: pcm.length,
    audioBytes: wav.length,
    voiceTurnId,
    providerAttemptNumber: attemptNumber,
    preProviderMs,
    usageWriteMs,
    audioProcessingMs,
    serverTotalMs,
  });

  return new Response(new Uint8Array(wav), {
    status: 200,
    headers: {
      "Content-Type": "audio/wav",
      "Cache-Control": "no-store",
      "X-Provider-Latency-Ms": String(providerLatencyMs),
      // TTS reliability hardening (2026-08-19): lets the client report a
      // real providerAttemptCount for voice latency telemetry, mirroring
      // Consult AI's own providerAttemptCount field -- 1 unless the single
      // automatic retry above recovered a transient failure.
      "X-Provider-Attempt-Count": String(attemptNumber),
      // TTS latency root-cause (2026-08-19, Round 7): see the doc comments
      // at requestReceivedAt/preProviderMs/usageWriteMs/audioProcessingMs/
      // serverTotalMs above -- the full server-side decomposition of the
      // gap between ttsProviderMs and the client's own ttsTotalMs.
      "X-Pre-Provider-Ms": String(preProviderMs),
      "X-Usage-Write-Ms": String(usageWriteMs),
      "X-Audio-Processing-Ms": String(audioProcessingMs),
      "X-Server-Total-Ms": String(serverTotalMs),
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
