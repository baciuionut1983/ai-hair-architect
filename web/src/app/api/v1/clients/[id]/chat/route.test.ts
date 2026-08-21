import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.hoisted(() => ({ authenticateSessionRequest: vi.fn() }));
const clientRepoMock = vi.hoisted(() => ({ resolveOwnedClient: vi.fn() }));
const serviceMock = vi.hoisted(() => ({
  CONSULTATION_CHAT_RESULT_HTTP_STATUS: {
    PROCESSING_DISABLED: 503,
    PROVIDER_CONFIGURATION_INVALID: 503,
    ANALYSIS_NOT_FOUND: 404,
    PROVIDER_TIMEOUT: 504,
    PROVIDER_UNAVAILABLE: 503,
    PROVIDER_AUTHENTICATION_FAILURE: 502,
    MALFORMED_PROVIDER_RESPONSE: 502,
    PERSISTENCE_FAILURE: 500,
    INTERNAL_PROCESSING_FAILURE: 500,
  },
  sendConsultationMessage: vi.fn(),
}));
const messageRepoMock = vi.hoisted(() => ({
  isConsultationMessagePersistenceError: vi.fn(() => false),
  listRecentConsultationMessages: vi.fn(),
}));
const hardeningMock = vi.hoisted(() => ({
  checkRateLimit: vi.fn(),
  ensureRequestId: vi.fn(),
}));

vi.mock("@/lib/session-request-auth", () => authMock);
vi.mock("@/lib/client-repository", () => clientRepoMock);
vi.mock("@/lib/consultation-chat-service", () => serviceMock);
vi.mock("@/lib/consultation-message-repository", () => messageRepoMock);
vi.mock("@/lib/hardening", () => hardeningMock);

import { GET, POST } from "./route";

const OWNER = { id: "owner-1", email: "owner@example.com", role: "professional", locale: "en" };
const CLIENT = { id: "client-1", ownerUserId: "owner-1", fullName: "Jane Doe", email: "", phone: "", notes: "", createdAt: "", updatedAt: "" };

