import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.hoisted(() => ({ authenticateSessionRequest: vi.fn() }));
const clientRepoMock = vi.hoisted(() => ({ resolveOwnedClient: vi.fn() }));
const hardeningMock = vi.hoisted(() => ({ checkRateLimit: vi.fn() }));

vi.mock("@/lib/session-request-auth", () => authMock);
vi.mock("@/lib/client-repository", () => clientRepoMock);
vi.mock("@/lib/hardening", () => hardeningMock);

import { POST } from "./route";

const OWNER = { id: "owner-1", email: "owner@example.com", role: "professional", locale: "en" };
const CLIENT = { id: "client-1", ownerUserId: "owner-1", fullName: "Jane Doe", email: "", phone: "", notes: "", createdAt: "", updatedAt: "" };

function validSummary() {
  return {
    recordingFinalizeMs: 12,
    conversionMs: 34,
    sttNetworkAndServerMs: 200,
    sttProviderMs: 150,
    sttTotalMs: 350,
    consultationProviderMs: 900,
    consultationTotalMs: 1000,
    ttsProviderMs: 400,
    ttsTotalMs: 450,
    audioPreparationMs: 20,
    timeToFirstAudioMs: 1900,
    voiceTurnTotalMs: 2100,
  };
}

function invoke(body: unknown): Promise<Response> {
  return POST(
    new Request("http://localhost/api/v1/clients/client-1/voice-latency", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: "client-1" }) },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  authMock.authenticateSessionRequest.mockResolvedValue(OWNER);
  clientRepoMock.resolveOwnedClient.mockResolvedValue(CLIENT);
  hardeningMock.checkRateLimit.mockReturnValue({ allowed: true, remaining: 29 });
});

describe("POST /api/v1/clients/[id]/voice-latency", () => {
  it("returns 401 without a session, never resolving the client or logging anything", async () => {
    authMock.authenticateSessionRequest.mockResolvedValue(null);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const response = await invoke({ attemptId: "attempt-1", outcome: "tts_completed", summary: validSummary() });

    expect(response.status).toBe(401);
    expect(clientRepoMock.resolveOwnedClient).not.toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalled();
    logSpy.mockRestore();
  });

  it("returns 429 when rate-limited, never resolving the client or logging anything", async () => {
    hardeningMock.checkRateLimit.mockReturnValue({ allowed: false, remaining: 0 });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const response = await invoke({ attemptId: "attempt-1", outcome: "tts_completed", summary: validSummary() });

    expect(response.status).toBe(429);
    expect(clientRepoMock.resolveOwnedClient).not.toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalled();
    logSpy.mockRestore();
  });

  it("returns 404 when the client isn't owned by the caller, never logging anything", async () => {
    clientRepoMock.resolveOwnedClient.mockResolvedValue(null);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const response = await invoke({ attemptId: "attempt-1", outcome: "tts_completed", summary: validSummary() });

    expect(response.status).toBe(404);
    expect(logSpy).not.toHaveBeenCalled();
    logSpy.mockRestore();
  });

  it("returns whatever Response resolveOwnedClient itself returns for a cross-owner client id (matches every other client-scoped route)", async () => {
    const crossOwnerResponse = new Response(null, { status: 403 });
    clientRepoMock.resolveOwnedClient.mockResolvedValue(crossOwnerResponse);

    const response = await invoke({ attemptId: "attempt-1", outcome: "tts_completed", summary: validSummary() });

    expect(response).toBe(crossOwnerResponse);
  });

  it("returns 400 for unparseable JSON", async () => {
    const response = await invoke("not json");
    expect(response.status).toBe(400);
  });

  it("returns 400 for a payload that fails strict validation (e.g. a made-up outcome), never logging it", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const response = await invoke({ attemptId: "attempt-1", outcome: "made_up", summary: validSummary() });

    expect(response.status).toBe(400);
    expect(logSpy).not.toHaveBeenCalled();
    logSpy.mockRestore();
  });

  it("accepts a valid payload and logs the literal, searchable 'VOICE LATENCY SUMMARY' string server-side", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const response = await invoke({ attemptId: "attempt-42", outcome: "tts_completed", summary: validSummary() });

    expect(response.status).toBe(202);
    expect(logSpy).toHaveBeenCalledTimes(1);
    const [line] = logSpy.mock.calls[0] as [string];
    expect(line.startsWith("VOICE LATENCY SUMMARY ")).toBe(true);
    const jsonPart = line.slice("VOICE LATENCY SUMMARY ".length);
    const parsed = JSON.parse(jsonPart);
    expect(parsed).toMatchObject({
      tag: "VOICE_LATENCY_SERVER",
      ownerUserId: "owner-1",
      clientId: "client-1",
      attemptId: "attempt-42",
      outcome: "tts_completed",
      ...validSummary(),
    });
    logSpy.mockRestore();
  });

  // Regression this proves: never let a stylist's audio, spoken words, or
  // the AI's reply text reach this endpoint's own logs, even if a buggy or
  // malicious client tried to smuggle them in via extra fields.
  it("never logs a smuggled transcript/reply-text/audio field, even if present in the request body", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await invoke({
      attemptId: "attempt-42",
      outcome: "tts_completed",
      summary: { ...validSummary(), transcript: "Spune-mi ce tunsoare recomanzi", replyText: "some AI reply", audioBase64: "AAAA" },
    });

    const logged = JSON.stringify(logSpy.mock.calls);
    expect(logged).not.toContain("tunsoare");
    expect(logged).not.toContain("some AI reply");
    expect(logged).not.toContain("AAAA");
    logSpy.mockRestore();
  });

  it("never calls any AI provider and never touches AI Usage Metering -- pure, free observability", async () => {
    // No provider/usage-repository module is mocked at all for this test
    // file -- if the route imported and called either, this test would
    // throw (a real network/DB call attempted in a unit test), not merely
    // silently pass.
    const response = await invoke({ attemptId: "attempt-1", outcome: "stt_failed", summary: validSummary() });
    expect(response.status).toBe(202);
  });
});
