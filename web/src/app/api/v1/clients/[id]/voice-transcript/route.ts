import { randomUUID } from "crypto";

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
  const model = process.env.SPEECH_TO_TEXT_MODEL || process.env.AI_ANALYSIS_MODEL || "gemini-2.5-flash";
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
    return NextResponse.json({ error: "VOICE_TRANSCRIPTION_FAILED", message: "Voice transcription timed out or failed. You can still type your note." }, { status: 502 });
  }

  if (!response.ok) {
    const providerErrorBody = await response.text().catch(() => "");
    logVoiceTranscript("FAILED", "provider_call", {
      attemptId,
      attemptNumber,
      resultCode: "VOICE_TRANSCRIPTION_FAILED",
      reason: "provider_response_not_ok",
      providerHttpStatus: response.status,
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
    return NextResponse.json({ error: "VOICE_TRANSCRIPTION_FAILED", message: "Voice transcription failed. You can still type your note." }, { status: 502 });
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
      latencyMs: Date.now() - providerCallStartedAt,
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
    const row = await prisma.voiceTranscript.create({
      data: {
        id: randomUUID(),
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
    return NextResponse.json({ transcriptId: row.id, transcript: row.transcript, persistedAsMemory: false });
  } catch (error) {
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
