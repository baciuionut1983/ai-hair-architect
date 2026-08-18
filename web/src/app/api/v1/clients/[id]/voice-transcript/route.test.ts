import { Prisma } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.hoisted(() => ({ authenticateSessionRequest: vi.fn() }));
const clientRepoMock = vi.hoisted(() => ({ resolveOwnedClient: vi.fn() }));
const hardeningMock = vi.hoisted(() => ({ checkRateLimit: vi.fn() }));
const prismaMocks = vi.hoisted(() => ({ configured: true, create: vi.fn(), findUnique: vi.fn() }));
// AI Usage & Cost Metering Phase 1: this route now also records usage
// after every provider call -- mocked here like every other dependency,
// so this route's own unit tests never need prisma.aiUsageEvent to exist
// on the (otherwise deliberately narrow) prisma mock above.
const usageRepoMock = vi.hoisted(() => ({ recordAiUsageEvent: vi.fn().mockResolvedValue(undefined) }));

vi.mock("@/lib/session-request-auth", () => authMock);
vi.mock("@/lib/client-repository", () => clientRepoMock);
vi.mock("@/lib/hardening", () => hardeningMock);
vi.mock("@/lib/ai-usage-repository", () => usageRepoMock);
vi.mock("@/lib/prisma", () => ({
  isDatabaseConfigured: () => prismaMocks.configured,
  prisma: { voiceTranscript: { create: prismaMocks.create, findUnique: prismaMocks.findUnique } },
}));

import { POST } from "./route";

const OWNER = { id: "owner-1", email: "owner@example.com", role: "professional", locale: "en" };
const CLIENT = { id: "client-1", ownerUserId: "owner-1", fullName: "Jane Doe", email: "", phone: "", notes: "", createdAt: "", updatedAt: "" };

const ORIGINAL_ENV = { ...process.env };

// audio/wav (not audio/webm): the client now always converts a recording
// to WAV -- a format Gemini's own docs confirm as supported -- before
// upload (see audio-wav-encode.ts's decodeBlobAsWav), so that is the
// realistic default for every test in this file EXCEPT the ones
// specifically about the new format-rejection check below.
function audioForm(overrides: { type?: string; size?: number; attemptId?: string; attemptNumber?: number } = {}): FormData {
  const form = new FormData();
  const bytes = new Uint8Array(overrides.size ?? 1024);
  form.append("audio", new File([bytes], "note.wav", { type: overrides.type ?? "audio/wav" }));
  if (overrides.attemptId) {
    form.append("attemptId", overrides.attemptId);
  }
  if (overrides.attemptNumber !== undefined) {
    form.append("attemptNumber", String(overrides.attemptNumber));
  }
  return form;
}

function invoke(form: FormData | null): Promise<Response> {
  return POST(
    new Request("http://localhost/api/v1/clients/client-1/voice-transcript", { method: "POST", body: form }),
    { params: Promise.resolve({ id: "client-1" }) },
  );
}

function geminiTranscriptResponse(text: string, usageMetadata?: Record<string, number>, responseId?: string): Response {
  return Response.json(
    { candidates: [{ content: { parts: [{ text }] } }], ...(usageMetadata ? { usageMetadata } : {}), ...(responseId ? { responseId } : {}) },
    { status: 200 },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env = { ...ORIGINAL_ENV, SPEECH_TO_TEXT_PROVIDER: "gemini", AI_ANALYSIS_API_KEY: "key", AI_ANALYSIS_MODEL: "gemini-3.6-flash" };
  authMock.authenticateSessionRequest.mockResolvedValue(OWNER);
  clientRepoMock.resolveOwnedClient.mockResolvedValue(CLIENT);
  hardeningMock.checkRateLimit.mockReturnValue({ allowed: true, remaining: 9 });
  prismaMocks.configured = true;
  prismaMocks.create.mockResolvedValue({ id: "transcript-1", transcript: "She had bleach six weeks ago.", createdAt: new Date() });
  usageRepoMock.recordAiUsageEvent.mockResolvedValue(undefined);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(geminiTranscriptResponse("She had bleach six weeks ago.")));
});

