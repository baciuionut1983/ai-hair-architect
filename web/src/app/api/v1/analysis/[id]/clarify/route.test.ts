import { beforeEach, describe, expect, it, vi } from "vitest";

type AnalysisFixture = ReturnType<typeof analysisRecord>;
type AnalysisTransition = (current: AnalysisFixture) => Omit<
  AnalysisFixture,
  "id" | "clientId" | "createdByUserId" | "createdAt" | "updatedAt"
>;

const cookiesMock = vi.hoisted(() => ({ cookies: vi.fn() }));
const legacyPersistenceMock = vi.hoisted(() => ({ upsertPersistedAnalysis: vi.fn() }));
const repositoryMock = vi.hoisted(() => {
  class AnalysisConcurrencyError extends Error {
    readonly code = "ANALYSIS_CONCURRENCY_CONFLICT";
    readonly httpStatus = 409;

    constructor() {
      super("Analysis could not be updated because of concurrent changes.");
    }
  }

  return {
    AnalysisConcurrencyError,
    analysisPersistenceUnavailableResponse: vi.fn(() => Response.json(
      {
        error: "ANALYSIS_PERSISTENCE_UNAVAILABLE",
        message: "Analysis data is temporarily unavailable.",
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    )),
    clarifyAnalysisForOwner: vi.fn(),
    isAnalysisPersistenceError: vi.fn((_error: unknown) => false),
  };
});
const storeMock = vi.hoisted(() => ({
  getSession: vi.fn(),
  sanitize: vi.fn(),
}));

vi.mock("next/headers", () => cookiesMock);
vi.mock("@/lib/analysis-persistence", () => legacyPersistenceMock);
vi.mock("@/lib/analysis-repository", () => repositoryMock);
vi.mock("@/lib/milestone1-store", () => storeMock);

import { POST } from "./route";

describe("POST /api/v1/analysis/[id]/clarify", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cookiesMock.cookies.mockResolvedValue({ get: () => ({ value: "session-token" }) });
    storeMock.getSession.mockReturnValue({ id: "owner-1", role: "professional" });
    storeMock.sanitize.mockImplementation((value: unknown) => String(value ?? "").trim());
    repositoryMock.isAnalysisPersistenceError.mockReturnValue(false);
    repositoryMock.clarifyAnalysisForOwner.mockImplementation(async (
      _ownerUserId: string,
      _analysisId: string,
      transition: AnalysisTransition,
    ) => ({
      ...analysisRecord(),
      ...transition(analysisRecord()),
      updatedAt: "2026-07-26T10:01:00.000Z",
    }));
  });

  it("preserves the unauthorized response without updating persistence", async () => {
    storeMock.getSession.mockReturnValue(null);

    const response = await invoke("analysis-1", { answers: ["no"] });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
    expect(repositoryMock.clarifyAnalysisForOwner).not.toHaveBeenCalled();
  });

  it("preserves answer sanitization and required payload validation", async () => {
    const response = await invoke("analysis-1", { answers: ["  ", ""] });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "answers[] is required." });
    expect(repositoryMock.clarifyAnalysisForOwner).not.toHaveBeenCalled();
  });

  it("updates atomically through the owner-scoped repository and preserves the success contract", async () => {
    const response = await invoke("analysis-1", { answers: [" no ", "healthy"] });

    expect(response.status).toBe(200);
    expect(repositoryMock.clarifyAnalysisForOwner).toHaveBeenCalledOnce();
    expect(repositoryMock.clarifyAnalysisForOwner).toHaveBeenCalledWith(
      "owner-1",
      "analysis-1",
      expect.any(Function),
    );
    const transition = repositoryMock.clarifyAnalysisForOwner.mock.calls[0][2] as AnalysisTransition;
    expect(transition(analysisRecord())).toMatchObject({
      phase: "ready",
      clarificationRound: 1,
      confidenceScore: 0.81,
      clarificationAnswers: ["no", "healthy"],
    });
    expect(legacyPersistenceMock.upsertPersistedAnalysis).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      analysisId: "analysis-1",
      phase: "ready",
      clarificationRound: 1,
      confidenceScore: 0.81,
      uncertaintyReasons: [],
      followUpQuestions: [],
      recommendations: ["Document the service."],
      safetyNotes: ["Perform a strand test."],
    });
  });

  it.each([
    ["missing Analysis", "missing-analysis"],
    ["Analysis owned by another user", "foreign-analysis"],
    ["M8 Analysis", "m8-analysis"],
  ])("returns 404 without a memory fallback for %s", async (_case, analysisId) => {
    repositoryMock.clarifyAnalysisForOwner.mockResolvedValue(null);

    const response = await invoke(analysisId, { answers: ["no"] });

    expect(repositoryMock.clarifyAnalysisForOwner).toHaveBeenCalledWith(
      "owner-1",
      analysisId,
      expect.any(Function),
    );
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Analysis not found." });
  });

  it("returns a controlled 409 after repository concurrency retries are exhausted", async () => {
    repositoryMock.clarifyAnalysisForOwner.mockRejectedValue(
      new repositoryMock.AnalysisConcurrencyError(),
    );

    const response = await invoke("analysis-1", { answers: ["no"] });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "Analysis could not be updated because of concurrent changes.",
    });
  });

  it("fails closed with a no-store 503 when the database is unavailable", async () => {
    const failure = new Error("database details");
    repositoryMock.clarifyAnalysisForOwner.mockRejectedValue(failure);
    repositoryMock.isAnalysisPersistenceError.mockImplementation((error) => error === failure);

    const response = await invoke("analysis-1", { answers: ["no"] });

    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      error: "ANALYSIS_PERSISTENCE_UNAVAILABLE",
      message: "Analysis data is temporarily unavailable.",
    });
    expect(repositoryMock.analysisPersistenceUnavailableResponse).toHaveBeenCalledOnce();
    expect(legacyPersistenceMock.upsertPersistedAnalysis).not.toHaveBeenCalled();
  });
});

function invoke(id: string, payload: Record<string, unknown>): Promise<Response> {
  return POST(
    new Request(`http://localhost/api/v1/analysis/${id}/clarify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
    { params: Promise.resolve({ id }) },
  );
}

function analysisRecord() {
  return {
    id: "analysis-1",
    clientId: "client-1",
    createdByUserId: "owner-1",
    goal: "lighten" as const,
    hairType: "fine" as const,
    density: "medium" as const,
    porosity: "high" as const,
    phase: "pending_questions" as const,
    clarificationRound: 0,
    confidenceScore: 0.62,
    uncertaintyReasons: ["More history is required."],
    followUpQuestions: ["Was the hair recently bleached?"],
    recommendations: ["Document the service."],
    safetyNotes: ["Perform a strand test."],
    clarificationAnswers: [] as string[],
    createdAt: "2026-07-26T10:00:00.000Z",
    updatedAt: "2026-07-26T10:00:00.000Z",
  };
}