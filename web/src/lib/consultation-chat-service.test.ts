import { beforeEach, describe, expect, it, vi } from "vitest";

const analysisRepoMock = vi.hoisted(() => ({
  findAnalysisForOwner: vi.fn(),
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

vi.mock("@/lib/analysis-repository", () => analysisRepoMock);
vi.mock("@/lib/consultation-message-repository", () => messageRepoMock);

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
  analysisRepoMock.findAnalysisForOwner.mockResolvedValue(null);
  messageRepoMock.listRecentConsultationMessages.mockResolvedValue([]);
  messageRepoMock.recordConsultationMessage.mockImplementation(async (input: Parameters<typeof fakeStoredMessage>[0]) =>
    fakeStoredMessage(input),
  );
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
});