afterEach(() => {
  process.env = ORIGINAL_ENV;
  vi.unstubAllGlobals();
});

describe("POST /api/v1/clients/[id]/voice-transcript", () => {
  it("returns 401 without a cookie, never calling the provider", async () => {
    authMock.authenticateSessionRequest.mockResolvedValue(null);

    const response = await invoke(audioForm());

    expect(response.status).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
  });

  // Regression: a live retest showed the client receiving a corrupted
  // response for a real ~150KB audio upload -- a real HTTP status arrived
  // (401/503), but the body never fully did (net::ERR_HTTP2_PROTOCOL_ERROR,
  // response.json() throwing). Reproduced independently against production
  // with a large multipart body against this exact 401 path. Root cause:
  // this route used to return its rejection BEFORE ever reading the
  // incoming multipart body -- fine for a tiny/empty body, but for a real,
  // still-uploading audio file, ending the response while the client is
  // mid-upload can corrupt delivery of the response itself. This proves
  // the request body is now read before the earliest possible rejection
  // (401), so the full upload is always drained regardless of outcome.
  it("still reads (drains) the full request body even when authentication fails, so a large in-flight upload is never left unconsumed", async () => {
    authMock.authenticateSessionRequest.mockResolvedValue(null);
    const formDataSpy = vi.fn(() => Promise.resolve(audioForm()));
    const request = new Request("http://localhost/api/v1/clients/client-1/voice-transcript", { method: "POST" });
    Object.defineProperty(request, "formData", { value: formDataSpy });

    const response = await POST(request, { params: Promise.resolve({ id: "client-1" }) });

    expect(response.status).toBe(401);
    expect(formDataSpy).toHaveBeenCalledTimes(1);
  });

  // Regression I found myself while verifying the fix above against
  // production directly: a request with no body/no valid multipart
  // Content-Type at all (never sent by the real Speak to AI flow, which
  // always constructs a proper FormData -- but possible from a bare or
  // malformed request) makes formData() itself throw. Reading it
  // unconditionally without a try/catch turned that into an uncaught,
  // unhandled 500 instead of the existing, controlled 400 response.
  it("fails closed with the existing 400 'Invalid audio.' response (never a raw 500) when the body isn't valid multipart form data at all", async () => {
    const request = new Request("http://localhost/api/v1/clients/client-1/voice-transcript", { method: "POST" });

    const response = await POST(request, { params: Promise.resolve({ id: "client-1" }) });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body).toEqual({ error: "Invalid audio." });
  });

  it("returns 429 when the rate limit is exceeded", async () => {
    hardeningMock.checkRateLimit.mockReturnValue({ allowed: false, remaining: 0 });

    const response = await invoke(audioForm());

    expect(response.status).toBe(429);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("returns 404 for a foreign/nonexistent client -- cross-owner isolation enforced before any provider call", async () => {
    clientRepoMock.resolveOwnedClient.mockResolvedValue(null);

    const response = await invoke(audioForm());

    expect(response.status).toBe(404);
    expect(fetch).not.toHaveBeenCalled();
  });

  // Honesty requirement: no real speech-to-text provider configured -> say
  // so plainly, never invent a transcript, and text input must still work
  // (this route failing never blocks the rest of Consult AI).
  it("returns 503 VOICE_PROVIDER_NOT_CONFIGURED, honestly, when SPEECH_TO_TEXT_PROVIDER is unset", async () => {
    delete process.env.SPEECH_TO_TEXT_PROVIDER;

    const response = await invoke(audioForm());

    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.error).toBe("VOICE_PROVIDER_NOT_CONFIGURED");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("returns 503 VOICE_PROVIDER_NOT_CONFIGURED when the API key is missing, even if the provider flag is set", async () => {
    delete process.env.AI_ANALYSIS_API_KEY;

    const response = await invoke(audioForm());

    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.error).toBe("VOICE_PROVIDER_NOT_CONFIGURED");
  });

  it("returns 400 for missing, empty, oversized, or non-audio uploads", async () => {
    const missing = await invoke(new FormData());
    expect(missing.status).toBe(400);

    const empty = await invoke(audioForm({ size: 0 }));
    expect(empty.status).toBe(400);

    const oversized = await invoke(audioForm({ size: 9 * 1024 * 1024 }));
    expect(oversized.status).toBe(400);

    const wrongType = await invoke(audioForm({ type: "text/plain" }));
    expect(wrongType.status).toBe(400);

    expect(fetch).not.toHaveBeenCalled();
  });

  // Regression: a live production report, confirmed via Railway logs --
  // a real, correctly-sized audio/webm;codecs=opus upload (Chrome's own
  // MediaRecorder default, reproduced on iPhone, Android, and desktop
  // Chrome alike) reached Gemini and was rejected with a provider-side
  // HTTP 500, wasting a real provider call/cost on a request that was
  // always going to fail -- WebM is not among Gemini's own documented
  // supported audio formats at all. This is now caught before ever
  // calling the provider, with an honest, specific reason distinct from
  // the generic "wrong content-type entirely" case above.
  it("returns 400 UNSUPPORTED_AUDIO_FORMAT for audio/webm without ever calling the provider", async () => {
    const response = await invoke(audioForm({ type: "audio/webm;codecs=opus" }));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("UNSUPPORTED_AUDIO_FORMAT");
    expect(body.message).toContain("type your note");
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(["audio/wav", "audio/mp3", "audio/aiff", "audio/aac", "audio/ogg", "audio/flac"])(
    "accepts %s -- one of Gemini's own documented supported audio formats",
    async (type) => {
      const response = await invoke(audioForm({ type }));
      expect(response.status).toBe(200);
    },
  );

  it("returns 502 when the provider call itself fails or times out", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));

    const response = await invoke(audioForm());

    expect(response.status).toBe(502);
  });

  it("returns 502 when the provider responds with a non-ok status", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: "bad request" }, { status: 400 })));

    const response = await invoke(audioForm());

    expect(response.status).toBe(502);
  });

  it("returns 502 when the provider returns no usable transcript text", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ candidates: [] }, { status: 200 })));

    const response = await invoke(audioForm());

    expect(response.status).toBe(502);
  });

  // This route never creates ProfessionalMemory -- only a draft transcript.
  it("persists only a VoiceTranscript draft, never a ProfessionalMemory row, and reports persistedAsMemory: false", async () => {
    const response = await invoke(audioForm());

    expect(response.status).toBe(200);
    expect(prismaMocks.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ ownerUserId: "owner-1", clientId: "client-1", provider: "gemini" }) }),
    );
    const body = await response.json();
    expect(body).toEqual({ transcriptId: "transcript-1", transcript: "She had bleach six weeks ago.", persistedAsMemory: false });
  });

  // Gemini's REST API has no dedicated language-hint config field, so
  // steering it can only be done via prompt text -- these lock in that an
  // optional "language" form field actually reaches the prompt sent to the
  // provider, and that its absence leaves the original, unhinted prompt.
  it("appends a Romanian language hint to the transcription prompt when the form includes language=ro", async () => {
    const fetchMock = vi.fn().mockResolvedValue(geminiTranscriptResponse("Clienta vrea sa pastreze parul lung."));
    vi.stubGlobal("fetch", fetchMock);
    const form = audioForm();
    form.append("language", "ro");

    await invoke(form);

    const requestBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    const promptText = requestBody.contents[0].parts[0].text as string;
    expect(promptText).toContain("most likely speaking Romanian");
  });

  it("appends an English language hint to the transcription prompt when the form includes language=en", async () => {
    const fetchMock = vi.fn().mockResolvedValue(geminiTranscriptResponse("The client wants long hair."));
    vi.stubGlobal("fetch", fetchMock);
    const form = audioForm();
    form.append("language", "en");

    await invoke(form);

    const requestBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    const promptText = requestBody.contents[0].parts[0].text as string;
    expect(promptText).toContain("most likely speaking English");
  });

  it("appends an Arabic language hint too -- not just the original two languages", async () => {
    const fetchMock = vi.fn().mockResolvedValue(geminiTranscriptResponse("مرحبا"));
    vi.stubGlobal("fetch", fetchMock);
    const form = audioForm();
    form.append("language", "ar");

    await invoke(form);

    const requestBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    const promptText = requestBody.contents[0].parts[0].text as string;
    expect(promptText).toContain("most likely speaking Arabic");
  });

  it("sends the original, unhinted prompt when no language field is present at all", async () => {
    const fetchMock = vi.fn().mockResolvedValue(geminiTranscriptResponse("She had bleach six weeks ago."));
    vi.stubGlobal("fetch", fetchMock);

    await invoke(audioForm());

    const requestBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    const promptText = requestBody.contents[0].parts[0].text as string;
    expect(promptText).toBe("Transcribe this audio faithfully. Return only the transcript, with no commentary.");
    expect(promptText).not.toContain("most likely speaking");
  });

  it("ignores an unrecognized language value, falling back to the unhinted prompt", async () => {
    const fetchMock = vi.fn().mockResolvedValue(geminiTranscriptResponse("Bonjour."));
    vi.stubGlobal("fetch", fetchMock);
    const form = audioForm();
    form.append("language", "xx");

    await invoke(form);

    const requestBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    const promptText = requestBody.contents[0].parts[0].text as string;
    expect(promptText).not.toContain("most likely speaking");
  });

  // "fa" (Persian) is a real language-registry entry (see
  // language-registry.ts) but not yet STT-supported (not confirmed on
  // Gemini's documented language list) -- it must fall back to the
  // unhinted prompt exactly like a nonsense string, not be accepted as a
  // hint just because it's a known registry code.
  it("ignores a registry language that is not yet STT-supported", async () => {
    const fetchMock = vi.fn().mockResolvedValue(geminiTranscriptResponse("Salaam."));
    vi.stubGlobal("fetch", fetchMock);
    const form = audioForm();
    form.append("language", "fa");

    await invoke(form);

    const requestBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    const promptText = requestBody.contents[0].parts[0].text as string;
    expect(promptText).not.toContain("most likely speaking");
  });

  it("appends a language hint for languages well beyond the original two -- Japanese, Korean, Hindi, Russian", async () => {
    for (const [code, label] of [["ja", "Japanese"], ["ko", "Korean"], ["hi", "Hindi"], ["ru", "Russian"]] as const) {
      const fetchMock = vi.fn().mockResolvedValue(geminiTranscriptResponse("transcript"));
      vi.stubGlobal("fetch", fetchMock);
      const form = audioForm();
      form.append("language", code);

      await invoke(form);

      const requestBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
      const promptText = requestBody.contents[0].parts[0].text as string;
      expect(promptText).toContain(`most likely speaking ${label}`);
    }
  });

  // Same fail-closed convention as every other repository in this app --
  // even though the real transcription already succeeded, a persistence
  // failure is reported as a clear 503, never a silently degraded 200.
  it("fails closed with 503 when the database is not configured, even though transcription already succeeded", async () => {
    prismaMocks.configured = false;

    const response = await invoke(audioForm());

    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.error).toBe("VOICE_TRANSCRIPT_PERSISTENCE_UNAVAILABLE");
  });

  it("fails closed with 503 when the transcript insert itself throws", async () => {
    prismaMocks.create.mockRejectedValue(new Error("db down"));

    const response = await invoke(audioForm());

    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.error).toBe("VOICE_TRANSCRIPT_PERSISTENCE_UNAVAILABLE");
  });
});

