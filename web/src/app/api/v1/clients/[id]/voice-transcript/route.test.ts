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
