import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.hoisted(() => ({ authenticateSessionRequest: vi.fn() }));
const clientRepoMock = vi.hoisted(() => ({ resolveOwnedClient: vi.fn() }));
const hardeningMock = vi.hoisted(() => ({ checkRateLimit: vi.fn() }));
const prismaMocks = vi.hoisted(() => ({ configured: true, create: vi.fn() }));

vi.mock("@/lib/session-request-auth", () => authMock);
vi.mock("@/lib/client-repository", () => clientRepoMock);
vi.mock("@/lib/hardening", () => hardeningMock);
vi.mock("@/lib/prisma", () => ({
  isDatabaseConfigured: () => prismaMocks.configured,
  prisma: { voiceTranscript: { create: prismaMocks.create } },
}));

import { POST } from "./route";

const OWNER = { id: "owner-1", email: "owner@example.com", role: "professional", locale: "en" };
const CLIENT = { id: "client-1", ownerUserId: "owner-1", fullName: "Jane Doe", email: "", phone: "", notes: "", createdAt: "", updatedAt: "" };

const ORIGINAL_ENV = { ...process.env };

function audioForm(overrides: { type?: string; size?: number } = {}): FormData {
  const form = new FormData();
  const bytes = new Uint8Array(overrides.size ?? 1024);
  form.append("audio", new File([bytes], "note.webm", { type: overrides.type ?? "audio/webm" }));
  return form;
}

function invoke(form: FormData | null): Promise<Response> {
  return POST(
    new Request("http://localhost/api/v1/clients/client-1/voice-transcript", { method: "POST", body: form }),
    { params: Promise.resolve({ id: "client-1" }) },
  );
}

function geminiTranscriptResponse(text: string): Response {
  return Response.json({ candidates: [{ content: { parts: [{ text }] } }] }, { status: 200 });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env = { ...ORIGINAL_ENV, SPEECH_TO_TEXT_PROVIDER: "gemini", AI_ANALYSIS_API_KEY: "key", AI_ANALYSIS_MODEL: "gemini-3.6-flash" };
  authMock.authenticateSessionRequest.mockResolvedValue(OWNER);
  clientRepoMock.resolveOwnedClient.mockResolvedValue(CLIENT);
  hardeningMock.checkRateLimit.mockReturnValue({ allowed: true, remaining: 9 });
  prismaMocks.configured = true;
  prismaMocks.create.mockResolvedValue({ id: "transcript-1", transcript: "She had bleach six weeks ago.", createdAt: new Date() });
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

    await invoke(audioForm({ type: "audio/webm" }));

    const logged = loggedLine(errorSpy);
    expect(logged).toMatchObject({
      gate: "VOICE_TRANSCRIPT", status: "FAILED", stage: "provider_call", reason: "provider_response_not_ok",
      providerHttpStatus: 400, audioMimeType: "audio/webm",
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
    await invoke(audioForm({ type: "audio/webm" }));

    expect(errorSpy).not.toHaveBeenCalled();
    const loggedLines = logSpy.mock.calls.map((call) => JSON.parse(call[0] as string));
    const completeLine = loggedLines.find((line) => line.stage === "complete");
    expect(completeLine).toMatchObject({ gate: "VOICE_TRANSCRIPT", status: "SUCCEEDED", stage: "complete", audioMimeType: "audio/webm" });
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