describe("AI usage metering", () => {
  it("records a SUCCEEDED STT usage event, mapping the real Gemini usageMetadata to provider-neutral field names", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        geminiTranscriptResponse("She had bleach six weeks ago.", { promptTokenCount: 50, candidatesTokenCount: 12 }, "resp-42"),
      ),
    );

    await invoke(audioForm());

    expect(usageRepoMock.recordAiUsageEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerUserId: "owner-1",
        clientId: "client-1",
        feature: "voice_transcript",
        modality: "STT",
        provider: "gemini",
        providerRequestId: "resp-42",
        usage: { inputTokens: 50, outputTokens: 12 },
        outcome: "SUCCEEDED",
      }),
    );
  });

  it("records a FAILED usage event, explicitly marking usage unavailable, when the provider fetch itself throws", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));

    await invoke(audioForm());

    expect(usageRepoMock.recordAiUsageEvent).toHaveBeenCalledWith(
      expect.objectContaining({ feature: "voice_transcript", modality: "STT", outcome: "FAILED", errorCategory: "FETCH_THREW" }),
    );
    const call = usageRepoMock.recordAiUsageEvent.mock.calls[0][0];
    expect(call.usage).toBeUndefined();
  });

  it("records a FAILED usage event with the provider's real HTTP status when the response is not ok", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: "quota" }, { status: 429 })));

    await invoke(audioForm());

    expect(usageRepoMock.recordAiUsageEvent).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "FAILED", errorCategory: "PROVIDER_HTTP_429" }),
    );
  });

  it("a metering failure never turns a successful transcription into a user-visible failure", async () => {
    usageRepoMock.recordAiUsageEvent.mockRejectedValueOnce(new Error("this should never surface"));

    const response = await invoke(audioForm());

    expect(response.status).toBe(200);
  });

  // Voice reliability hardening (2026-08-18): a client-driven retry of the
  // same logical mic-press-to-result cycle (see finishRecording's own
  // single-retry mechanism) sends the SAME attemptId with a different
  // attemptNumber -- this is what lets a retry be recorded as two real,
  // distinct provider attempts rather than either silently merged into
  // one (losing real cost data) or double-counted as if two unrelated
  // recordings happened.
  it("uses the client-supplied attemptId as the usage event's correlationId, and the client-supplied attemptNumber, when both are sent", async () => {
    await invoke(audioForm({ attemptId: "client-attempt-77", attemptNumber: 2 }));

    expect(usageRepoMock.recordAiUsageEvent).toHaveBeenCalledWith(
      expect.objectContaining({ correlationId: "client-attempt-77", attemptNumber: 2 }),
    );
  });

  it("falls back to a fresh server-generated correlationId and attemptNumber 1 when the client sends neither -- e.g. a stale client bundle predating this change", async () => {
    await invoke(audioForm());

    const call = usageRepoMock.recordAiUsageEvent.mock.calls[0][0];
    expect(typeof call.correlationId).toBe("string");
    expect(call.correlationId.length).toBeGreaterThan(0);
    expect(call.attemptNumber).toBe(1);
  });

  it("falls back to attemptNumber 1 when the client sends a malformed attemptNumber (never trusts an arbitrary string blindly)", async () => {
    await invoke(audioForm({ attemptId: "client-attempt-1", attemptNumber: Number.NaN }));

    expect(usageRepoMock.recordAiUsageEvent).toHaveBeenCalledWith(expect.objectContaining({ attemptNumber: 1 }));
  });
});

