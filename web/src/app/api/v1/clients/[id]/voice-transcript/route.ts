import { randomUUID } from "crypto";

import { NextResponse } from "next/server";

import { resolveOwnedClient } from "@/lib/client-repository";
import { checkRateLimit } from "@/lib/hardening";
import { isDatabaseConfigured, prisma } from "@/lib/prisma";
import { authenticateSessionRequest } from "@/lib/session-request-auth";

const MAX_AUDIO_BYTES = 8 * 1024 * 1024;
const PROVIDER_TIMEOUT_MS = 30_000;
const MAX_TRANSCRIPT_LENGTH = 4000;

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

function logVoiceTranscript(status: "SUCCEEDED" | "FAILED", stage: string, details: Record<string, unknown> = {}): void {
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
    logVoiceTranscript("FAILED", "config_check", { resultCode: "VOICE_PROVIDER_NOT_CONFIGURED", reason: "provider_not_gemini" });
    return NextResponse.json(
      { error: "VOICE_PROVIDER_NOT_CONFIGURED", message: "Voice transcription is not configured. You can still teach the AI by typing." },
      { status: 503 },
    );
  }

  const apiKey = process.env.AI_ANALYSIS_API_KEY;
  const model = process.env.SPEECH_TO_TEXT_MODEL || process.env.AI_ANALYSIS_MODEL || "gemini-2.5-flash";
  if (!apiKey) {
    logVoiceTranscript("FAILED", "config_check", { resultCode: "VOICE_PROVIDER_NOT_CONFIGURED", reason: "api_key_missing" });
    return NextResponse.json(
      { error: "VOICE_PROVIDER_NOT_CONFIGURED", message: "Voice transcription is not configured. You can still teach the AI by typing." },
      { status: 503 },
    );
  }

  const form = await request.formData();
  const audio = form.get("audio");
  if (!(audio instanceof File) || audio.size === 0 || audio.size > MAX_AUDIO_BYTES || !audio.type.startsWith("audio/")) {
    logVoiceTranscript("FAILED", "invalid_audio", {
      resultCode: "INVALID_AUDIO",
      hasFile: audio instanceof File,
      mimeType: audio instanceof File ? audio.type : null,
      sizeBytes: audio instanceof File ? audio.size : null,
    });
    return NextResponse.json({ error: "Invalid audio." }, { status: 400 });
  }

  const audioBase64 = Buffer.from(await audio.arrayBuffer()).toString("base64");

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
            { text: "Transcribe this audio faithfully. Return only the transcript, with no commentary." },
            { inlineData: { mimeType: audio.type, data: audioBase64 } },
          ] }],
          generationConfig: { temperature: 0 },
        }),
      },
    );
  } catch (error) {
    logVoiceTranscript("FAILED", "provider_call", {
      resultCode: "VOICE_TRANSCRIPTION_FAILED",
      reason: "fetch_threw",
      errorName: error instanceof Error ? error.name : "unknown",
      errorMessage: error instanceof Error ? error.message : String(error),
      model,
      audioMimeType: audio.type,
      audioSizeBytes: audio.size,
    });
    return NextResponse.json({ error: "VOICE_TRANSCRIPTION_FAILED", message: "Voice transcription timed out or failed. You can still type your note." }, { status: 502 });
  }

  if (!response.ok) {
    const providerErrorBody = await response.text().catch(() => "");
    logVoiceTranscript("FAILED", "provider_call", {
      resultCode: "VOICE_TRANSCRIPTION_FAILED",
      reason: "provider_response_not_ok",
      providerHttpStatus: response.status,
      providerErrorBody: providerErrorBody.slice(0, MAX_LOGGED_PROVIDER_ERROR_LENGTH),
      model,
      audioMimeType: audio.type,
      audioSizeBytes: audio.size,
    });
    return NextResponse.json({ error: "VOICE_TRANSCRIPTION_FAILED", message: "Voice transcription failed. You can still type your note." }, { status: 502 });
  }

  let transcript: string | undefined;
  try {
    const payload = (await response.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    transcript = payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("").trim();
  } catch {
    transcript = undefined;
  }
  if (!transcript) {
    logVoiceTranscript("FAILED", "provider_call", {
      resultCode: "VOICE_TRANSCRIPTION_FAILED",
      reason: "empty_transcript",
      providerHttpStatus: response.status,
      model,
      audioMimeType: audio.type,
      audioSizeBytes: audio.size,
    });
    return NextResponse.json({ error: "VOICE_TRANSCRIPTION_FAILED", message: "Voice transcription returned no text. You can still type your note." }, { status: 502 });
  }

  // Same fail-closed convention as every other repository in this app
  // (consultation-message-repository.ts, analysis-repository.ts, etc.): a
  // persistence problem is reported as a clear 503, never silently
  // degraded, even though the transcription call itself already succeeded.
  if (!isDatabaseConfigured()) {
    logVoiceTranscript("FAILED", "persistence", { resultCode: "VOICE_TRANSCRIPT_PERSISTENCE_UNAVAILABLE", reason: "database_not_configured" });
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