function invoke(id: string, body: unknown): Promise<Response> {
  return POST(
    new Request(`http://localhost/api/v1/clients/${id}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );
}

function invokeGet(id: string): Promise<Response> {
  return GET(new Request(`http://localhost/api/v1/clients/${id}/chat`), { params: Promise.resolve({ id }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  authMock.authenticateSessionRequest.mockResolvedValue(OWNER);
  clientRepoMock.resolveOwnedClient.mockResolvedValue(CLIENT);
  hardeningMock.checkRateLimit.mockReturnValue({ allowed: true, remaining: 29 });
  hardeningMock.ensureRequestId.mockReturnValue("req-fixed");
  serviceMock.sendConsultationMessage.mockResolvedValue({
    outcome: "succeeded",
    reply: { id: "msg-2", role: "assistant", content: "Got it!", proposedCorrection: null, createdAt: "2026-08-14T10:00:00.000Z" },
    needsClarification: false,
  });
  messageRepoMock.listRecentConsultationMessages.mockResolvedValue([]);
});

describe("POST /api/v1/clients/[id]/chat", () => {
  it("returns 401 without a cookie, never touching the client repository or the service", async () => {
    authMock.authenticateSessionRequest.mockResolvedValue(null);

    const response = await invoke("client-1", { message: "hi" });

    expect(response.status).toBe(401);
    expect(clientRepoMock.resolveOwnedClient).not.toHaveBeenCalled();
    expect(serviceMock.sendConsultationMessage).not.toHaveBeenCalled();
  });

  it("returns 429 when the rate limit is exceeded, never touching the service", async () => {
    hardeningMock.checkRateLimit.mockReturnValue({ allowed: false, remaining: 0 });

    const response = await invoke("client-1", { message: "hi" });

    expect(response.status).toBe(429);
    expect(serviceMock.sendConsultationMessage).not.toHaveBeenCalled();
  });

  it("returns 404 when the client does not exist or belongs to another owner -- P: cross-owner isolation enforced before any chat logic runs", async () => {
    clientRepoMock.resolveOwnedClient.mockResolvedValue(null);

    const response = await invoke("foreign-client", { message: "hi" });

    expect(response.status).toBe(404);
    expect(serviceMock.sendConsultationMessage).not.toHaveBeenCalled();
  });

  it("passes through a persistence-unavailable Response from resolveOwnedClient unchanged", async () => {
    const persistenceResponse = Response.json({ error: "CLIENT_PERSISTENCE_UNAVAILABLE" }, { status: 503 });
    clientRepoMock.resolveOwnedClient.mockResolvedValue(persistenceResponse);

    const response = await invoke("client-1", { message: "hi" });

    expect(response.status).toBe(503);
    expect(serviceMock.sendConsultationMessage).not.toHaveBeenCalled();
  });

  it("returns 400 when message is missing or blank", async () => {
    const response = await invoke("client-1", { message: "   " });
    expect(response.status).toBe(400);
    expect(serviceMock.sendConsultationMessage).not.toHaveBeenCalled();
  });

  it("passes the authenticated owner, resolved client, trimmed message, and optional analysisId to the service", async () => {
    await invoke("client-1", { message: "  Her density is low  ", analysisId: "analysis-1" });

    expect(serviceMock.sendConsultationMessage).toHaveBeenCalledWith(
      "owner-1",
      CLIENT,
      "Her density is low",
      "analysis-1",
      {},
      expect.any(Object),
      undefined,
    );
  });

  // OWNER.locale is "en" -- with no explicit selector/conversation language
  // sent by the frontend, the account locale is used only as the soft
  // ambiguous-message fallback, never as a forced override.
  it("defaults the language hint to the stylist's own account locale as a fallback only, when the frontend sends nothing", async () => {
    await invoke("client-1", { message: "hi" });

    expect(serviceMock.sendConsultationMessage).toHaveBeenCalledWith(
      "owner-1", CLIENT, "hi", undefined, {},
      { forced: undefined, fallback: "en" },
      undefined,
    );
  });

  it("forwards an explicit languagePreference as a forced language hint", async () => {
    await invoke("client-1", { message: "hi", languagePreference: "ro" });

    expect(serviceMock.sendConsultationMessage).toHaveBeenCalledWith(
      "owner-1", CLIENT, "hi", undefined, {},
      { forced: "ro", fallback: "en" },
      undefined,
    );
  });

  it("forwards conversationLanguage as the fallback when the selector is auto (no languagePreference)", async () => {
    await invoke("client-1", { message: "hi", conversationLanguage: "ro" });

    expect(serviceMock.sendConsultationMessage).toHaveBeenCalledWith(
      "owner-1", CLIENT, "hi", undefined, {},
      { forced: undefined, fallback: "ro" },
      undefined,
    );
  });

  it("forwards a forced languagePreference for languages well beyond the original seven -- Japanese, Korean, Hindi, Russian", async () => {
    for (const code of ["ja", "ko", "hi", "ru"]) {
      const response = await invoke("client-1", { message: "hi", languagePreference: code });
      expect(response.status).toBe(200);
      expect(serviceMock.sendConsultationMessage).toHaveBeenCalledWith(
        "owner-1", CLIENT, "hi", undefined, {},
        { forced: code, fallback: "en" },
        undefined,
      );
    }
  });

  it("ignores a garbage/unsupported languagePreference or conversationLanguage value instead of forwarding it", async () => {
    await invoke("client-1", { message: "hi", languagePreference: "auto", conversationLanguage: "xx" });

    expect(serviceMock.sendConsultationMessage).toHaveBeenCalledWith(
      "owner-1", CLIENT, "hi", undefined, {},
      { forced: undefined, fallback: "en" },
      undefined,
    );
  });

  // "fa" (Persian) is a real language-registry entry (see
  // language-registry.ts) but not yet conversation-supported (not
  // confirmed on Gemini's documented language list) -- it must be
  // rejected here exactly like a nonsense string, not accepted just
  // because it's a known code.
  it("ignores a registry language that is not yet conversation-supported", async () => {
    await invoke("client-1", { message: "hi", languagePreference: "fa" });

    expect(serviceMock.sendConsultationMessage).toHaveBeenCalledWith(
      "owner-1", CLIENT, "hi", undefined, {},
      { forced: undefined, fallback: "en" },
      undefined,
    );
  });

  it("maps every failed outcome code to its documented HTTP status", async () => {
    serviceMock.sendConsultationMessage.mockResolvedValue({ outcome: "failed", code: "PROVIDER_TIMEOUT" });

    const response = await invoke("client-1", { message: "hi" });

    expect(response.status).toBe(504);
    const body = await response.json();
    expect(body.error).toBe("PROVIDER_TIMEOUT");
  });

  it("H: does not fabricate a reply when the provider is unavailable/misconfigured", async () => {
    serviceMock.sendConsultationMessage.mockResolvedValue({ outcome: "failed", code: "PROCESSING_DISABLED" });

    const response = await invoke("client-1", { message: "hi" });

    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body).toEqual({ error: "PROCESSING_DISABLED" });
  });

  it("on success, returns the assistant's reply and needsClarification", async () => {
    const response = await invoke("client-1", { message: "hi" });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      reply: { id: "msg-2", role: "assistant", content: "Got it!", createdAt: "2026-08-14T10:00:00.000Z" },
      needsClarification: false,
    });
  });

  // Voice latency audit (2026-08-18): surfaces the service's own real,
  // measured provider duration so a voice-driven turn can report
  // consultationProviderMs -- distinct from the client's own round-trip
  // measurement -- without a second, separate measurement mechanism.
  it("surfaces providerLatencyMs in the response when the service reports one", async () => {
    serviceMock.sendConsultationMessage.mockResolvedValue({
      outcome: "succeeded",
      reply: { id: "msg-2", role: "assistant", content: "Got it!", createdAt: "2026-08-14T10:00:00.000Z" },
      needsClarification: false,
      providerLatencyMs: 842,
    });

    const response = await invoke("client-1", { message: "hi" });

    const body = await response.json();
    expect(body.providerLatencyMs).toBe(842);
  });

  // Voice latency Round 12: a real production test showed a ~27.6s gap
  // between the client's round-trip consultationTotalMs and
  // providerLatencyMs with nothing to explain it -- these five fields
  // (already computed server-side, just never returned before this round)
  // close that gap.
  it("surfaces the full server timing breakdown (preProviderReadsMs/replyWriteMs/failedFirstAttemptMs/serverTotalMs/unattributedMs) when the service reports them", async () => {
    serviceMock.sendConsultationMessage.mockResolvedValue({
      outcome: "succeeded",
      reply: { id: "msg-2", role: "assistant", content: "Got it!", createdAt: "2026-08-14T10:00:00.000Z" },
      needsClarification: false,
      providerLatencyMs: 14831,
      providerAttemptCount: 1,
      preProviderReadsMs: 40,
      replyWriteMs: 55,
      failedFirstAttemptMs: 0,
      serverTotalMs: 14950,
      unattributedMs: 24,
    });

    const response = await invoke("client-1", { message: "hi" });

    const body = await response.json();
    expect(body).toMatchObject({
      preProviderReadsMs: 40,
      replyWriteMs: 55,
      failedFirstAttemptMs: 0,
      serverTotalMs: 14950,
      unattributedMs: 24,
    });
  });

  // Consult AI provider latency variance audit (2026-08-21): surfaces the
  // provider's real token usage and safe context-size metadata, to
  // correlate a real production test's providerLatencyMs variance against
  // real Gemini-supplied numbers rather than guessing.
  it("surfaces token usage and context-size metadata when the service reports them", async () => {
    serviceMock.sendConsultationMessage.mockResolvedValue({
      outcome: "succeeded",
      reply: { id: "msg-2", role: "assistant", content: "Got it!", createdAt: "2026-08-14T10:00:00.000Z" },
      needsClarification: false,
      usage: { inputTokens: 2400, outputTokens: 95, cachedInputTokens: 100, reasoningTokens: 1800, totalTokens: 4395 },
      consultationHistoryMessageCount: 4,
      consultationHistoryChars: 512,
      consultationMemoryChars: 340,
      consultationInputChars: 27,
    });

    const response = await invoke("client-1", { message: "hi" });

    const body = await response.json();
    expect(body).toMatchObject({
      consultationPromptTokens: 2400,
      consultationOutputTokens: 95,
      consultationThinkingTokens: 1800,
      consultationCachedTokens: 100,
      consultationHistoryMessageCount: 4,
      consultationHistoryChars: 512,
      consultationMemoryChars: 340,
      consultationInputChars: 27,
    });
  });

  it("never fabricates token usage fields when the service didn't report usage", async () => {
    serviceMock.sendConsultationMessage.mockResolvedValue({
      outcome: "succeeded",
      reply: { id: "msg-2", role: "assistant", content: "Got it!", createdAt: "2026-08-14T10:00:00.000Z" },
      needsClarification: false,
      consultationHistoryMessageCount: 0,
      consultationHistoryChars: 0,
      consultationMemoryChars: 0,
      consultationInputChars: 2,
    });

    const response = await invoke("client-1", { message: "hi" });

    const body = await response.json();
    expect(body.consultationPromptTokens).toBeUndefined();
    expect(body.consultationOutputTokens).toBeUndefined();
    expect(body.consultationThinkingTokens).toBeUndefined();
    expect(body.consultationCachedTokens).toBeUndefined();
  });

  // Consult AI voice thinking A/B (2026-08-21): lets a real production A/B
  // test tell which thinking mode actually produced a given reply.
  it("surfaces consultationThinkingMode when the service reports one", async () => {
    serviceMock.sendConsultationMessage.mockResolvedValue({
      outcome: "succeeded",
      reply: { id: "msg-2", role: "assistant", content: "Got it!", createdAt: "2026-08-14T10:00:00.000Z" },
      needsClarification: false,
      thinkingMode: "LOW",
    });

    const response = await invoke("client-1", { message: "hi" });

    const body = await response.json();
    expect(body.consultationThinkingMode).toBe("LOW");
  });

  // Consultation reliability hardening (2026-08-19): surfaces the
  // service's own real attempt count (1, or 2 if a transient failure was
  // recovered by its single automatic retry) to the client.
  it("surfaces providerAttemptCount in the response when the service reports one", async () => {
    serviceMock.sendConsultationMessage.mockResolvedValue({
      outcome: "succeeded",
      reply: { id: "msg-2", role: "assistant", content: "Got it!", createdAt: "2026-08-14T10:00:00.000Z" },
      needsClarification: false,
      providerAttemptCount: 2,
    });

    const response = await invoke("client-1", { message: "hi" });

    const body = await response.json();
    expect(body.providerAttemptCount).toBe(2);
  });

  // Consult AI 404/PROVIDER_UNAVAILABLE root-cause diagnosis (2026-08-21):
  // mirrors voice-transcript/route.ts's own providerHttpStatus/
  // providerErrorStatus/providerErrorMessage exactly.
  it("surfaces providerHttpStatus/providerErrorStatus/providerErrorMessage in a failure response when the service reports them", async () => {
    serviceMock.sendConsultationMessage.mockResolvedValue({
      outcome: "failed",
      code: "PROVIDER_UNAVAILABLE",
      providerAttemptCount: 2,
      providerHttpStatus: 503,
      providerErrorStatus: "UNAVAILABLE",
      providerErrorMessage: "The model is overloaded. Please try again later.",
    });

    const response = await invoke("client-1", { message: "hi" });

    const body = await response.json();
    expect(body).toMatchObject({
      error: "PROVIDER_UNAVAILABLE",
      providerHttpStatus: 503,
      providerErrorStatus: "UNAVAILABLE",
      providerErrorMessage: "The model is overloaded. Please try again later.",
    });
  });

  it("never fabricates providerHttpStatus/providerErrorStatus/providerErrorMessage when the service didn't report them", async () => {
    serviceMock.sendConsultationMessage.mockResolvedValue({ outcome: "failed", code: "PROCESSING_DISABLED" });

    const response = await invoke("client-1", { message: "hi" });

    const body = await response.json();
    expect(body.providerHttpStatus).toBeUndefined();
    expect(body.providerErrorStatus).toBeUndefined();
    expect(body.providerErrorMessage).toBeUndefined();
  });

  // End-to-end voice turn correlation (2026-08-19): when the client sends
  // voiceTurnId (the SAME id already used for STT), it's forwarded to the
  // service as-is so every stage's structured logs can be correlated by
  // this one value.
  describe("voiceTurnId correlation", () => {
    it("forwards a valid voiceTurnId to the service", async () => {
      await invoke("client-1", { message: "hi", voiceTurnId: "a1b2c3d4-0000-0000-0000-000000000000" });

      expect(serviceMock.sendConsultationMessage).toHaveBeenCalledWith(
        "owner-1", CLIENT, "hi", undefined, {},
        expect.any(Object),
        "a1b2c3d4-0000-0000-0000-000000000000",
      );
    });

    it("forwards undefined (never invents an id) for a typed message with no voiceTurnId", async () => {
      await invoke("client-1", { message: "hi" });

      expect(serviceMock.sendConsultationMessage).toHaveBeenCalledWith(
        "owner-1", CLIENT, "hi", undefined, {},
        expect.any(Object),
        undefined,
      );
    });

    it("rejects a malformed voiceTurnId (never trusted blindly) -- forwards undefined instead of a raw, unvalidated string", async () => {
      await invoke("client-1", { message: "hi", voiceTurnId: "'; DROP TABLE users; --" });

      expect(serviceMock.sendConsultationMessage).toHaveBeenCalledWith(
        "owner-1", CLIENT, "hi", undefined, {},
        expect.any(Object),
        undefined,
      );
    });
  });

  it("includes proposedCorrection in the response when the reply carries one -- E: the correction is visible to the caller as a proposal, never marked as applied", async () => {
    serviceMock.sendConsultationMessage.mockResolvedValue({
      outcome: "succeeded",
      reply: {
        id: "msg-2",
        role: "assistant",
        content: "Noted.",
        proposedCorrection: { field: "density", value: "low", reason: "Stylist observation.", source: "stylist_confirmed" },
        createdAt: "2026-08-14T10:00:00.000Z",
      },
      needsClarification: false,
    });

    const response = await invoke("client-1", { message: "Her density is low" });

    const body = await response.json();
    expect(body.reply.proposedCorrection).toEqual({ field: "density", value: "low", reason: "Stylist observation.", source: "stylist_confirmed" });
  });

  // Regression: a production report where Consult AI's reply talked about
  // "keeping this as a client memory candidate" but the UI showed no
  // Confirm/Edit/Reject card at all. A full pipeline code audit found every
  // layer (service, repository, this route, the UI) correctly forwards
  // proposedMemory when present -- but this exact route had never actually
  // been asserted to include it in the wire response, so a real regression
  // here could have slipped through unnoticed. Locks in the wire format.
  it("includes proposedMemory in the response when the reply carries one -- never marked as confirmed", async () => {
    serviceMock.sendConsultationMessage.mockResolvedValue({
      outcome: "succeeded",
      reply: {
        id: "msg-2",
        role: "assistant",
        content: "I'd like to note this for her file -- take a look below and confirm, edit, or skip it.",
        proposedMemory: {
          action: "save_client_memory",
          content: "Low density in the temporal areas; preserve more weight around the perimeter.",
          reason: "Stylist confirmed chair-side.",
        },
        createdAt: "2026-08-14T10:00:00.000Z",
      },
      needsClarification: false,
    });

    const response = await invoke("client-1", { message: "Remember this as a professional observation." });

    const body = await response.json();
    expect(body.reply.proposedMemory).toEqual({
      action: "save_client_memory",
      content: "Low density in the temporal areas; preserve more weight around the perimeter.",
      reason: "Stylist confirmed chair-side.",
    });
  });

  it("includes replyLanguage in the response when the service computed one", async () => {
    serviceMock.sendConsultationMessage.mockResolvedValue({
      outcome: "succeeded",
      reply: { id: "msg-2", role: "assistant", content: "Bună ziua.", proposedCorrection: null, createdAt: "2026-08-14T10:00:00.000Z" },
      needsClarification: false,
      replyLanguage: "ro",
    });

    const response = await invoke("client-1", { message: "hi" });

    const body = await response.json();
    expect(body.reply.replyLanguage).toBe("ro");
  });

  it("omits replyLanguage from the response entirely when the service could not determine one -- absent, not null", async () => {
    serviceMock.sendConsultationMessage.mockResolvedValue({
      outcome: "succeeded",
      reply: { id: "msg-2", role: "assistant", content: "42", proposedCorrection: null, createdAt: "2026-08-14T10:00:00.000Z" },
      needsClarification: false,
      replyLanguage: null,
    });

    const response = await invoke("client-1", { message: "hi" });

    const body = await response.json();
    expect(body.reply).not.toHaveProperty("replyLanguage");
  });

  it("omits proposedMemory from the response entirely when the reply carries none -- the field is absent, not null or empty", async () => {
    const response = await invoke("client-1", { message: "hi" });

    const body = await response.json();
    expect(body.reply).not.toHaveProperty("proposedMemory");
  });
});