// Voice reliability hardening (2026-08-18): a real Gemini 503 was proven
// in production, correctly retried once (see finishRecording's own
// RETRYABLE_ERROR_CODES) but still failed. STT_FALLBACK_MODEL lets an
// operator configure a genuinely different model for the retry attempt
// only, without ever inventing one here -- unset (the default in every
// environment today) means attempt 2 uses the exact same model as
// attempt 1, zero behavior change.
describe("STT fallback model", () => {
  it("uses the primary model for attempt 1 and the configured fallback for attempt 2, when STT_FALLBACK_MODEL is set", async () => {
    process.env.STT_FALLBACK_MODEL = "gemini-3.6-flash-fallback";

    await invoke(audioForm({ attemptId: "a-1", attemptNumber: 1 }));
    expect(usageRepoMock.recordAiUsageEvent).toHaveBeenLastCalledWith(expect.objectContaining({ model: "gemini-3.6-flash" }));

    usageRepoMock.recordAiUsageEvent.mockClear();
    await invoke(audioForm({ attemptId: "a-1", attemptNumber: 2 }));
    expect(usageRepoMock.recordAiUsageEvent).toHaveBeenLastCalledWith(expect.objectContaining({ model: "gemini-3.6-flash-fallback" }));
  });

  it("uses the SAME primary model for attempt 2 when STT_FALLBACK_MODEL is not configured -- no model is ever invented", async () => {
    delete process.env.STT_FALLBACK_MODEL;

    await invoke(audioForm({ attemptId: "a-1", attemptNumber: 2 }));

    expect(usageRepoMock.recordAiUsageEvent).toHaveBeenCalledWith(expect.objectContaining({ model: "gemini-3.6-flash" }));
  });

  it("each attempt (primary and fallback model alike) is recorded as its own, separately accountable AI usage event -- never merged", async () => {
    process.env.STT_FALLBACK_MODEL = "gemini-3.6-flash-fallback";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: "quota" }, { status: 503 })));

    await invoke(audioForm({ attemptId: "shared-attempt", attemptNumber: 1 }));
    await invoke(audioForm({ attemptId: "shared-attempt", attemptNumber: 2 }));

    expect(usageRepoMock.recordAiUsageEvent).toHaveBeenCalledTimes(2);
    expect(usageRepoMock.recordAiUsageEvent).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ correlationId: "shared-attempt", attemptNumber: 1, model: "gemini-3.6-flash", outcome: "FAILED" }),
    );
    expect(usageRepoMock.recordAiUsageEvent).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ correlationId: "shared-attempt", attemptNumber: 2, model: "gemini-3.6-flash-fallback", outcome: "FAILED" }),
    );
  });
});

