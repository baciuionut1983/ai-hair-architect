import { beforeEach, describe, expect, it, vi } from "vitest";

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

  class AnalysisDependencyError extends Error {
    constructor(
      readonly code: "ANALYSIS_CLIENT_NOT_FOUND" | "ANALYSIS_DEPENDENCY_CHANGED",
      readonly httpStatus: 404 | 409,
      message: string,
    ) {
      super(message);
    }
  }

  return {
    AnalysisConcurrencyError,
    AnalysisDependencyError,
    analysisPersistenceUnavailableResponse: vi.fn(() => Response.json(
      {
        error: "ANALYSIS_PERSISTENCE_UNAVAILABLE",
        message: "Analysis data is temporarily unavailable.",
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    )),
    createAnalysisForOwner: vi.fn(),
    isAnalysisPersistenceError: vi.fn(),
  };
});
const storeMock = vi.hoisted(() => ({
  getSession: vi.fn(),
}));

vi.mock("next/headers", () => cookiesMock);
vi.mock("@/lib/analysis-persistence", () => legacyPersistenceMock);
vi.mock("@/lib/analysis-repository", () => repositoryMock);
vi.mock("@/lib/milestone1-store", () => storeMock);

import { POST } from "./route";

describe("POST /api/v1/analysis/start", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cookiesMock.cookies.mockResolvedValue({ get: () => ({ value: "session-token" }) });
    storeMock.getSession.mockReturnValue({ id: "owner-1", role: "professional" });
    repositoryMock.createAnalysisForOwner.mockResolvedValue(analysisRecord());
  });

  it("preserves the unauthorized response without accessing persistence", async () => {
    storeMock.getSession.mockReturnValue(null);

    const response = await POST(startRequest(validPayload()));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
    expect(repositoryMock.createAnalysisForOwner).not.toHaveBeenCalled();
  });

  it("preserves required payload validation", async () => {
    const response = await POST(startRequest({ clientId: "client-1" }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Invalid analysis payload." });
    expect(repositoryMock.createAnalysisForOwner).not.toHaveBeenCalled();
  });

  it("rejects an invalid goal before touching persistence", async () => {
    const response = await POST(startRequest({ ...validPayload(), goal: "not-a-real-goal" }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Invalid analysis payload." });
    expect(repositoryMock.createAnalysisForOwner).not.toHaveBeenCalled();
  });

  it("rejects an invalid hairType before touching persistence", async () => {
    const response = await POST(startRequest({ ...validPayload(), hairType: "straight" }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Invalid analysis payload." });
    expect(repositoryMock.createAnalysisForOwner).not.toHaveBeenCalled();
  });

  it("rejects an invalid density before touching persistence", async () => {
    const response = await POST(startRequest({ ...validPayload(), density: "extreme" }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Invalid analysis payload." });
    expect(repositoryMock.createAnalysisForOwner).not.toHaveBeenCalled();
  });

  it("rejects an invalid porosity before touching persistence", async () => {
    const response = await POST(startRequest({ ...validPayload(), porosity: "extreme" }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Invalid analysis payload." });
    expect(repositoryMock.createAnalysisForOwner).not.toHaveBeenCalled();
  });

  it("preserves milestone8 enum validation", async () => {
    const response = await POST(startRequest({ ...validPayload(), faceShape: "triangle" }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Invalid milestone8 analysis payload." });
    expect(repositoryMock.createAnalysisForOwner).not.toHaveBeenCalled();
  });

  it("preserves the consumer restriction for technical plans", async () => {
    storeMock.getSession.mockReturnValue({ id: "owner-1", role: "consumer" });

    const response = await POST(startRequest({ ...validPayload(), goal: "reshape" }));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "Advanced technical analysis (cutting, color, or treatment) is restricted to professional or salon roles.",
    });
    expect(repositoryMock.createAnalysisForOwner).not.toHaveBeenCalled();
  });

  it("restricts a consumer requesting a color plan the same way as a technical cut plan", async () => {
    storeMock.getSession.mockReturnValue({ id: "owner-1", role: "consumer" });

    const response = await POST(startRequest({ ...validPayload(), goal: "cover" }));

    expect(response.status).toBe(403);
    expect(repositoryMock.createAnalysisForOwner).not.toHaveBeenCalled();
  });

  it("restricts a consumer requesting a treatment plan the same way as a technical cut plan", async () => {
    storeMock.getSession.mockReturnValue({ id: "owner-1", role: "consumer" });

    const response = await POST(startRequest({ ...validPayload(), goal: "treat" }));

    expect(response.status).toBe(403);
    expect(repositoryMock.createAnalysisForOwner).not.toHaveBeenCalled();
  });

  it("passes colorPlan and treatmentPlan through to the response when the repository returns them", async () => {
    repositoryMock.createAnalysisForOwner.mockResolvedValue({
      ...analysisRecord(),
      colorPlan: { version: "1.0.0-m27", formulaDirection: "single_process_gray_coverage" },
      treatmentPlan: { version: "1.0.0-m27", treatmentCategory: "deep_hydration" },
    });

    const response = await POST(startRequest({ ...validPayload(), goal: "cover" }));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.colorPlan).toMatchObject({ formulaDirection: "single_process_gray_coverage" });
    expect(body.treatmentPlan).toMatchObject({ treatmentCategory: "deep_hydration" });
  });

  it("creates once through the owner-scoped repository and preserves the success contract", async () => {
    const response = await POST(startRequest(validPayload()));

    expect(response.status).toBe(200);
    expect(repositoryMock.createAnalysisForOwner).toHaveBeenCalledOnce();
    expect(repositoryMock.createAnalysisForOwner).toHaveBeenCalledWith(
      "owner-1",
      "client-1",
      expect.objectContaining({
        goal: "refresh",
        hairType: "medium",
        density: "medium",
        porosity: "low",
        phase: "ready",
        clarificationRound: 0,
        confidenceScore: 0.87,
      }),
    );
    expect(legacyPersistenceMock.upsertPersistedAnalysis).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      analysisId: "analysis-1",
      phase: "ready",
      clarificationRound: 0,
      confidenceScore: 0.87,
      uncertaintyReasons: [],
      followUpQuestions: [],
      recommendations: [
        "Use conservative formula strategy and document service context.",
        "Save follow-up protocol in client timeline for safer next visit.",
      ],
      safetyNotes: ["Perform strand test before high-lift or correction services."],
    });
  });

  it("passes the authenticated owner and maps an invalid Client to the existing 404", async () => {
    repositoryMock.createAnalysisForOwner.mockRejectedValue(new repositoryMock.AnalysisDependencyError(
      "ANALYSIS_CLIENT_NOT_FOUND",
      404,
      "Client not found.",
    ));

    const response = await POST(startRequest(validPayload()));

    expect(repositoryMock.createAnalysisForOwner).toHaveBeenCalledWith(
      "owner-1",
      "client-1",
      expect.any(Object),
    );
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Client not found." });
  });

  it("maps a dependency race to a controlled conflict", async () => {
    repositoryMock.createAnalysisForOwner.mockRejectedValue(new repositoryMock.AnalysisDependencyError(
      "ANALYSIS_DEPENDENCY_CHANGED",
      409,
      "Analysis dependencies changed.",
    ));

    const response = await POST(startRequest(validPayload()));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "Analysis dependencies changed." });
  });

  it("returns a controlled 409 after repository concurrency retries are exhausted", async () => {
    repositoryMock.createAnalysisForOwner.mockRejectedValue(
      new repositoryMock.AnalysisConcurrencyError(),
    );

    const response = await POST(startRequest(validPayload()));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "Analysis could not be updated because of concurrent changes.",
    });
  });

  it("fails closed with a no-store 503 when the database is unavailable", async () => {
    const failure = new Error("database details");
    repositoryMock.createAnalysisForOwner.mockRejectedValue(failure);
    repositoryMock.isAnalysisPersistenceError.mockImplementation((error) => error === failure);

    const response = await POST(startRequest(validPayload()));

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

function startRequest(payload: Record<string, unknown>): Request {
  return new Request("http://localhost/api/v1/analysis/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

function validPayload(): Record<string, unknown> {
  return {
    clientId: "client-1",
    goal: "refresh",
    hairType: "medium",
    density: "medium",
    porosity: "low",
  };
}

function analysisRecord() {
  return {
    id: "analysis-1",
    clientId: "client-1",
    createdByUserId: "owner-1",
    goal: "refresh",
    hairType: "medium",
    density: "medium",
    porosity: "low",
    phase: "ready",
    clarificationRound: 0,
    confidenceScore: 0.87,
    uncertaintyReasons: [],
    followUpQuestions: [],
    recommendations: [
      "Use conservative formula strategy and document service context.",
      "Save follow-up protocol in client timeline for safer next visit.",
    ],
    safetyNotes: ["Perform strand test before high-lift or correction services."],
    clarificationAnswers: [],
    createdAt: "2026-07-26T10:00:00.000Z",
    updatedAt: "2026-07-26T10:00:00.000Z",
  };
}