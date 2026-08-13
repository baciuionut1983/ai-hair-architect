import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.hoisted(() => ({ authenticateSessionRequest: vi.fn() }));
const legacyPersistenceMock = vi.hoisted(() => ({ findPersistedAnalysisById: vi.fn() }));
const repositoryMock = vi.hoisted(() => ({
  analysisPersistenceUnavailableResponse: vi.fn(() => Response.json(
    {
      error: "ANALYSIS_PERSISTENCE_UNAVAILABLE",
      message: "Analysis data is temporarily unavailable.",
    },
    { status: 503, headers: { "Cache-Control": "no-store" } },
  )),
  findAnalysisForOwner: vi.fn(),
  isAnalysisPersistenceError: vi.fn((_error: unknown) => false),
}));

vi.mock("@/lib/analysis-persistence", () => legacyPersistenceMock);
vi.mock("@/lib/analysis-repository", () => repositoryMock);
vi.mock("@/lib/session-request-auth", () => authMock);

import { GET } from "./route";

describe("GET /api/v1/analysis/[id]/result", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.authenticateSessionRequest.mockResolvedValue({ id: "owner-1", email: "owner@example.com", role: "professional", locale: "en" });
    repositoryMock.findAnalysisForOwner.mockResolvedValue(analysisRecord());
    repositoryMock.isAnalysisPersistenceError.mockReturnValue(false);
  });

  it("returns 401 without a cookie, never reading persistence", async () => {
    authMock.authenticateSessionRequest.mockResolvedValue(null);

    const response = await invoke("analysis-1");

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
    expect(repositoryMock.findAnalysisForOwner).not.toHaveBeenCalled();
  });

  it("returns 401 for an unknown or expired session (no in-memory fallback)", async () => {
    authMock.authenticateSessionRequest.mockResolvedValue(null);

    const response = await invoke("analysis-1");

    expect(response.status).toBe(401);
    expect(repositoryMock.findAnalysisForOwner).not.toHaveBeenCalled();
  });

  it("reads once through the owner-scoped repository and preserves the result contract", async () => {
    const response = await invoke("analysis-1");

    expect(response.status).toBe(200);
    expect(repositoryMock.findAnalysisForOwner).toHaveBeenCalledOnce();
    expect(repositoryMock.findAnalysisForOwner).toHaveBeenCalledWith("owner-1", "analysis-1");
    expect(legacyPersistenceMock.findPersistedAnalysisById).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      analysisId: "analysis-1",
      clientId: "client-1",
      goal: "refresh",
      hairType: "medium",
      density: "medium",
      porosity: "low",
      phase: "ready",
      clarificationRound: 0,
      confidenceScore: 0.87,
      uncertaintyReasons: [],
      followUpQuestions: [],
      recommendations: ["Document the service."],
      safetyNotes: ["Perform a strand test."],
      clarificationAnswers: [],
      imageAssetId: null,
      createdAt: "2026-07-26T10:00:00.000Z",
      updatedAt: "2026-07-26T10:00:00.000Z",
    });
  });

  it("returns the original photo's imageAssetId when the Analysis was derived from a photo", async () => {
    repositoryMock.findAnalysisForOwner.mockResolvedValue({ ...analysisRecord(), imageAssetId: "asset-1" });

    const response = await invoke("analysis-1");

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.imageAssetId).toBe("asset-1");
  });

  it("returns null imageAssetId (never omitted) for a manual analysis with no photo", async () => {
    const response = await invoke("analysis-1");

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.imageAssetId).toBeNull();
  });

  it("returns 404 when the Analysis does not exist", async () => {
    repositoryMock.findAnalysisForOwner.mockResolvedValue(null);

    const response = await invoke("missing-analysis");

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Analysis not found." });
  });

  it("returns the same 404 for an Analysis owned by another user", async () => {
    repositoryMock.findAnalysisForOwner.mockResolvedValue(null);

    const response = await invoke("foreign-analysis");

    expect(repositoryMock.findAnalysisForOwner).toHaveBeenCalledWith("owner-1", "foreign-analysis");
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Analysis not found." });
  });

  it("returns 404 for an M8 Analysis excluded by the repository", async () => {
    repositoryMock.findAnalysisForOwner.mockResolvedValue(null);

    const response = await invoke("m8-analysis");

    expect(repositoryMock.findAnalysisForOwner).toHaveBeenCalledWith("owner-1", "m8-analysis");
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Analysis not found." });
  });

  it("fails closed with a no-store 503 when the database is unavailable", async () => {
    const failure = new Error("database details");
    repositoryMock.findAnalysisForOwner.mockRejectedValue(failure);
    repositoryMock.isAnalysisPersistenceError.mockImplementation((error) => error === failure);

    const response = await invoke("analysis-1");

    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      error: "ANALYSIS_PERSISTENCE_UNAVAILABLE",
      message: "Analysis data is temporarily unavailable.",
    });
    expect(repositoryMock.analysisPersistenceUnavailableResponse).toHaveBeenCalledOnce();
    expect(legacyPersistenceMock.findPersistedAnalysisById).not.toHaveBeenCalled();
  });
});

function invoke(id: string): Promise<Response> {
  return GET(
    new Request(`http://localhost/api/v1/analysis/${id}/result`),
    { params: Promise.resolve({ id }) },
  );
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
    recommendations: ["Document the service."],
    safetyNotes: ["Perform a strand test."],
    clarificationAnswers: [],
    createdAt: "2026-07-26T10:00:00.000Z",
    updatedAt: "2026-07-26T10:00:00.000Z",
  };
}