// Voice reliability hardening (2026-08-18), task requirement H: a retry
// must never create a duplicate persisted transcript for the same
// logical spoken note. The real (narrow) risk this closes: attempt 1
// actually persists successfully, but its HTTP response is lost in
// transit before the client sees it -- the client classifies that as a
// retryable failure (fetch_threw/response_json_parse_threw) and retries
// automatically. Using the client's own stable attemptId as the row's
// primary key turns the retry's second create() into a unique-constraint
// collision (P2002), handled here as an idempotent success (the already-
// persisted row is returned) rather than either a silent duplicate or a
// false failure.
describe("idempotent persistence on retry", () => {
  it("uses the client's attemptId as the transcript row's own id", async () => {
    await invoke(audioForm({ attemptId: "attempt-abc", attemptNumber: 1 }));

    expect(prismaMocks.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ id: "attempt-abc" }) }),
    );
  });

  it("a P2002 collision on retry (attempt 1 actually persisted, its response was lost) returns the ALREADY-persisted row as a success, never a duplicate or a failure", async () => {
    const collision = new Prisma.PrismaClientKnownRequestError("Unique constraint failed", { code: "P2002", clientVersion: "test" });
    prismaMocks.create.mockRejectedValueOnce(collision);
    prismaMocks.findUnique.mockResolvedValueOnce({
      id: "attempt-abc",
      ownerUserId: "owner-1",
      transcript: "She had bleach six weeks ago.",
    });

    const response = await invoke(audioForm({ attemptId: "attempt-abc", attemptNumber: 2 }));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ transcriptId: "attempt-abc", transcript: "She had bleach six weeks ago.", persistedAsMemory: false });
    expect(prismaMocks.create).toHaveBeenCalledTimes(1);
  });

  it("never returns another owner's transcript on a P2002 collision -- an id collision with a DIFFERENT owner's row is treated as a genuine persistence failure, not idempotent success", async () => {
    const collision = new Prisma.PrismaClientKnownRequestError("Unique constraint failed", { code: "P2002", clientVersion: "test" });
    prismaMocks.create.mockRejectedValueOnce(collision);
    prismaMocks.findUnique.mockResolvedValueOnce({
      id: "attempt-abc",
      ownerUserId: "some-other-owner",
      transcript: "unrelated content",
    });

    const response = await invoke(audioForm({ attemptId: "attempt-abc", attemptNumber: 1 }));

    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.error).toBe("VOICE_TRANSCRIPT_PERSISTENCE_UNAVAILABLE");
  });

  it("a genuine (non-P2002) persistence failure is never mistaken for an idempotent retry", async () => {
    prismaMocks.create.mockRejectedValueOnce(new Error("connection refused"));

    const response = await invoke(audioForm({ attemptId: "attempt-abc", attemptNumber: 1 }));

    expect(response.status).toBe(503);
    expect(prismaMocks.findUnique).not.toHaveBeenCalled();
  });
});

