import { randomUUID } from "crypto";

import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";

import { recordAiUsageEvent } from "@/lib/ai-usage-repository";
import { resolveOwnedClient } from "@/lib/client-repository";
import { mapGeminiUsageMetadata, type GeminiRawUsageMetadata } from "@/lib/gemini-usage-mapper";
import { checkRateLimit } from "@/lib/hardening";
import { getLanguageDefinition, isSttLanguageCode } from "@/lib/language-registry";
import { isDatabaseConfigured, prisma } from "@/lib/prisma";
import { authenticateSessionRequest } from "@/lib/session-request-auth";

const MAX_AUDIO_BYTES = 8 * 1024 * 1024;
const PROVIDER_TIMEOUT_MS = 30_000;
const MAX_TRANSCRIPT_LENGTH = 4000;

// Exactly Gemini's own documented supported audio input formats for
// generateContent (https://ai.google.dev/gemini-api/docs/audio) -- most
// notably, does NOT include audio/webm, MediaRecorder's own default
// container on Chrome/Android (confirmed live: a real, correctly-sized
// audio/webm;codecs=opus upload reached Gemini and was rejected with a
// provider-side HTTP 500). Never guessed or expanded beyond what Google
// documents -- see this route's own use of it below for why.
const GEMINI_SUPPORTED_AUDIO_MIME_TYPES = new Set([
  "audio/wav",
  "audio/mp3",
  "audio/aiff",
  "audio/aac",
  "audio/ogg",
  "audio/flac",
]);

// Strips any trailing MIME parameters (e.g. the ";codecs=opus" a browser
// appends to audio/webm) before matching against the allowlist above --
// the container format is what Gemini's docs enumerate, never the codec
// parameter.
function baseMimeType(mimeType: string): string {
  return mimeType.split(";")[0]?.trim().toLowerCase() ?? mimeType;
}

// A live report ("Voice transcription failed. You can still type your
// note.") could not be root-caused because this route had zero diagnostic
// logging on any branch -- every failure was silent from Railway's
// perspective. Safe-fields-only, matching consultation-chat-service.ts's
// own logging convention: never the raw audio bytes, never the transcript
// content, never the API key (only ever in the request URL, never logged
// here) -- but the provider's own HTTP status and a bounded excerpt of its
// error body ARE logged, since that's precisely the detail needed to tell
// a bad audio MIME type apart from an auth/quota/model problem.
const MAX_LOGGED_PROVIDER_ERROR_LENGTH = 500;

// STT 404 root-cause diagnosis (2026-08-21): Google's own error.message is
// genuinely free text (e.g. "models/gemini-2.5-flash-lite is not found for
// API version v1beta, or is not supported for content generation."), unlike
// providerErrorStatus's fixed short vocabulary -- bounded to a safe length
// and stripped of control characters (never multi-line) before it's ever
// returned to the client or logged, so a telemetry payload built from it
// can't grow unbounded or smuggle a crafted multi-line value through.
const MAX_PROVIDER_ERROR_MESSAGE_LENGTH = 300;

function sanitizeProviderErrorMessage(message: string): string {
  return message.replace(/[\x00-\x1F\x7F]+/g, " ").trim().slice(0, MAX_PROVIDER_ERROR_MESSAGE_LENGTH);
}

function logVoiceTranscript(status: "SUCCEEDED" | "FAILED" | "INFO", stage: string, details: Record<string, unknown> = {}): void {
  const line = JSON.stringify({ gate: "VOICE_TRANSCRIPT", status, stage, ...details });
  if (status === "FAILED") {
    console.error(line);
  } else {
    console.log(line);
  }
}

