import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.hoisted(() => ({ authenticateSessionRequest: vi.fn() }));
const repositoryMock = vi.hoisted(() => {
  class AnalysisConcurrencyError extends Error {
    readonly code = "ANALYSIS_CONCURRENCY_CONFLICT";
    readonly httpStatus = 409;
    constructor() {
      super("Analysis could not be updated because of concurrent changes.");
    }
  }
  class AnalysisCorrectionValidationError extends Error {
    constructor(
      readonly code: "ANALYSIS_CORRECTION_INVALID_FIELD" | "ANALYSIS_CORRECTION_INVALID_VALUE",
      message: string,
    ) {
      super(message);
    }
  }

  return {
    AnalysisConcurrencyError,
    AnalysisCorrectionValidationError,
    analysisPersistenceUnavailableResponse: vi.fn(() => Response.json(
      { error: "ANALYSIS_PERSISTENCE_UNAVAILABLE", message: "Analysis data is temporarily unavailable." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    )),
    applyAnalysisCorrection: vi.fn(),
    isAnalysisPersistenceError: vi.fn((_error: unknown) => false),
    isCorrectableAnalysisField: vi.fn((field: string) =>
      ["hairType", "density", "porosity", "faceShape", "headShape", "hairLength", "hairTexture", "hairCondition", "growthPattern", "targetShape", "desiredColorResult", "grayPercentage", "scalpCondition", "treatmentGoalDetail"].includes(field)),
    listAnalysisCorrections: vi.fn(),
  };
});

vi.mock("@/lib/session-request-auth", () => authMock);
vi.mock("@/lib/analysis-repository", () => repositoryMock);

import { GET, POST } from "./route";

const OWNER = { id: "owner-1", email: "owner@example.com", role: "professional", locale: "en" };

function invoke(id: string, body: unknown): Promise<Response> {
  return POST(
    new Request(`http://localhost/api/v1/analysis/${id}/correct`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );
}

function invokeGet(id: string): Promise<Response> {
  return GET(new Request(`http://localhost/api/v1/analysis/${id}/correct`), { params: Promise.resolve({ id }) });
}

function updatedState(overrides: Record<string, unknown> = {}) {
  return {
    id: "analysis-1",
    phase: "ready" as const,
    clarificationRound: 0,
    confidenceScore: 0.87,
    uncertaintyReasons: [] as string[],
    followUpQuestions: [] as string[],
    recommendations: ["Document the service."],
    safetyNotes: ["Perform a strand test."],
    imageAssetId: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  authMock.authenticateSessionRequest.mockResolvedValue(OWNER);
  repositoryMock.applyAnalysisCorrection.mockResolvedValue(updatedState());
  repositoryMock.listAnalysisCorrections.mockResolvedValue([
    {
      id: "correction-1",
      analysisId: "analysis-1",
      fieldName: "hairCondition",
      previousValue: null,
      newValue: "virgin_healthy",
      source: "stylist_confirmed",
      reason: null,
      createdAt: "2026-08-14T00:00:00.000Z",
    },
  ]);
  repositoryMock.isAnalysisPersistenceError.mockReturnValue(false);
});

describe("POST /api/v1/analysis/[id]/correct", () => {
  it("returns 401 without a cookie, never touching the repository", async () => {
    authMock.authenticateSessionRequest.mockResolvedValue(null);

    const response = await invoke("analysis-1", { field: "hairCondition", value: "virgin_healthy", source: "stylist_confirmed" });

    expect(response.status).toBe(401);
    expect(repositoryMock.applyAnalysisCorrection).not.toHaveBeenCalled();
  });

  it("returns 400 when field/value/source are missing", async () => {
    const response = await invoke("analysis-1", { field: "hairCondition" });
    expect(response.status).toBe(400);
    expect(repositoryMock.applyAnalysisCorrection).not.toHaveBeenCalled();
  });

  it("returns 400 for an unrecognized source -- never accepts visual_ai/historical/assumed from a human caller", async () => {
    const response = await invoke("analysis-1", { field: "hairCondition", value: "virgin_healthy", source: "visual_ai" });
    expect(response.status).toBe(400);
    expect(repositoryMock.applyAnalysisCorrection).not.toHaveBeenCalled();
  });

  it("returns 400 ANALYSIS_CORRECTION_INVALID_FIELD for a non-correctable field (e.g. goal) before touching the repository", async () => {
    const response = await invoke("analysis-1", { field: "goal", value: "reshape", source: "stylist_confirmed" });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("ANALYSIS_CORRECTION_INVALID_FIELD");
    expect(repositoryMock.applyAnalysisCorrection).not.toHaveBeenCalled();
  });

  it("passes field/value/source/reason through to the repository exactly, trimmed", async () => {
    await invoke("analysis-1", {
      field: "  hairCondition  ",
      value: "  fragile_breakage  ",
      source: "stylist_confirmed",
      reason: "  Visible breakage.  ",
    });

    expect(repositoryMock.applyAnalysisCorrection).toHaveBeenCalledWith("owner-1", "analysis-1", {
      field: "hairCondition",
      value: "fragile_breakage",
      source: "stylist_confirmed",
      reason: "Visible breakage.",
    });
  });

  it("returns 404 when the repository reports the Analysis does not exist (including cross-owner)", async () => {
    repositoryMock.applyAnalysisCorrection.mockResolvedValue(null);

    const response = await invoke("foreign-analysis", { field: "hairCondition", value: "virgin_healthy", source: "stylist_confirmed" });

    expect(response.status).toBe(404);
  });

  it("returns 400 with the validation error code when the repository rejects an invalid value", async () => {
    repositoryMock.applyAnalysisCorrection.mockRejectedValue(
      new repositoryMock.AnalysisCorrectionValidationError("ANALYSIS_CORRECTION_INVALID_VALUE", '"nope" is not a valid value for hairCondition.'),
    );

    const response = await invoke("analysis-1", { field: "hairCondition", value: "nope", source: "stylist_confirmed" });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("ANALYSIS_CORRECTION_INVALID_VALUE");
  });

  it("returns 409 on a concurrency conflict", async () => {
    repositoryMock.applyAnalysisCorrection.mockRejectedValue(new repositoryMock.AnalysisConcurrencyError());

    const response = await invoke("analysis-1", { field: "hairCondition", value: "virgin_healthy", source: "stylist_confirmed" });

    expect(response.status).toBe(409);
  });

  it("fails closed with a no-store 503 when the database is unavailable", async () => {
    const failure = new Error("database details");
    repositoryMock.applyAnalysisCorrection.mockRejectedValue(failure);
    repositoryMock.isAnalysisPersistenceError.mockImplementation((error: unknown) => error === failure);

    const response = await invoke("analysis-1", { field: "hairCondition", value: "virgin_healthy", source: "stylist_confirmed" });

    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("on success, returns the updated analysis and the correction record (provenance) together", async () => {
    const response = await invoke("analysis-1", { field: "hairCondition", value: "virgin_healthy", source: "stylist_confirmed" });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.analysis.analysisId).toBe("analysis-1");
    expect(body.correction).toMatchObject({ fieldName: "hairCondition", newValue: "virgin_healthy", source: "stylist_confirmed" });
  });
});

describe("GET /api/v1/analysis/[id]/correct (correction history)", () => {
  it("returns 401 without a cookie", async () => {
    authMock.authenticateSessionRequest.mockResolvedValue(null);

    const response = await invokeGet("analysis-1");

    expect(response.status).toBe(401);
    expect(repositoryMock.listAnalysisCorrections).not.toHaveBeenCalled();
  });

  it("returns the owner-scoped correction history", async () => {
    const response = await invokeGet("analysis-1");

    expect(response.status).toBe(200);
    expect(repositoryMock.listAnalysisCorrections).toHaveBeenCalledWith("owner-1", "analysis-1");
    const body = await response.json();
    expect(body.corrections).toHaveLength(1);
  });

  it("fails closed with a no-store 503 when the database is unavailable", async () => {
    const failure = new Error("database details");
    repositoryMock.listAnalysisCorrections.mockRejectedValue(failure);
    repositoryMock.isAnalysisPersistenceError.mockImplementation((error: unknown) => error === failure);

    const response = await invokeGet("analysis-1");

    expect(response.status).toBe(503);
  });
});