// Regression: a live report ("Voice transcription failed. You can still
// type your note.") could not be root-caused because this route had zero
// diagnostic logging on any branch -- every failure was silent from
// Railway's perspective. These lock in that every branch now logs enough
// to distinguish, e.g., a bad audio MIME type from an auth/quota problem,
// while never logging the audio bytes, the transcript content, or the API
// key (only ever in the request URL, never read back for logging).
describe("production diagnostics logging", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
    logSpy.mockRestore();
  });

  function loggedLine(spy: ReturnType<typeof vi.spyOn>, index = 0): Record<string, unknown> {
    return JSON.parse(spy.mock.calls[index][0] as string);
  }

  it("logs config_check FAILED with a specific reason when SPEECH_TO_TEXT_PROVIDER is unset", async () => {
    delete process.env.SPEECH_TO_TEXT_PROVIDER;

    await invoke(audioForm());

    expect(loggedLine(errorSpy)).toMatchObject({ gate: "VOICE_TRANSCRIPT", status: "FAILED", stage: "config_check", reason: "provider_not_gemini" });
  });

  it("logs config_check FAILED with a specific reason when the API key is missing", async () => {
    delete process.env.AI_ANALYSIS_API_KEY;

    await invoke(audioForm());

    expect(loggedLine(errorSpy)).toMatchObject({ gate: "VOICE_TRANSCRIPT", status: "FAILED", stage: "config_check", reason: "api_key_missing" });
  });

  it("logs invalid_audio FAILED with the mime type and size, never the audio bytes themselves", async () => {
    await invoke(audioForm({ type: "text/plain" }));

    const logged = loggedLine(errorSpy);
    expect(logged).toMatchObject({ gate: "VOICE_TRANSCRIPT", status: "FAILED", stage: "invalid_audio", mimeType: "text/plain" });
    expect(JSON.stringify(logged)).not.toContain("bytes");
  });

  it("logs provider_call FAILED with the real error name/message when the fetch itself throws", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    await invoke(audioForm());

    expect(loggedLine(errorSpy)).toMatchObject({
      gate: "VOICE_TRANSCRIPT", status: "FAILED", stage: "provider_call", reason: "fetch_threw",
      errorName: "TypeError", errorMessage: "Failed to fetch",
    });
  });

  // The key diagnostic this fix exists for: distinguishing e.g. a rejected
  // audio MIME type from an auth/quota/model problem requires the
  // provider's own HTTP status and error body, not just "it failed".
  it("logs provider_call FAILED with the provider's real HTTP status and a bounded excerpt of its error body when the response is not ok", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      Response.json({ error: { code: 400, message: "Invalid value at 'contents[0].parts[1].inline_data.mime_type'", status: "INVALID_ARGUMENT" } }, { status: 400 }),
    ));

    await invoke(audioForm({ type: "audio/wav" }));

    const logged = loggedLine(errorSpy);
    expect(logged).toMatchObject({
      gate: "VOICE_TRANSCRIPT", status: "FAILED", stage: "provider_call", reason: "provider_response_not_ok",
      providerHttpStatus: 400, audioMimeType: "audio/wav",
    });
    expect(String(logged.providerErrorBody)).toContain("INVALID_ARGUMENT");
  });

  it("truncates an unexpectedly large provider error body instead of logging it in full", async () => {
    const hugeMessage = "x".repeat(10_000);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: { message: hugeMessage } }, { status: 500 })));

    await invoke(audioForm());

    const logged = loggedLine(errorSpy);
    expect(String(logged.providerErrorBody).length).toBeLessThanOrEqual(500);
  });

  it("never logs the API key anywhere, on any branch", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: "bad request" }, { status: 400 })));

    await invoke(audioForm());

    const logged = JSON.stringify(errorSpy.mock.calls);
    expect(logged).not.toContain("key");
  });

  it("logs provider_call FAILED with reason empty_transcript when the provider returns no usable text", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ candidates: [] }, { status: 200 })));

    await invoke(audioForm());

    expect(loggedLine(errorSpy)).toMatchObject({ gate: "VOICE_TRANSCRIPT", status: "FAILED", stage: "provider_call", reason: "empty_transcript" });
  });

  it("logs persistence FAILED with reason database_not_configured", async () => {
    prismaMocks.configured = false;

    await invoke(audioForm());

    expect(loggedLine(errorSpy)).toMatchObject({ gate: "VOICE_TRANSCRIPT", status: "FAILED", stage: "persistence", reason: "database_not_configured" });
  });

  it("logs persistence FAILED with reason prisma_create_threw", async () => {
    prismaMocks.create.mockRejectedValue(new Error("db down"));

    await invoke(audioForm());

    expect(loggedLine(errorSpy)).toMatchObject({ gate: "VOICE_TRANSCRIPT", status: "FAILED", stage: "persistence", reason: "prisma_create_threw" });
  });

  it("logs a SUCCEEDED line on success (console.log, not console.error), with safe fields but never the transcript content", async () => {
    await invoke(audioForm({ type: "audio/wav" }));

    expect(errorSpy).not.toHaveBeenCalled();
    const loggedLines = logSpy.mock.calls.map((call) => JSON.parse(call[0] as string));
    const completeLine = loggedLines.find((line) => line.stage === "complete");
    expect(completeLine).toMatchObject({ gate: "VOICE_TRANSCRIPT", status: "SUCCEEDED", stage: "complete", audioMimeType: "audio/wav" });
    expect(JSON.stringify(loggedLines)).not.toContain("She had bleach");
  });

  // Regression: a live retest reproduced the failure with ZERO
  // VOICE_TRANSCRIPT lines anywhere in Deploy Logs, leaving genuine
  // ambiguity about whether the request had even reached this route
  // handler. This is deliberately the very first statement in POST,
  // before auth or any other check, so it fires unconditionally --
  // locking in that the NEXT live retest can settle that question with
  // certainty regardless of how the request ultimately fails.
  it("logs endpoint_entered as the very first line, unconditionally, even before authentication is checked", async () => {
    authMock.authenticateSessionRequest.mockResolvedValue(null);

    const response = await invoke(audioForm());

    expect(response.status).toBe(401);
    const firstLine = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(firstLine).toMatchObject({ gate: "VOICE_TRANSCRIPT", status: "INFO", stage: "endpoint_entered" });
  });
});