describe("GET /api/v1/clients/[id]/chat (history)", () => {
  it("returns 401 without a cookie", async () => {
    authMock.authenticateSessionRequest.mockResolvedValue(null);

    const response = await invokeGet("client-1");

    expect(response.status).toBe(401);
    expect(messageRepoMock.listRecentConsultationMessages).not.toHaveBeenCalled();
  });

  it("returns 404 for a foreign/nonexistent client -- P: cross-owner isolation", async () => {
    clientRepoMock.resolveOwnedClient.mockResolvedValue(null);

    const response = await invokeGet("foreign-client");

    expect(response.status).toBe(404);
    expect(messageRepoMock.listRecentConsultationMessages).not.toHaveBeenCalled();
  });

  it("F: client memory survives -- returns persisted history for the owned client", async () => {
    messageRepoMock.listRecentConsultationMessages.mockResolvedValue([
      { id: "msg-1", role: "stylist", content: "Hi", proposedCorrection: null, createdAt: "2026-08-14T09:00:00.000Z" },
      { id: "msg-2", role: "assistant", content: "Hello!", proposedCorrection: null, createdAt: "2026-08-14T09:01:00.000Z" },
    ]);

    const response = await invokeGet("client-1");

    expect(response.status).toBe(200);
    expect(messageRepoMock.listRecentConsultationMessages).toHaveBeenCalledWith("owner-1", "client-1", 30);
    const body = await response.json();
    expect(body.messages).toHaveLength(2);
  });

  it("includes proposedMemory in a reloaded conversation's history -- the card must still appear after a page refresh, not just in the live response", async () => {
    messageRepoMock.listRecentConsultationMessages.mockResolvedValue([
      { id: "msg-1", role: "stylist", content: "Remember this observation.", proposedCorrection: null, proposedMemory: null, createdAt: "2026-08-14T09:00:00.000Z" },
      {
        id: "msg-2",
        role: "assistant",
        content: "I'd like to note this for her file -- confirm below.",
        proposedCorrection: null,
        proposedMemory: { action: "save_client_memory", content: "Low density in the temporal areas.", reason: "Stylist confirmed chair-side." },
        createdAt: "2026-08-14T09:01:00.000Z",
      },
    ]);

    const response = await invokeGet("client-1");

    const body = await response.json();
    expect(body.messages[1].proposedMemory).toEqual({
      action: "save_client_memory",
      content: "Low density in the temporal areas.",
      reason: "Stylist confirmed chair-side.",
    });
  });

  // Regression: reopening Consult AI (or reloading the page) showed active
  // Confirm/Edit/Reject buttons again on cards the stylist had already
  // decided on, because the wire response never carried the real, persisted
  // decision -- only proposedMemory itself. Locks in that the decision
  // reaches the browser too, not just the proposal.
  it("includes proposedMemoryDecision in history when the proposal was already confirmed or rejected", async () => {
    messageRepoMock.listRecentConsultationMessages.mockResolvedValue([
      {
        id: "msg-confirmed", role: "assistant", content: "Noted.", proposedCorrection: null,
        proposedMemory: { action: "save_client_memory", content: "x", reason: "y" }, proposedMemoryDecision: "confirmed",
        createdAt: "2026-08-14T09:00:00.000Z",
      },
      {
        id: "msg-rejected", role: "assistant", content: "Noted.", proposedCorrection: null,
        proposedMemory: { action: "save_client_memory", content: "x", reason: "y" }, proposedMemoryDecision: "rejected",
        createdAt: "2026-08-14T09:01:00.000Z",
      },
    ]);

    const response = await invokeGet("client-1");
    const body = await response.json();

    expect(body.messages[0].proposedMemoryDecision).toBe("confirmed");
    expect(body.messages[1].proposedMemoryDecision).toBe("rejected");
  });

  it("omits proposedMemoryDecision entirely for a still-pending proposal -- absent, not null", async () => {
    messageRepoMock.listRecentConsultationMessages.mockResolvedValue([
      {
        id: "msg-pending", role: "assistant", content: "Noted.", proposedCorrection: null,
        proposedMemory: { action: "save_client_memory", content: "x", reason: "y" }, proposedMemoryDecision: null,
        createdAt: "2026-08-14T09:00:00.000Z",
      },
    ]);

    const response = await invokeGet("client-1");
    const body = await response.json();

    expect(body.messages[0]).not.toHaveProperty("proposedMemoryDecision");
  });
});
