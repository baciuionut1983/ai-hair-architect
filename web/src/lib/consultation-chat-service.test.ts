import { beforeEach, describe, expect, it, vi } from "vitest";

const analysisRepoMock = vi.hoisted(() => ({
  findAnalysisForOwner: vi.fn(),
  findLatestAnalysisForClient: vi.fn().mockResolvedValue(null),
  // Real, unmocked value -- consultation-chat-provider-gemini.ts (imported
  // transitively through the chat service) reads this at module-load time
  // to build its response schema's enum, so it must survive this mock.
  CORRECTABLE_ANALYSIS_FIELDS: [
    "hairType", "density", "porosity", "faceShape", "headShape", "hairLength",
    "hairTexture", "hairCondition", "growthPattern", "targetShape",
    "desiredColorResult", "grayPercentage", "scalpCondition", "treatmentGoalDetail",
  ],
}));
const messageRepoMock = vi.hoisted(() => ({
  listRecentConsultationMessages: vi.fn(),
  recordConsultationMessage: vi.fn(),
}));
const memoryRepoMock = vi.hoisted(() => ({
  retrieveRelevantMemories: vi.fn().mockResolvedValue([]),
  // Real, unmocked values -- consultation-chat-provider-gemini.ts (imported
  // transitively through the chat service) reads these at module-load time
  // to build its proposedMemory schema enum, so they must survive this mock.
  MEMORY_PROPOSAL_ACTION_KEYS: ["save_client_memory", "save_professional_rule", "mark_preference", "save_outcome"],
  isMemoryProposalAction: (value: string) =>
    ["save_client_memory", "save_professional_rule", "mark_preference", "save_outcome"].includes(value),
}));
const clientContextMock = vi.hoisted(() => ({ buildClientProfessionalMemory: vi.fn().mockResolvedValue({ recentCorrections: [], recentConsultations: [], recentFormulas: [], recentTreatments: [] }) }));
// AI Usage & Cost Metering Phase 1: this service now also records usage
// after every provider call -- mocked here like every other repository
// this file depends on, so existing/new tests never need a real database
// connection just to exercise sendConsultationMessage's own logic.
const usageRepoMock = vi.hoisted(() => ({ recordAiUsageEvent: vi.fn().mockResolvedValue(undefined) }));

vi.mock("@/lib/analysis-repository", () => analysisRepoMock);
vi.mock("@/lib/consultation-message-repository", () => messageRepoMock);
vi.mock("@/lib/professional-memory-repository", () => memoryRepoMock);
vi.mock("@/lib/consultation-client-context", () => clientContextMock);
vi.mock("@/lib/ai-usage-repository", () => usageRepoMock);

import { sendConsultationMessage } from "./consultation-chat-service";
import type { ConsultationChatProvider } from "./consultation-chat-provider";

const CLIENT_A = { id: "client-a", ownerUserId: "owner-1", fullName: "Jane Doe", email: "", phone: "", notes: "", createdAt: "", updatedAt: "" };
const CLIENT_B = { id: "client-b", ownerUserId: "owner-1", fullName: "Alex Roe", email: "", phone: "", notes: "", createdAt: "", updatedAt: "" };

const GEMINI_ENV = { AI_ANALYSIS_PROVIDER: "gemini", AI_ANALYSIS_API_KEY: "key", AI_ANALYSIS_MODEL: "gemini-3.6-flash" };

function analysisState(overrides: Record<string, unknown> = {}) {
  return {
    id: "analysis-1",
    clientId: "client-a",
    createdByUserId: "owner-1",
    goal: "reshape" as const,
    hairType: "medium" as const,
    density: "medium" as const,
    porosity: "medium" as const,
    phase: "ready" as const,
    clarificationRound: 0,
    confidenceScore: 0.76,
    uncertaintyReasons: [] as string[],
    followUpQuestions: [] as string[],
    recommendations: ["Structural technique: internal layering."],
    safetyNotes: [] as string[],
    clarificationAnswers: [] as string[],
    createdAt: "2026-08-14T00:00:00.000Z",
    updatedAt: "2026-08-14T00:00:00.000Z",
    ...overrides,
  };
}

let messageIdCounter = 0;
function fakeStoredMessage(input: { role: string; content: string; proposedCorrection?: unknown }) {
  messageIdCounter += 1;
  return {
    id: `msg-${messageIdCounter}`,
    role: input.role,
    content: input.content,
    proposedCorrection: input.proposedCorrection ?? null,
    createdAt: "2026-08-14T10:00:00.000Z",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  messageIdCounter = 0;
  // vi.clearAllMocks() only clears call history, not a mock's configured
  // return/reject value -- every mock a test might reconfigure must get an
  // explicit, sane default here, or a later test silently inherits
  // whatever the previous test last set it to.
  analysisRepoMock.findAnalysisForOwner.mockResolvedValue(null);
  analysisRepoMock.findLatestAnalysisForClient.mockResolvedValue(null);
  messageRepoMock.listRecentConsultationMessages.mockResolvedValue([]);
  messageRepoMock.recordConsultationMessage.mockImplementation(async (input: Parameters<typeof fakeStoredMessage>[0]) =>
    fakeStoredMessage(input),
  );
  memoryRepoMock.retrieveRelevantMemories.mockResolvedValue([]);
  clientContextMock.buildClientProfessionalMemory.mockResolvedValue({
    recentCorrections: [],
    recentConsultations: [],
    recentFormulas: [],
    recentTreatments: [],
  });
  usageRepoMock.recordAiUsageEvent.mockResolvedValue(undefined);
});

function stubProvider(respond: (message: string, ctx: unknown, signal: AbortSignal) => Promise<unknown>) {
  return () => ({ name: "stub", modelVersion: "stub-1", respond }) as unknown as ConsultationChatProvider;
}

