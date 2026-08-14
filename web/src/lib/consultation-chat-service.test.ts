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

vi.mock("@/lib/analysis-repository", () => analysisRepoMock);
vi.mock("@/lib/consultation-message-repository", () => messageRepoMock);
vi.mock("@/lib/professional-memory-repository", () => memoryRepoMock);
vi.mock("@/lib/consultation-client-context", () => clientContextMock);

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

  it("returns ANALYSIS_NOT_FOUND when an analysisId is given but does not belong to this owner/client", async () => {
    analysisRepoMock.findAnalysisForOwner.mockResolvedValue(null);

    const result = await sendConsultationMessage("owner-1", CLIENT_A, "hi", "foreign-analysis", { env: GEMINI_ENV });

    expect(result).toEqual({ outcome: "failed", code: "ANALYSIS_NOT_FOUND" });
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

  it("H: fails closed (no fabricated reply) when the real provider call fails, classifying TIMEOUT/RATE_LIMITED/etc. correctly", async () => {
    const timeoutProvider = stubProvider(async () => {
      throw Object.assign(new Error("timed out"), { code: "TIMEOUT", retryable: true });
    });

    const result = await sendConsultationMessage("owner-1", CLIENT_A, "hi", undefined, { env: GEMINI_ENV, createProvider: timeoutProvider });

    expect(result).toEqual({ outcome: "failed", code: "PROVIDER_TIMEOUT" });
    // The assistant's reply is never recorded on failure -- only the
    // stylist's own message (recorded before the provider call) exists.
    expect(messageRepoMock.recordConsultationMessage).toHaveBeenCalledTimes(1);
    expect(messageRepoMock.recordConsultationMessage).toHaveBeenCalledWith(expect.objectContaining({ role: "stylist" }));
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