// Speech-to-text is a genuinely separate capability from the text/vision
// Gemini providers already integrated in this app (image-analysis-provider-
// gemini.ts, consultation-chat-provider-gemini.ts) -- it has no existing
// abstract provider contract of its own yet, so this route calls the
// Generative Language REST API directly rather than inventing a speculative
// abstraction for a single call site. If SPEECH_TO_TEXT_PROVIDER is unset,
// this is honestly reported as unavailable -- never silently faked.
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  // Deliberately the very first statement, before auth or anything else --
  // a live report reproduced the failure with zero VOICE_TRANSCRIPT lines
  // anywhere in Deploy Logs afterward, leaving genuine ambiguity about
  // whether the request ever reached this route handler at all (versus an
  // edge/proxy layer, or the browser's own fetch call, rejecting it
  // earlier). This line settles that question unconditionally.
  logVoiceTranscript("INFO", "endpoint_entered");

  // Regression: a live retest showed the client receiving a corrupted
  // response -- a real HTTP status (401/503) arrived, but the body never
  // did (net::ERR_HTTP2_PROTOCOL_ERROR, response.json() throwing). Root
  // cause, reproduced independently against production with a request
  // matching the real audio size (~150KB): every early-rejection branch
  // below (auth, rate limit, client lookup, config) used to return BEFORE
  // this route ever read the incoming multipart body. For a small/empty
  // body that's harmless, but for a real, still-uploading ~150KB audio
  // file, ending the response while the client is mid-upload can tear
  // down the connection before the response body is fully delivered.
  // Parsing the body unconditionally, immediately, drains the full upload
  // first, regardless of which check subsequently rejects the request --
  // the audio itself is still validated at its original point below.
  //
  // A request with no body/no valid multipart Content-Type at all (never
  // sent by finishRecording, which always constructs a real FormData, but
  // possible from a bare/malformed request) makes formData() itself throw
  // -- caught here so that case still fails closed with the existing 400
  // "Invalid audio." response, never an uncaught 500.
  let audio: FormDataEntryValue | null;
  let languageHint: FormDataEntryValue | null;
  let clientAttemptId: FormDataEntryValue | null;
  let clientAttemptNumber: FormDataEntryValue | null;
  try {
    const form = await request.formData();
    audio = form.get("audio");
    // Optional, sent by the frontend's current language selector/
    // conversation language -- Gemini's REST API has no dedicated
    // language-hint config field, so this can only be steered via prompt
    // text (see the transcription prompt built below), same technique as
    // consultation-chat-provider-gemini.ts's memory-proposal reminder line.
    languageHint = form.get("language");
    // Voice reliability hardening (2026-08-18): optional, sent by
    // finishRecording (teach-ai-panel-logic.ts) so this one HTTP call can
    // be correlated with the client's own VOICE_TRANSCRIPT_CLIENT console
    // logs, and so a client-driven retry of the SAME logical attempt
    // shares one correlationId with a different attemptNumber for AI
    // usage metering -- two real HTTP calls are two real provider
    // attempts, never silently collapsed into one. Absent for any caller
    // that doesn't send them (including a stale client bundle predating
    // this change) -- handled identically to today: a fresh server-
    // generated id, attempt 1.
    clientAttemptId = form.get("attemptId");
    clientAttemptNumber = form.get("attemptNumber");
  } catch {
    logVoiceTranscript("FAILED", "invalid_audio", { resultCode: "INVALID_AUDIO", reason: "form_data_parse_threw" });
    return NextResponse.json({ error: "Invalid audio." }, { status: 400 });
  }

  // Voice reliability hardening: resolved once, immediately after the
  // form is available, so every subsequent log line for this request
  // (not just the ones after the Gemini call) carries the same
  // client-supplied attemptId a stylist-reported incident can be grepped
  // by. A malformed/missing value falls back to exactly today's
  // behavior (a fresh server id, attempt 1) -- never trusted blindly as
  // a raw string beyond a defensive length cap.
  const attemptId =
    typeof clientAttemptId === "string" && clientAttemptId.trim().length > 0
      ? clientAttemptId.trim().slice(0, 100)
      : randomUUID();
  const attemptNumber = (() => {
    const parsed = typeof clientAttemptNumber === "string" ? Number.parseInt(clientAttemptNumber, 10) : NaN;
    return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
  })();

  const user = await authenticateSessionRequest();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const limiter = checkRateLimit(`voice-transcript:${user.id}`, 10, 60_000);
  if (!limiter.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded." }, { status: 429 });
  }

  const { id } = await context.params;
  const client = await resolveOwnedClient(user.id, id);
  if (client instanceof Response) return client;
  if (!client) {
    return NextResponse.json({ error: "Client not found." }, { status: 404 });
  }

  if (process.env.SPEECH_TO_TEXT_PROVIDER !== "gemini") {
    logVoiceTranscript("FAILED", "config_check", { attemptId, resultCode: "VOICE_PROVIDER_NOT_CONFIGURED", reason: "provider_not_gemini" });
    return NextResponse.json(
      { error: "VOICE_PROVIDER_NOT_CONFIGURED", message: "Voice transcription is not configured. You can still teach the AI by typing." },
      { status: 503 },
    );
  }

  const apiKey = process.env.AI_ANALYSIS_API_KEY;
  // STT model migration (2026-08-21): a real production 404/NOT_FOUND
  // proved gemini-2.5-flash-lite is no longer available to this project ("no
  // longer available to new users" -- Google's own error.message, captured
  // via sttProviderErrorMessage), which Google's own response body names
  // gemini-3.1-flash-lite as the replacement for. The actual model used
  // today is controlled by the SPEECH_TO_TEXT_MODEL env var (an operator
  // action -- see this route's own resolution order below), not this
  // hardcoded string; this default only ever applies if BOTH
  // SPEECH_TO_TEXT_MODEL and AI_ANALYSIS_MODEL are unset. Updated here too
  // so that last-resort fallback doesn't itself point at a model already
  // proven dead for this project.
  const primaryModel = process.env.SPEECH_TO_TEXT_MODEL || process.env.AI_ANALYSIS_MODEL || "gemini-3.1-flash-lite";
  // Voice reliability hardening (2026-08-18): a client-driven retry
  // (finishRecording's own single retry, see teach-ai-panel-logic.ts)
  // sends attemptNumber > 1 -- if an operator has explicitly configured a
  // fallback model (STT_FALLBACK_MODEL), the retry uses it instead of
  // repeating the exact same call against a model that may itself be the
  // thing that's overloaded. Unset by default -- no model is ever
  // invented here; a real fallback model is only ever used once an
  // operator has confirmed and configured one. Every attempt still gets
  // its own, correctly-attributed AI Usage Metering row via `model`
  // below, whichever model actually ran.
  const fallbackModel = process.env.STT_FALLBACK_MODEL;
  const model = attemptNumber > 1 && fallbackModel ? fallbackModel : primaryModel;
  if (!apiKey) {
    logVoiceTranscript("FAILED", "config_check", { attemptId, resultCode: "VOICE_PROVIDER_NOT_CONFIGURED", reason: "api_key_missing" });
    return NextResponse.json(
      { error: "VOICE_PROVIDER_NOT_CONFIGURED", message: "Voice transcription is not configured. You can still teach the AI by typing." },
      { status: 503 },
    );
  }

  if (!(audio instanceof File) || audio.size === 0 || audio.size > MAX_AUDIO_BYTES || !audio.type.startsWith("audio/")) {
    logVoiceTranscript("FAILED", "invalid_audio", {
      attemptId,
      resultCode: "INVALID_AUDIO",
      hasFile: audio instanceof File,
      mimeType: audio instanceof File ? audio.type : null,
      sizeBytes: audio instanceof File ? audio.size : null,
    });
    return NextResponse.json({ error: "Invalid audio." }, { status: 400 });
  }

  // Root cause of the live "Voice transcription failed" report, confirmed
  // against Google's own audio-understanding docs: WebM (MediaRecorder's
  // own default container on Chrome/Android) is not among Gemini's
  // documented supported audio input formats at all -- sending it reaches
  // Gemini's servers fine but fails deep in their own decoding pipeline,
  // surfacing as an opaque provider-side HTTP 500 rather than a clean
  // 400. The client (see audio-wav-encode.ts's decodeBlobAsWav) now
  // converts to WAV before every upload, so this should rarely trigger in
  // practice -- but it exists as a fail-closed safety net for whatever
  // slips through that conversion (an old browser with no AudioContext,
  // conversion throwing for some other reason), rejecting immediately
  // with an honest, specific reason instead of spending a provider call
  // (and its cost/quota) on a request already known to fail, or letting a
  // genuine format problem be misread as a provider outage.
  if (!GEMINI_SUPPORTED_AUDIO_MIME_TYPES.has(baseMimeType(audio.type))) {
    logVoiceTranscript("FAILED", "invalid_audio", {
      attemptId,
      resultCode: "UNSUPPORTED_AUDIO_FORMAT",
      reason: "mime_type_not_supported_by_provider",
      mimeType: audio.type,
      sizeBytes: audio.size,
    });
    return NextResponse.json(
      { error: "UNSUPPORTED_AUDIO_FORMAT", message: "This recording format isn't supported for transcription. Please try again, or type your note." },
      { status: 400 },
    );
  }

  const audioBase64 = Buffer.from(await audio.arrayBuffer()).toString("base64");

  const languageName =
    typeof languageHint === "string" && isSttLanguageCode(languageHint)
      ? getLanguageDefinition(languageHint)?.label ?? null
      : null;
  const transcriptionInstruction = languageName
    ? `Transcribe this audio faithfully. The speaker is most likely speaking ${languageName} -- prefer that ` +
      "language if the audio is ambiguous, but transcribe whatever language is actually spoken. Return only " +
      "the transcript, with no commentary."
    : "Transcribe this audio faithfully. Return only the transcript, with no commentary.";

  // AI Usage & Cost Metering Phase 1: this route calls Gemini directly
  // (no provider abstraction, see this function's own comment above), so
  // usage is captured and recorded right here rather than via the
  // onUsage-callback pattern the three Gemini-SDK-based providers use.
  // correlationId/attemptNumber identify this one logical transcription
  // attempt -- resolved above from the client's own attemptId/
  // attemptNumber when present (a client-driven retry of the same
  // logical attempt), a fresh id/attempt 1 otherwise.
  const correlationId = attemptId;
  const providerCallStartedAt = Date.now();

  let response: Response;
  try {
    response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
        body: JSON.stringify({
          contents: [{ parts: [
            { text: transcriptionInstruction },
            { inlineData: { mimeType: audio.type, data: audioBase64 } },
          ] }],
          generationConfig: { temperature: 0 },
        }),
      },
    );
  } catch (error) {
    logVoiceTranscript("FAILED", "provider_call", {
      attemptId,
      attemptNumber,
      resultCode: "VOICE_TRANSCRIPTION_FAILED",
      reason: "fetch_threw",
      errorName: error instanceof Error ? error.name : "unknown",
      errorMessage: error instanceof Error ? error.message : String(error),
      model,
      audioMimeType: audio.type,
      audioSizeBytes: audio.size,
    });
    // Defense-in-depth, on top of recordAiUsageEvent's own never-throws
    // contract: a metering problem must never turn an already-failed
    // transcription attempt into a DIFFERENT, worse failure for the caller.
    try {
      await recordAiUsageEvent({
        ownerUserId: user.id,
        clientId: id,
        feature: "voice_transcript",
        modality: "STT",
        correlationId,
        attemptNumber,
        provider: "gemini",
        model,
        outcome: "FAILED",
        errorCategory: "FETCH_THREW",
        latencyMs: Date.now() - providerCallStartedAt,
      });
    } catch {
      // Intentionally swallowed -- see comment above.
    }
    // STT Flash-Lite root-cause diagnosis (2026-08-20): distinguishes this
    // branch (no HTTP response ever arrived -- AbortSignal.timeout firing
    // surfaces here as "TimeoutError", a real network failure as
    // "TypeError") from the !response.ok branch below (a real HTTP error
    // response, which has its own providerHttpStatus/providerErrorStatus)
    // -- both used to collapse into the identical client-visible failure,
    // making a genuine timeout indistinguishable from a real provider
    // error without manually finding this route's own server log.
    return NextResponse.json(
      {
        error: "VOICE_TRANSCRIPTION_FAILED",
        message: "Voice transcription timed out or failed. You can still type your note.",
        providerFetchErrorName: error instanceof Error ? error.name : "unknown",
      },
      { status: 502 },
    );
  }

  if (!response.ok) {
    const providerErrorBody = await response.text().catch(() => "");
    // STT Flash-Lite root-cause diagnosis (2026-08-20): providerHttpStatus
    // and providerErrorBody were ALREADY captured here for the server-side
    // VOICE_TRANSCRIPT log line, but never returned to the caller -- a
    // real production failure showed VOICE_LATENCY_SUMMARY's own errorCode
    // collapsed to the same generic "providerUnavailable" for a provider
    // HTTP error, a fetch-level network failure, AND an empty-transcript
    // response alike, with no way to tell them apart without manually
    // cross-referencing the separate VOICE_TRANSCRIPT log line by
    // attemptId. providerErrorStatus is Google's own short, canonical
    // error-status vocabulary (e.g. "UNAVAILABLE", "NOT_FOUND",
    // "RESOURCE_EXHAUSTED", "PERMISSION_DENIED" -- see
    // https://cloud.google.com/apis/design/errors#error_model) parsed
    // from the SAME error body already being logged -- never the raw
    // message text, which could in principle echo back request content.
    // undefined (never fabricated) when the body isn't the expected
    // { error: { status } } shape.
    let providerErrorStatus: string | undefined;
    // STT 404 root-cause diagnosis (2026-08-21): Google's own diagnostic
    // message for this exact error (e.g. distinguishing "model not found"
    // from "not supported for generateContent" from a transient outage) --
    // parsed from the SAME already-logged error body, sanitized/bounded via
    // sanitizeProviderErrorMessage above. undefined (never fabricated) when
    // the body isn't the expected { error: { message } } shape.
    let providerErrorMessage: string | undefined;
    try {
      const parsedError = JSON.parse(providerErrorBody) as { error?: { status?: unknown; message?: unknown } };
      if (typeof parsedError.error?.status === "string") {
        providerErrorStatus = parsedError.error.status;
      }
      if (typeof parsedError.error?.message === "string" && parsedError.error.message.length > 0) {
        providerErrorMessage = sanitizeProviderErrorMessage(parsedError.error.message);
      }
    } catch {
      // Not JSON, or an unexpected shape -- both stay undefined, never guessed.
    }
    logVoiceTranscript("FAILED", "provider_call", {
      attemptId,
      attemptNumber,
      resultCode: "VOICE_TRANSCRIPTION_FAILED",
      reason: "provider_response_not_ok",
      providerHttpStatus: response.status,
      providerErrorStatus: providerErrorStatus ?? null,
      providerErrorMessage: providerErrorMessage ?? null,
      providerErrorBody: providerErrorBody.slice(0, MAX_LOGGED_PROVIDER_ERROR_LENGTH),
      model,
      audioMimeType: audio.type,
      audioSizeBytes: audio.size,
    });
    // Defense-in-depth -- see the fetch-threw branch's identical comment above.
    try {
      await recordAiUsageEvent({
        ownerUserId: user.id,
        clientId: id,
        feature: "voice_transcript",
        modality: "STT",
        correlationId,
        attemptNumber,
        provider: "gemini",
        model,
        outcome: "FAILED",
        errorCategory: `PROVIDER_HTTP_${response.status}`,
        latencyMs: Date.now() - providerCallStartedAt,
      });
    } catch {
      // Intentionally swallowed -- see comment above.
    }
    return NextResponse.json(
      {
        error: "VOICE_TRANSCRIPTION_FAILED",
        message: "Voice transcription failed. You can still type your note.",
        providerHttpStatus: response.status,
        ...(providerErrorStatus ? { providerErrorStatus } : {}),
        ...(providerErrorMessage ? { providerErrorMessage } : {}),
      },
      { status: 502 },
    );
  }

  let transcript: string | undefined;
  let rawUsageMetadata: GeminiRawUsageMetadata | undefined;
  let providerRequestId: string | undefined;
  try {
    const payload = (await response.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      usageMetadata?: GeminiRawUsageMetadata;
      responseId?: string;
    };
    transcript = payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("").trim();
    rawUsageMetadata = payload.usageMetadata;
    providerRequestId = payload.responseId;
  } catch {
    transcript = undefined;
  }
  if (!transcript) {
    logVoiceTranscript("FAILED", "provider_call", {
      attemptId,
      attemptNumber,
      resultCode: "VOICE_TRANSCRIPTION_FAILED",
      reason: "empty_transcript",
      providerHttpStatus: response.status,
      model,
      audioMimeType: audio.type,
      audioSizeBytes: audio.size,
    });
    // Defense-in-depth -- see the fetch-threw branch's identical comment above.
    try {
      await recordAiUsageEvent({
        ownerUserId: user.id,
        clientId: id,
        feature: "voice_transcript",
        modality: "STT",
        correlationId,
        attemptNumber,
        provider: "gemini",
        model,
        providerRequestId,
        usage: mapGeminiUsageMetadata(rawUsageMetadata),
        outcome: "FAILED",
        errorCategory: "EMPTY_TRANSCRIPT",
        latencyMs: Date.now() - providerCallStartedAt,
      });
    } catch {
      // Intentionally swallowed -- see comment above.
    }
    return NextResponse.json({ error: "VOICE_TRANSCRIPTION_FAILED", message: "Voice transcription returned no text. You can still type your note." }, { status: 502 });
  }

  // Voice latency audit (2026-08-18): the exact same measurement AI Usage
  // Metering already computes below, captured once and reused rather than
  // calling Date.now() twice for what must be the same number. Exposed in
  // the success response (providerLatencyMs) so the client can report a
  // real sttProviderMs -- vs. sttTotalMs, the client's own round-trip
  // measurement -- without a second, separate measurement mechanism.
  const providerLatencyMs = Date.now() - providerCallStartedAt;

  // Defense-in-depth, on top of recordAiUsageEvent's own never-throws
  // contract: a metering problem must never turn a successful
  // transcription into a user-visible failure.
  try {
    await recordAiUsageEvent({
      ownerUserId: user.id,
      clientId: id,
      feature: "voice_transcript",
      modality: "STT",
      correlationId,
      attemptNumber,
      provider: "gemini",
      model,
      providerRequestId,
      usage: mapGeminiUsageMetadata(rawUsageMetadata),
      outcome: "SUCCEEDED",
      latencyMs: providerLatencyMs,
    });
  } catch {
    // Intentionally swallowed -- see comment above.
  }

  // Same fail-closed convention as every other repository in this app
  // (consultation-message-repository.ts, analysis-repository.ts, etc.): a
  // persistence problem is reported as a clear 503, never silently
  // degraded, even though the transcription call itself already succeeded.
  if (!isDatabaseConfigured()) {
    logVoiceTranscript("FAILED", "persistence", { attemptId, attemptNumber, resultCode: "VOICE_TRANSCRIPT_PERSISTENCE_UNAVAILABLE", reason: "database_not_configured" });
    return NextResponse.json(
      { error: "VOICE_TRANSCRIPT_PERSISTENCE_UNAVAILABLE", message: "The transcript could not be saved right now. You can still type your note." },
      { status: 503 },
    );
  }

  const truncatedTranscript = transcript.slice(0, MAX_TRANSCRIPT_LENGTH);
  try {
    // Voice reliability hardening (2026-08-18): the row's own primary key
    // is the client's attemptId (stable across a retry of the SAME
    // logical mic-press-to-result cycle), not a fresh id per HTTP call.
    // Closes a real, if narrow, duplicate-submission path: if attempt 1
    // actually persisted successfully but its response was lost in
    // transit (a dropped connection after the write already committed),
    // the client classifies that as a retryable failure and retries --
    // without this, attempt 2 would create a second, genuinely duplicate
    // transcript row for the exact same spoken note. The catch block
    // below turns that exact collision into an idempotent success
    // (returning the already-persisted row) instead of either a
    // duplicate or a false failure.
    const row = await prisma.voiceTranscript.create({
      data: {
        id: attemptId,
        ownerUserId: user.id,
        clientId: id,
        transcript: truncatedTranscript,
        provider: "gemini",
      },
    });
    logVoiceTranscript("SUCCEEDED", "complete", {
      attemptId,
      attemptNumber,
      model,
      audioMimeType: audio.type,
      audioSizeBytes: audio.size,
      transcriptLength: truncatedTranscript.length,
    });
    // Deliberately returns a draft. This route never creates a
    // ProfessionalMemory row -- a separate, explicit POST to
    // /api/v1/clients/{id}/memories (with confirmed: true) is required
    // before this transcript becomes anything the AI treats as memory.
    //
    // Round 11 (gemini-2.5-flash-lite STT evaluation): `model` -- the
    // exact model string that actually ran, whichever of
    // SPEECH_TO_TEXT_MODEL/AI_ANALYSIS_MODEL/the hardcoded default resolved
    // -- is included so a real production test can be attributed to a
    // model without needing to cross-reference the separate VOICE_TRANSCRIPT
    // log line by attemptId every time.
    return NextResponse.json({ transcriptId: row.id, transcript: row.transcript, persistedAsMemory: false, providerLatencyMs, model });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const existing = await prisma.voiceTranscript.findUnique({ where: { id: attemptId } });
      // The ownership check guards against the astronomically unlikely
      // (but not impossible) case of a genuine id collision between two
      // different owners' attemptIds -- never treat someone else's
      // transcript as this caller's own idempotent retry result.
      if (existing && existing.ownerUserId === user.id) {
        logVoiceTranscript("SUCCEEDED", "complete", {
          attemptId,
          attemptNumber,
          model,
          audioMimeType: audio.type,
          audioSizeBytes: audio.size,
          transcriptLength: existing.transcript.length,
          reason: "idempotent_retry_already_persisted",
        });
        return NextResponse.json({ transcriptId: existing.id, transcript: existing.transcript, persistedAsMemory: false, providerLatencyMs, model });
      }
    }
    logVoiceTranscript("FAILED", "persistence", {
      attemptId,
      attemptNumber,
      resultCode: "VOICE_TRANSCRIPT_PERSISTENCE_UNAVAILABLE",
      reason: "prisma_create_threw",
      errorName: error instanceof Error ? error.name : "unknown",
    });
    return NextResponse.json(
      { error: "VOICE_TRANSCRIPT_PERSISTENCE_UNAVAILABLE", message: "The transcript could not be saved right now. You can still type your note." },
      { status: 503 },
    );
  }
}