describe("sendConsultationMessage", () => {
  it("returns PROCESSING_DISABLED and touches nothing else when no provider is configured", async () => {
    const result = await sendConsultationMessage("owner-1", CLIENT_A, "hi", undefined, { env: {} });

    expect(result).toEqual({ outcome: "failed", code: "PROCESSING_DISABLED" });
    expect(messageRepoMock.recordConsultationMessage).not.toHaveBeenCalled();
  });

  // Observability regression: PROCESSING_DISABLED and
  // PROVIDER_CONFIGURATION_INVALID both map to the same 503 a stylist sees
  // as "not available right now" -- but until now, neither branch emitted
  // a structured log line at all, so a production 503 caused by a
  // config problem (as opposed to a real Gemini-side failure) would leave
  // zero trace in Railway logs. Both now log via the same
  // gate:"CONSULTATION_CHAT" convention as every other failure stage.
  it("logs a structured, safe-fields diagnostic for PROCESSING_DISABLED (no provider configured)", async () => {
    const logSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await sendConsultationMessage("owner-1", CLIENT_A, "hi", undefined, { env: {} });

    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('"gate":"CONSULTATION_CHAT"'),
    );
    const logged = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(logged).toMatchObject({ stage: "config_check", resultCode: "PROCESSING_DISABLED", ownerUserId: "owner-1", clientId: "client-a" });
    logSpy.mockRestore();
  });

  it("logs the specific (non-secret) config issue codes for PROVIDER_CONFIGURATION_INVALID (e.g. provider set but no API key)", async () => {
    const logSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await sendConsultationMessage("owner-1", CLIENT_A, "hi", undefined, {
      env: { AI_ANALYSIS_PROVIDER: "gemini" }, // model/API key deliberately missing
    });

    expect(result).toEqual({ outcome: "failed", code: "PROVIDER_CONFIGURATION_INVALID" });
    const logged = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(logged.stage).toBe("config_check");
    expect(logged.resultCode).toBe("PROVIDER_CONFIGURATION_INVALID");
    expect(logged.configIssueCodes).toContain("AI_ANALYSIS_API_KEY_REQUIRED");
    expect(logged.configIssueCodes).toContain("AI_ANALYSIS_MODEL_REQUIRED");
    // Never the key/model value itself, only fixed issue codes.
    expect(JSON.stringify(logged)).not.toContain("key");
    logSpy.mockRestore();
  });

  it("returns ANALYSIS_NOT_FOUND when an analysisId is given but does not belong to this owner/client", async () => {
    analysisRepoMock.findAnalysisForOwner.mockResolvedValue(null);

    const result = await sendConsultationMessage("owner-1", CLIENT_A, "hi", "foreign-analysis", { env: GEMINI_ENV });

    expect(result).toEqual({ outcome: "failed", code: "ANALYSIS_NOT_FOUND" });
    expect(messageRepoMock.recordConsultationMessage).not.toHaveBeenCalled();
  });

  // Voice latency audit (2026-08-18): the analysis lookup and the prior-
  // messages read now start concurrently (see the service's own comment)
  // rather than fully serially -- these two tests prove that change never
  // altered the two behaviors it would be easiest to accidentally break:
  // (1) the read that's still in flight when the OTHER one fails/rejects
  // validation is simply discarded, with no unhandled-rejection crash, and
  // (2) the stylist's message is still NEVER persisted for a request that
  // gets rejected as ANALYSIS_NOT_FOUND, even though the history read was
  // already kicked off (and may have already resolved) by that point.
  it("still never persists the stylist message for ANALYSIS_NOT_FOUND, even though the (now-concurrent) history read already resolved successfully", async () => {
    analysisRepoMock.findAnalysisForOwner.mockResolvedValue(null);
    messageRepoMock.listRecentConsultationMessages.mockResolvedValue([
      { id: "m-1", role: "stylist", content: "earlier note", createdAt: "2026-08-14T00:00:00.000Z" },
    ]);

    const result = await sendConsultationMessage("owner-1", CLIENT_A, "hi", "foreign-analysis", { env: GEMINI_ENV });

    expect(result).toEqual({ outcome: "failed", code: "ANALYSIS_NOT_FOUND" });
    expect(messageRepoMock.recordConsultationMessage).not.toHaveBeenCalled();
  });

  it("both the analysis lookup and the history read are started (concurrently) even though only the analysis failure is ever reported -- the discarded history-read rejection never crashes the request", async () => {
    analysisRepoMock.findAnalysisForOwner.mockRejectedValue(new Error("analysis db down"));
    messageRepoMock.listRecentConsultationMessages.mockRejectedValue(new Error("history db down too"));

    const result = await sendConsultationMessage("owner-1", CLIENT_A, "hi", "analysis-1", { env: GEMINI_ENV });

    expect(result).toEqual({ outcome: "failed", code: "PERSISTENCE_FAILURE" });
    expect(messageRepoMock.listRecentConsultationMessages).toHaveBeenCalledWith("owner-1", "client-a", 10);
    expect(messageRepoMock.recordConsultationMessage).not.toHaveBeenCalled();
  });

  // Regression: a failed history read used to escape the two explicit
  // PERSISTENCE_FAILURE try/catch blocks entirely and fall through to the
  // outer catch-all, misclassifying a database problem as
  // INTERNAL_PROCESSING_FAILURE (a generic, less actionable code) instead of
  // the same PERSISTENCE_FAILURE every other database call in this function
  // already reports. Found while investigating a production report of chat
  // being unavailable -- not confirmed as that report's root cause, but a
  // real, independent correctness gap in this function regardless.
  it("classifies a failed history read as PERSISTENCE_FAILURE, not the generic INTERNAL_PROCESSING_FAILURE -- and never proceeds to persist or call the provider", async () => {
    messageRepoMock.listRecentConsultationMessages.mockRejectedValue(new Error("db down"));
    const provider = stubProvider(async () => ({ reply: "ok", needsClarification: false }));

    const result = await sendConsultationMessage("owner-1", CLIENT_A, "hi", undefined, { env: GEMINI_ENV, createProvider: provider });

    expect(result).toEqual({ outcome: "failed", code: "PERSISTENCE_FAILURE" });
    expect(messageRepoMock.recordConsultationMessage).not.toHaveBeenCalled();
  });

  it("persists the stylist's message even before calling the provider (never lost on a later failure)", async () => {
    const rejecting = stubProvider(async () => {
      throw Object.assign(new Error("boom"), { code: "PROVIDER_ERROR", retryable: true });
    });

    await sendConsultationMessage("owner-1", CLIENT_A, "Her density is low", undefined, {
      env: GEMINI_ENV,
      createProvider: rejecting,
    });

    expect(messageRepoMock.recordConsultationMessage).toHaveBeenCalledWith(
      expect.objectContaining({ role: "stylist", content: "Her density is low", ownerUserId: "owner-1", clientId: "client-a" }),
    );
  });

  it("A: reads the correct CURRENT client context -- the analysis passed to the provider matches the requested analysisId, including confidenceScore and merged missingData from whichever plans exist", async () => {
    analysisRepoMock.findAnalysisForOwner.mockResolvedValue(analysisState({
      technicalCutPlan: { missingData: ["headShape"] },
      colorPlan: { missingData: ["desiredColorResult"] },
    }));
    let capturedContext: unknown;
    const provider = stubProvider(async (_msg, ctx) => {
      capturedContext = ctx;
      return { reply: "ok", needsClarification: false };
    });

    await sendConsultationMessage("owner-1", CLIENT_A, "hi", "analysis-1", { env: GEMINI_ENV, createProvider: provider });

    expect(analysisRepoMock.findAnalysisForOwner).toHaveBeenCalledWith("owner-1", "analysis-1");
    expect(capturedContext).toMatchObject({
      clientFullName: "Jane Doe",
      currentAnalysis: expect.objectContaining({
        confidenceScore: 0.76,
        missingData: expect.arrayContaining(["headShape", "desiredColorResult"]),
      }),
    });
  });

  it("B: conversation history is scoped strictly per client -- Client B's history is never fetched or leaked into Client A's context", async () => {
    const provider = stubProvider(async () => ({ reply: "ok", needsClarification: false }));

    await sendConsultationMessage("owner-1", CLIENT_A, "hi", undefined, { env: GEMINI_ENV, createProvider: provider });
    expect(messageRepoMock.listRecentConsultationMessages).toHaveBeenCalledWith("owner-1", "client-a", 10);

    vi.clearAllMocks();
    messageRepoMock.listRecentConsultationMessages.mockResolvedValue([]);
    messageRepoMock.recordConsultationMessage.mockImplementation(async (input: Parameters<typeof fakeStoredMessage>[0]) =>
      fakeStoredMessage(input),
    );
    await sendConsultationMessage("owner-1", CLIENT_B, "hi", undefined, { env: GEMINI_ENV, createProvider: provider });
    expect(messageRepoMock.listRecentConsultationMessages).toHaveBeenCalledWith("owner-1", "client-b", 10);
    expect(messageRepoMock.listRecentConsultationMessages).not.toHaveBeenCalledWith("owner-1", "client-a", expect.anything());
  });

  it("E/proposal: a provider-proposed correction is persisted alongside the reply, never applied -- this function never calls any correction-apply logic", async () => {
    const provider = stubProvider(async () => ({
      reply: "Got it, I'll note that.",
      needsClarification: false,
      proposedCorrection: { field: "density", value: "low", reason: "Stylist observed it chair-side.", source: "stylist_confirmed" },
    }));

    const result = await sendConsultationMessage("owner-1", CLIENT_A, "Her density is actually low", undefined, {
      env: GEMINI_ENV,
      createProvider: provider,
    });

    expect(result.outcome).toBe("succeeded");
    expect(messageRepoMock.recordConsultationMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        role: "assistant",
        proposedCorrection: { field: "density", value: "low", reason: "Stylist observed it chair-side.", source: "stylist_confirmed" },
      }),
    );
  });

  // The exact scenario from the production report: a "remember this, but
  // don't change the analysis" message. A provider-proposed memory
  // candidate is persisted alongside the reply, exactly like a proposed
  // correction -- never auto-created. sendConsultationMessage does not even
  // import createConfirmedMemory (only retrieveRelevantMemories), so there
  // is no code path here through which a memory could ever be created
  // without the separate, explicit POST /api/v1/clients/{id}/memories call.
  it("a provider-proposed memory candidate is persisted alongside the reply, never auto-created", async () => {
    const provider = stubProvider(async () => ({
      reply: "Got it -- I'll note that as a professional observation, without changing the analysis.",
      needsClarification: false,
      proposedMemory: {
        action: "save_client_memory",
        content: "Low density in the temporal areas; preserve more weight around the perimeter.",
        reason: "Stylist confirmed chair-side and asked it to be remembered without changing the analysis.",
      },
    }));

    const result = await sendConsultationMessage(
      "owner-1",
      CLIENT_A,
      "For this client, I have confirmed chair-side that the hair has low density in the temporal areas and I want to preserve more weight around the perimeter. Remember this as a professional observation for this client, but do not change the analysis automatically.",
      undefined,
      { env: GEMINI_ENV, createProvider: provider },
    );

    expect(result.outcome).toBe("succeeded");
    expect(messageRepoMock.recordConsultationMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        role: "assistant",
        proposedMemory: {
          action: "save_client_memory",
          content: "Low density in the temporal areas; preserve more weight around the perimeter.",
          reason: "Stylist confirmed chair-side and asked it to be remembered without changing the analysis.",
        },
      }),
    );
  });

  // Observability regression: the production report where the reply talked
  // about "keeping this as a client memory candidate" but no card appeared
  // in the UI. This proves that whenever the provider actually returns a
  // proposal, the success log says so -- so the next time this happens, the
  // Railway log line alone answers "did Gemini even include one" without
  // needing database access.
  it("logs hadProposedMemory: true only when the provider actually included one, and false when it did not", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const withMemory = stubProvider(async () => ({
      reply: "I'd like to save this as a note for her file -- confirm below.",
      needsClarification: false,
      proposedMemory: { action: "save_client_memory", content: "x", reason: "x" },
    }));
    await sendConsultationMessage("owner-1", CLIENT_A, "Remember this.", undefined, { env: GEMINI_ENV, createProvider: withMemory });
    const loggedWithMemory = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(loggedWithMemory).toMatchObject({ status: "SUCCEEDED", hadProposedMemory: true, hadProposedCorrection: false });

    logSpy.mockClear();
    const withoutMemory = stubProvider(async () => ({
      reply: "Sure, tell me more about her hair.",
      needsClarification: false,
    }));
    await sendConsultationMessage("owner-1", CLIENT_A, "hi", undefined, { env: GEMINI_ENV, createProvider: withoutMemory });
    const loggedWithoutMemory = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(loggedWithoutMemory).toMatchObject({ status: "SUCCEEDED", hadProposedMemory: false });

    logSpy.mockRestore();
  });

  it("H: fails closed (no fabricated reply) when the real provider call fails, classifying TIMEOUT/RATE_LIMITED/etc. correctly", async () => {
    const timeoutProvider = stubProvider(async () => {
      throw Object.assign(new Error("timed out"), { code: "TIMEOUT", retryable: true });
    });

    const result = await sendConsultationMessage("owner-1", CLIENT_A, "hi", undefined, { env: GEMINI_ENV, createProvider: timeoutProvider });

    // Consultation reliability hardening: TIMEOUT is retryable, so this
    // stub (which always throws) is called twice -- attemptCount 2 proves
    // the retry actually happened, not just that the final code is right.
    expect(result).toEqual({ outcome: "failed", code: "PROVIDER_TIMEOUT", providerAttemptCount: 2 });
    // The assistant's reply is never recorded on failure -- only the
    // stylist's own message (recorded before the provider call) exists,
    // and only ONCE, regardless of how many provider attempts followed.
    expect(messageRepoMock.recordConsultationMessage).toHaveBeenCalledTimes(1);
    expect(messageRepoMock.recordConsultationMessage).toHaveBeenCalledWith(expect.objectContaining({ role: "stylist" }));
  });

  // AI Usage & Cost Metering Phase 1: this function now also records
  // usage after every real provider call -- success and failure alike.
  it("AI usage: records a SUCCEEDED usage event with the provider's real usage/providerRequestId after a successful reply", async () => {
    analysisRepoMock.findAnalysisForOwner.mockResolvedValue(analysisState());
    const provider = stubProvider(async () => ({
      reply: "Sure!",
      needsClarification: false,
      usage: { inputTokens: 120, outputTokens: 30 },
      providerRequestId: "resp-abc",
    }));

    await sendConsultationMessage("owner-1", CLIENT_A, "hi", "analysis-1", { env: GEMINI_ENV, createProvider: provider });

    expect(usageRepoMock.recordAiUsageEvent).toHaveBeenCalledTimes(1);
    expect(usageRepoMock.recordAiUsageEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerUserId: "owner-1",
        clientId: CLIENT_A.id,
        analysisId: "analysis-1",
        feature: "consultation_chat",
        modality: "TEXT_GENERATION",
        provider: "stub",
        model: "stub-1",
        providerRequestId: "resp-abc",
        usage: { inputTokens: 120, outputTokens: 30 },
        outcome: "SUCCEEDED",
      }),
    );
  });

  it("AI usage: records a FAILED usage event (with the classified error category) when the provider call throws, still without breaking the caller's own failure response", async () => {
    const timeoutProvider = stubProvider(async () => {
      throw Object.assign(new Error("timed out"), { code: "TIMEOUT", retryable: true });
    });

    const result = await sendConsultationMessage("owner-1", CLIENT_A, "hi", undefined, { env: GEMINI_ENV, createProvider: timeoutProvider });

    expect(result).toEqual({ outcome: "failed", code: "PROVIDER_TIMEOUT", providerAttemptCount: 2 });
    expect(usageRepoMock.recordAiUsageEvent).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "FAILED", errorCategory: "TIMEOUT", feature: "consultation_chat" }),
    );
  });

  it("AI usage: a metering failure never turns a successful reply into a user-visible failure", async () => {
    usageRepoMock.recordAiUsageEvent.mockRejectedValueOnce(new Error("this should never surface"));
    const provider = stubProvider(async () => ({ reply: "Sure!", needsClarification: false }));

    const result = await sendConsultationMessage("owner-1", CLIENT_A, "hi", undefined, { env: GEMINI_ENV, createProvider: provider });

    expect(result.outcome).toBe("succeeded");
  });

  // The provider-level fail-closed consistency check (reply promises a
  // memory proposal that proposedMemory doesn't back) throws INVALID_FORMAT
  // -- this had never been asserted all the way through the service before,
  // even though the classification logic itself predates this task.
  it("classifies an INVALID_FORMAT provider error (e.g. the reply/proposedMemory consistency check) as MALFORMED_PROVIDER_RESPONSE, never fabricating a reply", async () => {
    const inconsistentProvider = stubProvider(async () => {
      throw Object.assign(new Error("reply referenced a proposal it did not include"), { code: "INVALID_FORMAT", retryable: false });
    });

    const result = await sendConsultationMessage("owner-1", CLIENT_A, "Remember this.", undefined, { env: GEMINI_ENV, createProvider: inconsistentProvider });

    // retryable:false -- never retried, so exactly one attempt.
    expect(result).toEqual({ outcome: "failed", code: "MALFORMED_PROVIDER_RESPONSE", providerAttemptCount: 1 });
    expect(messageRepoMock.recordConsultationMessage).toHaveBeenCalledTimes(1);
    expect(messageRepoMock.recordConsultationMessage).toHaveBeenCalledWith(expect.objectContaining({ role: "stylist" }));
  });

  // Consultation reliability hardening (2026-08-19): a real production
  // intermittent "The AI consultation assistant is not available right
  // now" traced to provider.respond() never being retried at all. These
  // tests prove the fix mirrors STT's own single-retry policy exactly.
  describe("consultation provider retry (transient-failure recovery)", () => {
    it("recovers a transient provider failure via the single automatic retry -- the second, successful attempt wins", async () => {
      let calls = 0;
      const provider = stubProvider(async () => {
        calls += 1;
        if (calls === 1) {
          throw Object.assign(new Error("service unavailable"), { code: "PROVIDER_ERROR", retryable: true, status: 503 });
        }
        return { reply: "Here's what I'd recommend.", needsClarification: false };
      });

      const result = await sendConsultationMessage("owner-1", CLIENT_A, "hi", undefined, { env: GEMINI_ENV, createProvider: provider });

      expect(calls).toBe(2);
      expect(result).toMatchObject({ outcome: "succeeded", providerAttemptCount: 2 });
    });

    it("never retries a permanent (non-retryable) failure -- exactly one provider call, never a second identical attempt that could never change the outcome", async () => {
      let calls = 0;
      const provider = stubProvider(async () => {
        calls += 1;
        throw Object.assign(new Error("bad auth"), { code: "NOT_CONFIGURED", retryable: false });
      });

      const result = await sendConsultationMessage("owner-1", CLIENT_A, "hi", undefined, { env: GEMINI_ENV, createProvider: provider });

      expect(calls).toBe(1);
      expect(result).toEqual({ outcome: "failed", code: "PROVIDER_AUTHENTICATION_FAILURE", providerAttemptCount: 1 });
    });

    it("also fails closed if BOTH the first attempt and the retry are transient failures -- two real attempts, still no fabricated reply", async () => {
      let calls = 0;
      const provider = stubProvider(async () => {
        calls += 1;
        throw Object.assign(new Error("timed out"), { code: "TIMEOUT", retryable: true });
      });

      const result = await sendConsultationMessage("owner-1", CLIENT_A, "hi", undefined, { env: GEMINI_ENV, createProvider: provider });

      expect(calls).toBe(2);
      expect(result).toEqual({ outcome: "failed", code: "PROVIDER_TIMEOUT", providerAttemptCount: 2 });
    });

    it("never persists a duplicate stylist message after a consultation retry -- exactly one write, made before either provider attempt", async () => {
      let calls = 0;
      const provider = stubProvider(async () => {
        calls += 1;
        if (calls === 1) throw Object.assign(new Error("timed out"), { code: "TIMEOUT", retryable: true });
        return { reply: "ok", needsClarification: false };
      });

      await sendConsultationMessage("owner-1", CLIENT_A, "hi", undefined, { env: GEMINI_ENV, createProvider: provider });

      const stylistWrites = messageRepoMock.recordConsultationMessage.mock.calls.filter(
        (call: unknown[]) => (call[0] as { role: string }).role === "stylist",
      );
      expect(stylistWrites).toHaveLength(1);
    });

    it("never persists a duplicate assistant reply after a consultation retry -- exactly one write, only after the retry loop resolves", async () => {
      let calls = 0;
      const provider = stubProvider(async () => {
        calls += 1;
        if (calls === 1) throw Object.assign(new Error("timed out"), { code: "TIMEOUT", retryable: true });
        return { reply: "ok", needsClarification: false };
      });

      await sendConsultationMessage("owner-1", CLIENT_A, "hi", undefined, { env: GEMINI_ENV, createProvider: provider });

      const assistantWrites = messageRepoMock.recordConsultationMessage.mock.calls.filter(
        (call: unknown[]) => (call[0] as { role: string }).role === "assistant",
      );
      expect(assistantWrites).toHaveLength(1);
    });

    it("usage metering represents actual provider attempts correctly -- one FAILED row for the first attempt, one SUCCEEDED row for the recovering retry, never merged into one", async () => {
      let calls = 0;
      const provider = stubProvider(async () => {
        calls += 1;
        if (calls === 1) throw Object.assign(new Error("rate limited"), { code: "RATE_LIMITED", retryable: true, status: 429 });
        return { reply: "ok", needsClarification: false };
      });

      await sendConsultationMessage("owner-1", CLIENT_A, "hi", undefined, { env: GEMINI_ENV, createProvider: provider });

      expect(usageRepoMock.recordAiUsageEvent).toHaveBeenCalledTimes(2);
      expect(usageRepoMock.recordAiUsageEvent).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ outcome: "FAILED", attemptNumber: 1, errorCategory: "RATE_LIMITED" }),
      );
      expect(usageRepoMock.recordAiUsageEvent).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ outcome: "SUCCEEDED", attemptNumber: 2 }),
      );
      // Both rows share the SAME correlationId (one logical send attempt,
      // two real provider calls) -- never two unrelated ids.
      const [firstCall, secondCall] = usageRepoMock.recordAiUsageEvent.mock.calls;
      expect(firstCall[0].correlationId).toBe(secondCall[0].correlationId);
    });

    it("CONSULTATION_CHAT_FALLBACK_MODEL, when explicitly configured, is used ONLY for the retry -- never the first attempt", async () => {
      const modelsUsed: string[] = [];
      let calls = 0;
      const createProvider = (config: { apiKey: string; model: string }) => {
        modelsUsed.push(config.model);
        return {
          name: "stub",
          modelVersion: config.model,
          respond: async () => {
            calls += 1;
            if (calls === 1) throw Object.assign(new Error("503"), { code: "PROVIDER_ERROR", retryable: true, status: 503 });
            return { reply: "ok", needsClarification: false };
          },
        } as unknown as ConsultationChatProvider;
      };

      const result = await sendConsultationMessage("owner-1", CLIENT_A, "hi", undefined, {
        env: { ...GEMINI_ENV, CONSULTATION_CHAT_FALLBACK_MODEL: "gemini-3.6-pro" },
        createProvider,
      });

      expect(modelsUsed).toEqual(["gemini-3.6-flash", "gemini-3.6-pro"]);
      expect(result).toMatchObject({ outcome: "succeeded", providerAttemptCount: 2 });
    });

    it("never invents or uses a fallback model when CONSULTATION_CHAT_FALLBACK_MODEL is unset -- the retry reuses the exact same provider/model as the first attempt", async () => {
      const modelsUsed: string[] = [];
      let calls = 0;
      const createProvider = (config: { apiKey: string; model: string }) => {
        modelsUsed.push(config.model);
        return {
          name: "stub",
          modelVersion: config.model,
          respond: async () => {
            calls += 1;
            if (calls === 1) throw Object.assign(new Error("503"), { code: "PROVIDER_ERROR", retryable: true, status: 503 });
            return { reply: "ok", needsClarification: false };
          },
        } as unknown as ConsultationChatProvider;
      };

      await sendConsultationMessage("owner-1", CLIENT_A, "hi", undefined, { env: GEMINI_ENV, createProvider });

      // createProvider is only ever called ONCE (no fallback model
      // configured -- the same provider instance handles the retry), so
      // modelsUsed has exactly one entry despite two respond() calls.
      expect(modelsUsed).toEqual(["gemini-3.6-flash"]);
      expect(calls).toBe(2);
    });
  });

  // End-to-end voice turn correlation (2026-08-19): voiceTurnId is the
  // SAME id already used for STT (use-voice-recording.ts's attemptId),
  // threaded through purely for structured-log correlation -- never part
  // of the AI Usage Metering correlationId (see this function's own
  // parameter doc comment for why).
  describe("voiceTurnId correlation", () => {
    it("includes voiceTurnId in the structured success log when this was a voice-initiated turn", async () => {
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const provider = stubProvider(async () => ({ reply: "ok", needsClarification: false }));

      await sendConsultationMessage("owner-1", CLIENT_A, "hi", undefined, { env: GEMINI_ENV, createProvider: provider }, {}, "voice-turn-abc");

      const logged = JSON.parse(logSpy.mock.calls[logSpy.mock.calls.length - 1][0] as string);
      expect(logged).toMatchObject({ status: "SUCCEEDED", voiceTurnId: "voice-turn-abc" });
      logSpy.mockRestore();
    });

    it("logs voiceTurnId as null (never omitted, never fabricated) for a typed message with no voice turn", async () => {
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const provider = stubProvider(async () => ({ reply: "ok", needsClarification: false }));

      await sendConsultationMessage("owner-1", CLIENT_A, "hi", undefined, { env: GEMINI_ENV, createProvider: provider });

      const logged = JSON.parse(logSpy.mock.calls[logSpy.mock.calls.length - 1][0] as string);
      expect(logged.voiceTurnId).toBeNull();
      logSpy.mockRestore();
    });

    it("includes voiceTurnId in the structured failure log too, on a provider failure", async () => {
      const logSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const provider = stubProvider(async () => {
        throw Object.assign(new Error("bad auth"), { code: "NOT_CONFIGURED", retryable: false });
      });

      await sendConsultationMessage("owner-1", CLIENT_A, "hi", undefined, { env: GEMINI_ENV, createProvider: provider }, {}, "voice-turn-xyz");

      const logged = JSON.parse(logSpy.mock.calls[logSpy.mock.calls.length - 1][0] as string);
      expect(logged).toMatchObject({ status: "FAILED", voiceTurnId: "voice-turn-xyz" });
      logSpy.mockRestore();
    });
  });

  it("succeeds with no currentAnalysis context when no analysisId is given -- conversation can start before any analysis exists", async () => {
    const provider = stubProvider(async (_msg, ctx) => {
      expect(ctx).not.toHaveProperty("currentAnalysis");
      return { reply: "Sure, let's talk about the client first.", needsClarification: false };
    });

    const result = await sendConsultationMessage("owner-1", CLIENT_A, "New client, no photo yet", undefined, {
      env: GEMINI_ENV,
      createProvider: provider,
    });

    expect(result.outcome).toBe("succeeded");
  });

  // 1: this is the exact production bug ("we don't have a baseline analysis
  // loaded") -- Consult AI opened from the client page has no analysisId in
  // hand. The service must auto-resolve the client's own most recent
  // analysis instead of leaving currentAnalysis empty.
  it("1: auto-loads the client's latest analysis when no analysisId is given, and it reaches the provider", async () => {
    analysisRepoMock.findLatestAnalysisForClient.mockResolvedValue(analysisState({
      technicalCutPlan: { cuttingTechnique: "scissor_over_comb", missingData: [] },
    }));
    let capturedContext: unknown;
    const provider = stubProvider(async (_msg, ctx) => {
      capturedContext = ctx;
      return { reply: "ok", needsClarification: false };
    });

    await sendConsultationMessage("owner-1", CLIENT_A, "I disagree with scissor over comb here.", undefined, { env: GEMINI_ENV, createProvider: provider });

    expect(analysisRepoMock.findLatestAnalysisForClient).toHaveBeenCalledWith("owner-1", "client-a");
    expect(analysisRepoMock.findAnalysisForOwner).not.toHaveBeenCalled();
    expect(capturedContext).toMatchObject({
      currentAnalysis: expect.objectContaining({ cuttingTechnique: "scissor_over_comb" }),
    });
  });

  // 2: an explicit analysisId (e.g. the stylist opened Consult AI from a
  // specific past analysis page) must win over "latest" -- the platform
  // must never silently swap in a newer analysis the stylist did not ask
  // to discuss right now.
  it("2: an explicit analysisId still pins to that exact analysis, never falling back to 'latest'", async () => {
    analysisRepoMock.findAnalysisForOwner.mockResolvedValue(analysisState({ id: "analysis-old", clientId: "client-a" }));
    const provider = stubProvider(async () => ({ reply: "ok", needsClarification: false }));

    await sendConsultationMessage("owner-1", CLIENT_A, "hi", "analysis-old", { env: GEMINI_ENV, createProvider: provider });

    expect(analysisRepoMock.findAnalysisForOwner).toHaveBeenCalledWith("owner-1", "analysis-old");
    expect(analysisRepoMock.findLatestAnalysisForClient).not.toHaveBeenCalled();
  });

  // 4: a client with genuinely no analysis on file must be reported
  // honestly (no currentAnalysis section at all), never a fabricated one.
  it("4: a client with no analysis at all gets an honest absence, not an error and not a fabricated analysis", async () => {
    analysisRepoMock.findLatestAnalysisForClient.mockResolvedValue(null);
    const provider = stubProvider(async (_msg, ctx) => {
      expect(ctx).not.toHaveProperty("currentAnalysis");
      return { reply: "We haven't run an analysis for this client yet -- want to start one?", needsClarification: false };
    });

    const result = await sendConsultationMessage("owner-1", CLIENT_A, "What's her hair like?", undefined, { env: GEMINI_ENV, createProvider: provider });

    expect(result.outcome).toBe("succeeded");
  });

  // 5/6/7: confirmed ProfessionalMemory (already scoped/filtered to
  // status="active" by the repository) reaches the provider; this function
  // never re-filters it -- unconfirmed/revoked memories are excluded
  // upstream, at the query, and simply never appear in what this mock
  // returns for that case.
  it("5: confirmed professional memory reaches the provider context, mapped to its prompt shape", async () => {
    memoryRepoMock.retrieveRelevantMemories.mockResolvedValue([
      { id: "m1", scope: "stylist_specific", kind: "professional_rule", content: "Prefer texturizing over scissor-over-comb on fine hair.", confidence: 1, source: "typed", clientId: null, createdAt: "2026-08-01T00:00:00.000Z" },
    ]);
    let capturedContext: unknown;
    const provider = stubProvider(async (_msg, ctx) => {
      capturedContext = ctx;
      return { reply: "ok", needsClarification: false };
    });

    await sendConsultationMessage("owner-1", CLIENT_A, "hi", undefined, { env: GEMINI_ENV, createProvider: provider });

    expect(memoryRepoMock.retrieveRelevantMemories).toHaveBeenCalledWith("owner-1", "client-a", "hi");
    expect(capturedContext).toMatchObject({
      professionalMemory: [
        { scope: "stylist_specific", kind: "professional_rule", content: "Prefer texturizing over scissor-over-comb on fine hair.", source: "typed", confidence: 1 },
      ],
    });
  });

  it("threads a forced language hint into the provider context", async () => {
    let capturedContext: unknown;
    const provider = stubProvider(async (_msg, ctx) => {
      capturedContext = ctx;
      return { reply: "ok", needsClarification: false };
    });

    await sendConsultationMessage("owner-1", CLIENT_A, "hi", undefined, { env: GEMINI_ENV, createProvider: provider }, { forced: "ro" });

    expect(capturedContext).toMatchObject({ forcedReplyLanguage: "ro" });
    expect(capturedContext).not.toHaveProperty("fallbackReplyLanguage");
  });

  it("threads a fallback language hint into the provider context when there is no forced language", async () => {
    let capturedContext: unknown;
    const provider = stubProvider(async (_msg, ctx) => {
      capturedContext = ctx;
      return { reply: "ok", needsClarification: false };
    });

    await sendConsultationMessage("owner-1", CLIENT_A, "hi", undefined, { env: GEMINI_ENV, createProvider: provider }, { fallback: "en" });

    expect(capturedContext).toMatchObject({ fallbackReplyLanguage: "en" });
    expect(capturedContext).not.toHaveProperty("forcedReplyLanguage");
  });

  it("a forced language hint takes priority over a fallback one -- only forcedReplyLanguage reaches the provider", async () => {
    let capturedContext: unknown;
    const provider = stubProvider(async (_msg, ctx) => {
      capturedContext = ctx;
      return { reply: "ok", needsClarification: false };
    });

    await sendConsultationMessage("owner-1", CLIENT_A, "hi", undefined, { env: GEMINI_ENV, createProvider: provider }, { forced: "ro", fallback: "en" });

    expect(capturedContext).toMatchObject({ forcedReplyLanguage: "ro" });
    expect(capturedContext).not.toHaveProperty("fallbackReplyLanguage");
  });

  it("omits both language fields from the provider context when no hint is given at all", async () => {
    let capturedContext: unknown;
    const provider = stubProvider(async (_msg, ctx) => {
      capturedContext = ctx;
      return { reply: "ok", needsClarification: false };
    });

    await sendConsultationMessage("owner-1", CLIENT_A, "hi", undefined, { env: GEMINI_ENV, createProvider: provider });

    expect(capturedContext).not.toHaveProperty("forcedReplyLanguage");
    expect(capturedContext).not.toHaveProperty("fallbackReplyLanguage");
  });

  // Voice latency optimization (2026-08-20): a real production measurement
  // showed a ~26-second spoken reply contributing directly to slow
  // Consult AI generation AND slow TTS synthesis/transfer/decode
  // downstream -- preferConciseReply nudges the model toward a reply
  // length appropriate for being read aloud, ONLY for voice-initiated
  // turns, never for typed chat.
  describe("preferConciseReply (voice reply length optimization)", () => {
    it("sets preferConciseReply when this call originated from a voice-initiated turn (voiceTurnId present)", async () => {
      let capturedContext: unknown;
      const provider = stubProvider(async (_msg, ctx) => {
        capturedContext = ctx;
        return { reply: "ok", needsClarification: false };
      });

      await sendConsultationMessage("owner-1", CLIENT_A, "hi", undefined, { env: GEMINI_ENV, createProvider: provider }, {}, "voice-turn-abc");

      expect(capturedContext).toMatchObject({ preferConciseReply: true });
    });

    it("never sets preferConciseReply for a typed message (no voiceTurnId) -- typed-chat replies are completely unaffected", async () => {
      let capturedContext: unknown;
      const provider = stubProvider(async (_msg, ctx) => {
        capturedContext = ctx;
        return { reply: "ok", needsClarification: false };
      });

      await sendConsultationMessage("owner-1", CLIENT_A, "hi", undefined, { env: GEMINI_ENV, createProvider: provider });

      expect(capturedContext).not.toHaveProperty("preferConciseReply");
    });
  });

  // replyLanguage is the ONE canonical language decision for a reply,
  // computed once here and consumed by both the wire response and (via
  // ConsultationMessageRecord.replyLanguage) the frontend's TTS locale --
  // never re-detected a second, independent time. Same priority chain as
  // buildPrompt's own SYSTEM_INSTRUCTION rule 10: forced override always
  // wins, regardless of what the reply text itself says.
  it("replyLanguage: a forced language hint always wins, even if the reply text detects as a different language", async () => {
    const provider = stubProvider(async () => ({ reply: "This is clearly English text.", needsClarification: false }));

    const result = await sendConsultationMessage("owner-1", CLIENT_A, "hi", undefined, { env: GEMINI_ENV, createProvider: provider }, { forced: "ro" });

    expect(result.outcome).toBe("succeeded");
    if (result.outcome === "succeeded") {
      expect(result.replyLanguage).toBe("ro");
    }
  });

  it("replyLanguage: with no forced hint, detects the language the reply actually came back in", async () => {
    const provider = stubProvider(async () => ({ reply: "Clienta vrea sa pastreze parul lung.", needsClarification: false }));

    const result = await sendConsultationMessage("owner-1", CLIENT_A, "hi", undefined, { env: GEMINI_ENV, createProvider: provider }, { fallback: "en" });

    expect(result.outcome).toBe("succeeded");
    if (result.outcome === "succeeded") {
      expect(result.replyLanguage).toBe("ro");
    }
  });

  it("replyLanguage: falls back to the soft fallback hint only when the reply text itself is genuinely ambiguous", async () => {
    const provider = stubProvider(async () => ({ reply: "42", needsClarification: false }));

    const result = await sendConsultationMessage("owner-1", CLIENT_A, "hi", undefined, { env: GEMINI_ENV, createProvider: provider }, { fallback: "ro" });

    expect(result.outcome).toBe("succeeded");
    if (result.outcome === "succeeded") {
      expect(result.replyLanguage).toBe("ro");
    }
  });

  it("replyLanguage: null when nothing -- forced, detected, or fallback -- is available", async () => {
    const provider = stubProvider(async () => ({ reply: "42", needsClarification: false }));

    const result = await sendConsultationMessage("owner-1", CLIENT_A, "hi", undefined, { env: GEMINI_ENV, createProvider: provider });

    expect(result.outcome).toBe("succeeded");
    if (result.outcome === "succeeded") {
      expect(result.replyLanguage).toBeNull();
    }
  });

  // Voice latency audit (2026-08-18): a real, measured duration of just
  // the provider.respond() call -- reused from AI Usage Metering's own
  // latencyMs computation, never a second, separate (or fabricated) value.
  //
  // CI reliability follow-up (2026-08-20, Round 11): this used a real
  // setTimeout(20) racing a >=20 assertion -- the same tight-threshold
  // real-timer pattern that already flaked once this session
  // (failedFirstAttemptMs, fixed in c9208e2). A real CI run measured 19ms.
  // Switched to fake timers, same fix, same reasoning: Date.now() advances
  // in lockstep with vi.advanceTimersByTimeAsync, so this is now
  // deterministic every run instead of a real-clock race.
  it("providerLatencyMs reflects the real, measured duration of the provider call, not the whole request", async () => {
    vi.useFakeTimers();
    try {
      const provider = stubProvider(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        return { reply: "ok", needsClarification: false };
      });

      const pending = sendConsultationMessage("owner-1", CLIENT_A, "hi", undefined, { env: GEMINI_ENV, createProvider: provider });
      await vi.advanceTimersByTimeAsync(20);
      const result = await pending;

      expect(result.outcome).toBe("succeeded");
      if (result.outcome === "succeeded") {
        expect(result.providerLatencyMs).toBeGreaterThanOrEqual(20);
        // An upper bound loose enough to never flake under normal CI load,
        // but tight enough to prove this measures the provider call itself,
        // not some much larger unrelated duration.
        expect(result.providerLatencyMs).toBeLessThan(2000);
      }
    } finally {
      vi.useRealTimers();
    }
  });

  // Consultation instrumentation fix (2026-08-19): a real production
  // report showed CONSULTATION_CHAT taking 15-30s total while providerAttemptCount
  // was 1 (no retry) -- the root cause was providerLatencyMs itself being
  // measured at the function's own return statement, AFTER the assistant
  // reply's DB write had already run, silently folding that write's time
  // into a field whose name promises pure provider latency. These tests
  // prove the fix directly: a SLOW provider call and a SLOW reply write
  // are cleanly separated, never conflated.
  describe("consultation instrumentation: providerLatencyMs excludes the reply DB write", () => {
    // CI reliability follow-up (2026-08-20, Round 11): all four tests below
    // switched to fake timers for the same reason as the providerLatencyMs
    // test above -- real setTimeout + a tight >= threshold is a proven,
    // repeat source of CI flakiness on this exact file this session.
    it("providerLatencyMs stays small even when the assistant reply's DB write is slow -- the exact bug a real production report traced", async () => {
      vi.useFakeTimers();
      try {
        const provider = stubProvider(async () => ({ reply: "ok", needsClarification: false }));
        // Delay ONLY the assistant reply write (not the stylist message
        // write) -- simulating exactly the class of DB-write latency that
        // used to be silently folded into providerLatencyMs.
        messageRepoMock.recordConsultationMessage.mockImplementation(async (input: Parameters<typeof fakeStoredMessage>[0]) => {
          if (input.role === "assistant") {
            await new Promise((resolve) => setTimeout(resolve, 120));
          }
          return fakeStoredMessage(input);
        });

        const pending = sendConsultationMessage("owner-1", CLIENT_A, "hi", undefined, { env: GEMINI_ENV, createProvider: provider });
        await vi.advanceTimersByTimeAsync(120);
        const result = await pending;

        expect(result.outcome).toBe("succeeded");
        if (result.outcome === "succeeded") {
          // The reply write took >=120ms, but providerLatencyMs must stay
          // tiny -- proving it measures ONLY provider.respond(), never any
          // work that happens after it resolves.
          expect(result.providerLatencyMs).toBeLessThan(80);
        }
      } finally {
        vi.useRealTimers();
      }
    });

    it("providerLatencyMs stays small even when the STYLIST message write (before the provider call) is slow", async () => {
      vi.useFakeTimers();
      try {
        const provider = stubProvider(async () => ({ reply: "ok", needsClarification: false }));
        messageRepoMock.recordConsultationMessage.mockImplementation(async (input: Parameters<typeof fakeStoredMessage>[0]) => {
          if (input.role === "stylist") {
            await new Promise((resolve) => setTimeout(resolve, 120));
          }
          return fakeStoredMessage(input);
        });

        const pending = sendConsultationMessage("owner-1", CLIENT_A, "hi", undefined, { env: GEMINI_ENV, createProvider: provider });
        await vi.advanceTimersByTimeAsync(120);
        const result = await pending;

        expect(result.outcome).toBe("succeeded");
        if (result.outcome === "succeeded") {
          expect(result.providerLatencyMs).toBeLessThan(80);
        }
      } finally {
        vi.useRealTimers();
      }
    });

    it("logs a real breakdown (preProviderReadsMs/providerLatencyMs/replyWriteMs/consultationTotalMs/unattributedMs) that correctly attributes a slow reply write to replyWriteMs, not providerLatencyMs", async () => {
      vi.useFakeTimers();
      try {
        const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
        const provider = stubProvider(async () => ({ reply: "ok", needsClarification: false }));
        messageRepoMock.recordConsultationMessage.mockImplementation(async (input: Parameters<typeof fakeStoredMessage>[0]) => {
          if (input.role === "assistant") {
            await new Promise((resolve) => setTimeout(resolve, 120));
          }
          return fakeStoredMessage(input);
        });

        const pending = sendConsultationMessage("owner-1", CLIENT_A, "hi", undefined, { env: GEMINI_ENV, createProvider: provider });
        await vi.advanceTimersByTimeAsync(120);
        await pending;

        const logged = JSON.parse(logSpy.mock.calls[logSpy.mock.calls.length - 1][0] as string);
        expect(logged.status).toBe("SUCCEEDED");
        expect(logged.providerLatencyMs).toBeLessThan(80);
        expect(logged.replyWriteMs).toBeGreaterThanOrEqual(120);
        // consultationTotalMs must account for the slow write somewhere --
        // proving the total isn't ALSO silently shrunk by the same bug.
        expect(logged.consultationTotalMs).toBeGreaterThanOrEqual(120);
        // The three named windows plus the remainder must never exceed the
        // real total -- an honest accounting, not numbers that overcount.
        const sum = logged.preProviderReadsMs + logged.providerLatencyMs + logged.replyWriteMs + logged.unattributedMs;
        expect(sum).toBeLessThanOrEqual(logged.consultationTotalMs + 5); // +5ms slack for timer granularity
        expect(logged.unattributedMs).toBeGreaterThanOrEqual(0);
        logSpy.mockRestore();
      } finally {
        vi.useRealTimers();
      }
    });

    it("preProviderReadsMs reflects slow analysis/history/memory reads, never the provider call or the reply write", async () => {
      vi.useFakeTimers();
      try {
        const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
        analysisRepoMock.findLatestAnalysisForClient.mockImplementation(async () => {
          await new Promise((resolve) => setTimeout(resolve, 100));
          return null;
        });
        const provider = stubProvider(async () => ({ reply: "ok", needsClarification: false }));

        const pending = sendConsultationMessage("owner-1", CLIENT_A, "hi", undefined, { env: GEMINI_ENV, createProvider: provider });
        await vi.advanceTimersByTimeAsync(100);
        await pending;

        const logged = JSON.parse(logSpy.mock.calls[logSpy.mock.calls.length - 1][0] as string);
        expect(logged.preProviderReadsMs).toBeGreaterThanOrEqual(100);
        expect(logged.providerLatencyMs).toBeLessThan(80);
        expect(logged.replyWriteMs).toBeLessThan(80);
        logSpy.mockRestore();
      } finally {
        vi.useRealTimers();
      }
    });

    // Latency instrumentation follow-up (2026-08-20): a real production
    // turn showed unattributedMs at ~21.7s on a turn where
    // providerAttemptCount reached 2 -- this proves the exact mechanism:
    // a slow FAILED first attempt used to be completely invisible,
    // silently absorbed into unattributedMs instead of its own field.
    // CI reliability follow-up (2026-08-20, Round 9): this test used a real
    // setTimeout(150) racing against a >=150 assertion -- exactly the kind
    // of tight-threshold real-timer test that's fine on a quiet local
    // machine but genuinely flaky under CI runner scheduling jitter
    // (a real CI run measured 149ms). Switched to fake timers, mirroring
    // teach-ai-panel-logic.test.ts's own "hung connection" test exactly:
    // Date.now() advances in lockstep with vi.advanceTimersByTimeAsync,
    // so failedFirstAttemptMs is now deterministically >=150 every run,
    // not a real-clock race.
    it("failedFirstAttemptMs captures a slow FAILED first attempt's own duration, and unattributedMs no longer absorbs it", async () => {
      vi.useFakeTimers();
      try {
        const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
        let calls = 0;
        const provider = stubProvider(async () => {
          calls += 1;
          if (calls === 1) {
            await new Promise((resolve) => setTimeout(resolve, 150));
            throw Object.assign(new Error("service unavailable"), { code: "PROVIDER_ERROR", retryable: true, status: 503 });
          }
          return { reply: "ok", needsClarification: false };
        });

        const pending = sendConsultationMessage("owner-1", CLIENT_A, "hi", undefined, { env: GEMINI_ENV, createProvider: provider });
        await vi.advanceTimersByTimeAsync(150);
        const result = await pending;

        expect(result).toMatchObject({ outcome: "succeeded", providerAttemptCount: 2 });

        const logged = JSON.parse(logSpy.mock.calls[logSpy.mock.calls.length - 1][0] as string);
        expect(logged.status).toBe("SUCCEEDED");
        expect(logged.providerAttemptCount).toBe(2);
        // The failed first attempt's own ~150ms is now its own named field...
        expect(logged.failedFirstAttemptMs).toBeGreaterThanOrEqual(150);
        // ...never counted a second time inside unattributedMs.
        expect(logged.unattributedMs).toBeLessThan(80);
        // providerLatencyMs still reflects ONLY the successful retry, never
        // the failed first attempt's time -- unchanged guarantee from the
        // previous round's own fix.
        expect(logged.providerLatencyMs).toBeLessThan(80);
        logSpy.mockRestore();
      } finally {
        vi.useRealTimers();
      }
    });

    it("failedFirstAttemptMs is 0 (never fabricated) when no retry happens", async () => {
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const provider = stubProvider(async () => ({ reply: "ok", needsClarification: false }));

      await sendConsultationMessage("owner-1", CLIENT_A, "hi", undefined, { env: GEMINI_ENV, createProvider: provider });

      const logged = JSON.parse(logSpy.mock.calls[logSpy.mock.calls.length - 1][0] as string);
      expect(logged.failedFirstAttemptMs).toBe(0);
      logSpy.mockRestore();
    });
  });

  it("professional memory is an explicit empty array (not omitted) when there is none, so the model sees a real empty state", async () => {
    let capturedContext: unknown;
    const provider = stubProvider(async (_msg, ctx) => {
      capturedContext = ctx;
      return { reply: "ok", needsClarification: false };
    });

    await sendConsultationMessage("owner-1", CLIENT_A, "hi", undefined, { env: GEMINI_ENV, createProvider: provider });

    expect(capturedContext).toMatchObject({
      professionalMemory: [],
      clientProfessionalMemory: { recentCorrections: [], recentConsultations: [], recentFormulas: [], recentTreatments: [] },
    });
  });

  // Regression, same class as the earlier history_read fix: a failure
  // resolving the analysis (either branch) must classify as
  // PERSISTENCE_FAILURE, not fall through to the generic
  // INTERNAL_PROCESSING_FAILURE.
  it("classifies a failed latest-analysis lookup as PERSISTENCE_FAILURE", async () => {
    analysisRepoMock.findLatestAnalysisForClient.mockRejectedValue(new Error("db down"));

    const result = await sendConsultationMessage("owner-1", CLIENT_A, "hi", undefined, { env: GEMINI_ENV });

    expect(result).toEqual({ outcome: "failed", code: "PERSISTENCE_FAILURE" });
    expect(messageRepoMock.recordConsultationMessage).not.toHaveBeenCalled();
  });

  it("classifies a failed explicit-analysis lookup as PERSISTENCE_FAILURE", async () => {
    analysisRepoMock.findAnalysisForOwner.mockRejectedValue(new Error("db down"));

    const result = await sendConsultationMessage("owner-1", CLIENT_A, "hi", "analysis-1", { env: GEMINI_ENV });

    expect(result).toEqual({ outcome: "failed", code: "PERSISTENCE_FAILURE" });
  });

  it("classifies a failed professional-memory read as PERSISTENCE_FAILURE, and never calls the provider", async () => {
    clientContextMock.buildClientProfessionalMemory.mockRejectedValue(new Error("db down"));
    const provider = stubProvider(async () => ({ reply: "ok", needsClarification: false }));

    const result = await sendConsultationMessage("owner-1", CLIENT_A, "hi", undefined, { env: GEMINI_ENV, createProvider: provider });

    expect(result).toEqual({ outcome: "failed", code: "PERSISTENCE_FAILURE" });
  });

  // 16/17: assumptions and missingData must stay distinct, labeled
  // categories in the context handed to the provider -- never merged into
  // the plain confirmed fields above them.
  it("16/17: merges assumptions/contraindications/missingData/safetyNotes/clarificationAnswers from the real plans, kept as their own distinct fields", async () => {
    analysisRepoMock.findLatestAnalysisForClient.mockResolvedValue(analysisState({
      safetyNotes: ["Perform a strand test before lightening."],
      clarificationAnswers: ["No known allergies.", "Bleached six weeks ago."],
      technicalCutPlan: {
        cuttingTechnique: "scissor_over_comb",
        missingData: ["headShape"],
        assumptions: ["Assumed even density across the crown."],
        contraindications: ["Avoid double-process lightening this session."],
      },
    }));
    let capturedContext: unknown;
    const provider = stubProvider(async (_msg, ctx) => {
      capturedContext = ctx;
      return { reply: "ok", needsClarification: false };
    });

    await sendConsultationMessage("owner-1", CLIENT_A, "hi", undefined, { env: GEMINI_ENV, createProvider: provider });

    expect(capturedContext).toMatchObject({
      currentAnalysis: expect.objectContaining({
        missingData: ["headShape"],
        assumptions: ["Assumed even density across the crown."],
        contraindications: ["Avoid double-process lightening this session."],
        safetyNotes: ["Perform a strand test before lightening."],
        clarificationAnswers: ["No known allergies.", "Bleached six weeks ago."],
      }),
    });
  });

  it("B (extended): professional memory retrieval and client memory are also scoped strictly per client", async () => {
    const provider = stubProvider(async () => ({ reply: "ok", needsClarification: false }));

    await sendConsultationMessage("owner-1", CLIENT_A, "hi", undefined, { env: GEMINI_ENV, createProvider: provider });
    expect(memoryRepoMock.retrieveRelevantMemories).toHaveBeenCalledWith("owner-1", "client-a", "hi");
    expect(clientContextMock.buildClientProfessionalMemory).toHaveBeenCalledWith("owner-1", "client-a", null);

    vi.clearAllMocks();
    messageRepoMock.recordConsultationMessage.mockImplementation(async (input: Parameters<typeof fakeStoredMessage>[0]) =>
      fakeStoredMessage(input),
    );
    await sendConsultationMessage("owner-1", CLIENT_B, "hi", undefined, { env: GEMINI_ENV, createProvider: provider });
    expect(memoryRepoMock.retrieveRelevantMemories).toHaveBeenCalledWith("owner-1", "client-b", "hi");
    expect(memoryRepoMock.retrieveRelevantMemories).not.toHaveBeenCalledWith("owner-1", "client-a", expect.anything());
  });
});
