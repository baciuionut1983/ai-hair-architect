import { randomUUID } from "crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  sessionFindUnique: vi.fn(),
  imageAssetFindUnique: vi.fn(),
  analysisCreate: vi.fn(),
}));
const serviceMock = vi.hoisted(() => ({ reviewAnalysis: vi.fn() }));
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
      { error: "ANALYSIS_PERSISTENCE_UNAVAILABLE", message: "Analysis data is temporarily unavailable." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    )),
    createAnalysisForOwner: vi.fn(),
    isAnalysisPersistenceError: vi.fn(),
  };
});

vi.mock("@/lib/prisma", () => ({
  isDatabaseConfigured: () => true,
  prisma: {
    session: { findUnique: prismaMock.sessionFindUnique },
    imageAsset: { findUnique: prismaMock.imageAssetFindUnique },
    analysis: { create: prismaMock.analysisCreate },
  },
}));

vi.mock("@/lib/image-analysis-service", () => ({
  reviewAnalysis: serviceMock.reviewAnalysis,
}));

vi.mock("@/lib/analysis-repository", () => repositoryMock);

import { POST } from "./route";

function invoke(assetId: string, token?: string, body?: unknown, cookie?: string): Promise<Response> {
  const request = new Request(`http://localhost/api/v1/image-analyses/${assetId}/review`, {
    method: "POST",
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body ?? { corrections: {}, finalizeToM8: false }),
  });
  attachCookies(request, cookie);
  return POST(request as never, { params: Promise.resolve({ assetId }) });
}

function attachCookies(request: Request, cookie: string | undefined): void {
  Object.defineProperty(request, "cookies", {
    value: { get: (name: string) => (cookie && name === "aha_session" ? { name, value: cookie } : undefined) },
  });
}

function activeSession(user: { id: string }) {
  return { user, expiresAt: new Date(Date.now() + 60_000) };
}

function expiredSession(user: { id: string }) {
  return { user, expiresAt: new Date(Date.now() - 1000) };
}

function fullUser(id: string) {
  return {
    id,
    email: `${id}@example.com`,
    role: "professional",
    locale: "en",
    passwordHash: "hashed",
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
    emailVerifiedAt: new Date("2026-08-01T00:00:00.000Z"),
  };
}

describe("POST /api/v1/image-analyses/[assetId]/review", () => {
  beforeEach(() => {
    prismaMock.sessionFindUnique.mockReset();
    prismaMock.imageAssetFindUnique.mockReset();
    prismaMock.analysisCreate.mockReset();
    serviceMock.reviewAnalysis.mockReset();
    repositoryMock.createAnalysisForOwner.mockReset();
    repositoryMock.isAnalysisPersistenceError.mockReset();
  });

  it("returns 401 without a bearer token, never touching the asset lookup or review service", async () => {
    const response = await invoke(randomUUID());
    expect(response.status).toBe(401);
    expect(prismaMock.imageAssetFindUnique).not.toHaveBeenCalled();
    expect(serviceMock.reviewAnalysis).not.toHaveBeenCalled();
  });

  it("returns 401 for an unknown session token", async () => {
    prismaMock.sessionFindUnique.mockResolvedValue(null);
    const response = await invoke(randomUUID(), "bogus-token");
    expect(response.status).toBe(401);
    expect(serviceMock.reviewAnalysis).not.toHaveBeenCalled();
  });

  it("returns 401 for an expired session and never reaches the asset lookup, review service, or any write", async () => {
    const userId = randomUUID();
    prismaMock.sessionFindUnique.mockResolvedValue(expiredSession({ id: userId }));

    const response = await invoke(randomUUID(), "token");

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
    expect(prismaMock.imageAssetFindUnique).not.toHaveBeenCalled();
    expect(serviceMock.reviewAnalysis).not.toHaveBeenCalled();
    expect(prismaMock.analysisCreate).not.toHaveBeenCalled();
  });

  it("preserves existing behavior for a valid session: reviews the draft analysis and returns the unchanged response shape", async () => {
    const userId = randomUUID();
    const assetId = "asset-1";
    prismaMock.sessionFindUnique.mockResolvedValue(activeSession({ id: userId }));
    prismaMock.imageAssetFindUnique.mockResolvedValue({
      id: assetId,
      ownerUserId: userId,
      clientId: "client-1",
      analyses: [{ id: "analysis-1" }],
    });
    serviceMock.reviewAnalysis.mockResolvedValue({ id: "analysis-1", status: "reviewed" });

    const response = await invoke(assetId, "token", { corrections: { hairType: "wavy" }, finalizeToM8: false });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      success: true,
      analysis: { analysisId: "analysis-1", status: "reviewed" },
    });
    expect(serviceMock.reviewAnalysis).toHaveBeenCalledWith("analysis-1", { hairType: "wavy" }, userId);
  });

  it("returns 403 when the asset does not belong to the authenticated owner", async () => {
    const userId = randomUUID();
    prismaMock.sessionFindUnique.mockResolvedValue(activeSession({ id: userId }));
    prismaMock.imageAssetFindUnique.mockResolvedValue({
      id: "asset-1",
      ownerUserId: "someone-else",
      clientId: "client-1",
      analyses: [{ id: "analysis-1" }],
    });

    const response = await invoke("asset-1", "token", { corrections: {}, finalizeToM8: false });

    expect(response.status).toBe(403);
    expect(serviceMock.reviewAnalysis).not.toHaveBeenCalled();
  });

  it("selects the draft analysis using canonical ordering (most recent createdAt first, no take limit)", async () => {
    const userId = randomUUID();
    prismaMock.sessionFindUnique.mockResolvedValue(activeSession({ id: userId }));
    prismaMock.imageAssetFindUnique.mockResolvedValue({
      id: "asset-1",
      ownerUserId: userId,
      clientId: "client-1",
      analyses: [{ id: "analysis-1" }],
    });
    serviceMock.reviewAnalysis.mockResolvedValue({ id: "analysis-1", status: "reviewed" });

    await invoke("asset-1", "token", { corrections: {}, finalizeToM8: false });

    expect(prismaMock.imageAssetFindUnique).toHaveBeenCalledWith({
      where: { id: "asset-1" },
      include: {
        analyses: {
          where: { status: "draft" },
          orderBy: { createdAt: "desc" },
        },
      },
    });
  });

  it("fails closed with an integrity error when more than one draft row exists for the asset (M21 -- never picks one arbitrarily)", async () => {
    const userId = randomUUID();
    prismaMock.sessionFindUnique.mockResolvedValue(activeSession({ id: userId }));
    prismaMock.imageAssetFindUnique.mockResolvedValue({
      id: "asset-1",
      ownerUserId: userId,
      clientId: "client-1",
      analyses: [{ id: "analysis-newer" }, { id: "analysis-older" }],
    });

    const response = await invoke("asset-1", "token", { corrections: {}, finalizeToM8: false });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "ANALYSIS_STATE_INTEGRITY_ERROR" });
    expect(serviceMock.reviewAnalysis).not.toHaveBeenCalled();
  });

  it("accepts a valid Postgres-backed cookie session (M31 GO-4 dual resolver)", async () => {
    const userId = randomUUID();
    const assetId = "asset-1";
    prismaMock.sessionFindUnique.mockResolvedValue({ expiresAt: new Date(Date.now() + 60_000), user: fullUser(userId) });
    prismaMock.imageAssetFindUnique.mockResolvedValue({
      id: assetId,
      ownerUserId: userId,
      clientId: "client-1",
      analyses: [{ id: "analysis-1" }],
    });
    serviceMock.reviewAnalysis.mockResolvedValue({ id: "analysis-1", status: "reviewed" });

    const response = await invoke(assetId, undefined, { corrections: {}, finalizeToM8: false }, "cookie-token");

    expect(response.status).toBe(200);
  });

  it("rejects an expired cookie session with no fallback to the in-memory session store", async () => {
    prismaMock.sessionFindUnique.mockResolvedValue({ expiresAt: new Date(Date.now() - 1000), user: fullUser(randomUUID()) });

    const response = await invoke("asset-1", undefined, { corrections: {}, finalizeToM8: false }, "expired-cookie-token");

    expect(response.status).toBe(401);
    expect(serviceMock.reviewAnalysis).not.toHaveBeenCalled();
  });
});

describe("POST .../review with finalizeToM8: true (M31 GO-4 single-Analysis-row unification)", () => {
  const ASSET_ID = "asset-1";

  function photoPayload(overrides: Record<string, unknown> = {}) {
    return {
      hairType: "wavy",
      density: "medium",
      porosity: "medium",
      faceShape: "oval",
      headShape: "balanced",
      hairLength: "medium",
      hairTexture: "free text texture note",
      hairCondition: "virgin_healthy",
      growthPattern: "regular",
      targetShape: null,
      ...overrides,
    };
  }

  function analysisRecord(overrides: Record<string, unknown> = {}) {
    return {
      id: "real-analysis-1",
      clientId: "client-1",
      createdByUserId: "owner-1",
      goal: "refresh",
      hairType: "fine",
      density: "medium",
      porosity: "medium",
      phase: "ready",
      clarificationRound: 0,
      confidenceScore: 0.8,
      uncertaintyReasons: [],
      followUpQuestions: [],
      recommendations: ["Some recommendation."],
      safetyNotes: [],
      clarificationAnswers: [],
      createdAt: "2026-08-05T00:00:00.000Z",
      updatedAt: "2026-08-05T00:00:00.000Z",
      ...overrides,
    };
  }

  beforeEach(() => {
    prismaMock.sessionFindUnique.mockReset();
    prismaMock.imageAssetFindUnique.mockReset();
    serviceMock.reviewAnalysis.mockReset();
    repositoryMock.createAnalysisForOwner.mockReset();
    repositoryMock.isAnalysisPersistenceError.mockReset();

    prismaMock.sessionFindUnique.mockResolvedValue(activeSession({ id: "owner-1" }));
    prismaMock.imageAssetFindUnique.mockResolvedValue({
      id: ASSET_ID,
      ownerUserId: "owner-1",
      clientId: "client-1",
      analyses: [{ id: "image-analysis-1", analysisPayload: photoPayload() }],
    });
  });

  it("rejects finalize without a real goal, never mutating the draft or touching the repository", async () => {
    const response = await invoke(ASSET_ID, "token", { corrections: {}, finalizeToM8: true, hairType: "fine" });

    expect(response.status).toBe(400);
    expect(serviceMock.reviewAnalysis).not.toHaveBeenCalled();
    expect(repositoryMock.createAnalysisForOwner).not.toHaveBeenCalled();
  });

  it("rejects finalize without a manual hairType (thickness), never mutating the draft or touching the repository", async () => {
    const response = await invoke(ASSET_ID, "token", { corrections: {}, finalizeToM8: true, goal: "refresh" });

    expect(response.status).toBe(400);
    expect(serviceMock.reviewAnalysis).not.toHaveBeenCalled();
    expect(repositoryMock.createAnalysisForOwner).not.toHaveBeenCalled();
  });

  it("rejects finalize when the AI could not determine density/porosity and none was supplied manually, never mutating the draft (M31 GO-4 -- an invalid finalize request must never strand the draft)", async () => {
    prismaMock.imageAssetFindUnique.mockResolvedValue({
      id: ASSET_ID,
      ownerUserId: "owner-1",
      clientId: "client-1",
      analyses: [{ id: "image-analysis-1", analysisPayload: photoPayload({ density: "unknown", porosity: "unknown" }) }],
    });

    const response = await invoke(ASSET_ID, "token", { corrections: {}, finalizeToM8: true, goal: "refresh", hairType: "fine" });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: "AI_COULD_NOT_DETERMINE_DENSITY_OR_POROSITY" });
    expect(serviceMock.reviewAnalysis).not.toHaveBeenCalled();
    expect(repositoryMock.createAnalysisForOwner).not.toHaveBeenCalled();
  });

  it("accepts a manual density/porosity override when the AI reported unknown", async () => {
    prismaMock.imageAssetFindUnique.mockResolvedValue({
      id: ASSET_ID,
      ownerUserId: "owner-1",
      clientId: "client-1",
      analyses: [{ id: "image-analysis-1", analysisPayload: photoPayload({ density: "unknown", porosity: "unknown" }) }],
    });
    serviceMock.reviewAnalysis.mockResolvedValue({
      id: "image-analysis-1",
      status: "confirmed",
      analysisPayload: photoPayload({ density: "unknown", porosity: "unknown" }),
    });
    repositoryMock.createAnalysisForOwner.mockResolvedValue(analysisRecord());

    const response = await invoke(ASSET_ID, "token", {
      corrections: {}, finalizeToM8: true, goal: "refresh", hairType: "fine", density: "high", porosity: "low",
    });

    expect(response.status).toBe(200);
    expect(repositoryMock.createAnalysisForOwner).toHaveBeenCalledWith(
      "owner-1",
      "client-1",
      expect.objectContaining({ density: "high", porosity: "low" }),
    );
  });

  it("creates exactly one Analysis row, linked to the source photo, with real M27 recommendations", async () => {
    serviceMock.reviewAnalysis.mockResolvedValue({ id: "image-analysis-1", status: "confirmed", analysisPayload: photoPayload() });
    repositoryMock.createAnalysisForOwner.mockResolvedValue(analysisRecord());

    const response = await invoke(ASSET_ID, "token", { corrections: {}, finalizeToM8: true, goal: "refresh", hairType: "fine" });

    expect(response.status).toBe(200);
    expect(repositoryMock.createAnalysisForOwner).toHaveBeenCalledOnce();
    expect(repositoryMock.createAnalysisForOwner).toHaveBeenCalledWith(
      "owner-1",
      "client-1",
      expect.objectContaining({
        goal: "refresh",
        hairType: "fine",
        imageAssetId: ASSET_ID,
        imageAnalysisId: "image-analysis-1",
      }),
    );
    const body = await response.json();
    expect(body.analysis).toEqual({ analysisId: "image-analysis-1", status: "confirmed" });
    expect(body.result).toMatchObject({ analysisId: "real-analysis-1", phase: "ready" });
  });

  it("returns the linked imageAssetId in the result, so the frontend can render the original photo", async () => {
    serviceMock.reviewAnalysis.mockResolvedValue({ id: "image-analysis-1", status: "confirmed", analysisPayload: photoPayload() });
    repositoryMock.createAnalysisForOwner.mockResolvedValue(analysisRecord({ imageAssetId: ASSET_ID }));

    const response = await invoke(ASSET_ID, "token", { corrections: {}, finalizeToM8: true, goal: "refresh", hairType: "fine" });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.result.imageAssetId).toBe(ASSET_ID);
  });

  it("maps the photo's texture-shaped hairType field to hairTexture, never to the engine's hairType (thickness)", async () => {
    serviceMock.reviewAnalysis.mockResolvedValue({
      id: "image-analysis-1",
      status: "confirmed",
      analysisPayload: photoPayload({ hairType: "curly" }),
    });
    repositoryMock.createAnalysisForOwner.mockResolvedValue(analysisRecord());

    await invoke(ASSET_ID, "token", { corrections: {}, finalizeToM8: true, goal: "reshape", hairType: "coarse" });

    expect(repositoryMock.createAnalysisForOwner).toHaveBeenCalledWith(
      "owner-1",
      "client-1",
      expect.objectContaining({ hairType: "coarse", hairTexture: "curly" }),
    );
  });

  it("restricts a consumer requesting a technical plan the same way analysis/start does", async () => {
    prismaMock.sessionFindUnique.mockResolvedValue({
      user: { id: "owner-1", role: "consumer" },
      expiresAt: new Date(Date.now() + 60_000),
    });
    serviceMock.reviewAnalysis.mockResolvedValue({
      id: "image-analysis-1", status: "confirmed", analysisPayload: photoPayload(),
    });

    const response = await invoke(ASSET_ID, "token", { corrections: {}, finalizeToM8: true, goal: "reshape", hairType: "fine" });

    expect(response.status).toBe(403);
    expect(repositoryMock.createAnalysisForOwner).not.toHaveBeenCalled();
  });

  it("maps a client-dependency race to the existing controlled 409/404 the way analysis/start does", async () => {
    serviceMock.reviewAnalysis.mockResolvedValue({ id: "image-analysis-1", status: "confirmed", analysisPayload: photoPayload() });
    repositoryMock.createAnalysisForOwner.mockRejectedValue(
      new repositoryMock.AnalysisDependencyError("ANALYSIS_CLIENT_NOT_FOUND", 404, "Client not found."),
    );

    const response = await invoke(ASSET_ID, "token", { corrections: {}, finalizeToM8: true, goal: "refresh", hairType: "fine" });

    expect(response.status).toBe(404);
  });

  it("fails closed with a no-store 503 when the database is unavailable during finalize", async () => {
    serviceMock.reviewAnalysis.mockResolvedValue({ id: "image-analysis-1", status: "confirmed", analysisPayload: photoPayload() });
    const failure = new Error("database details");
    repositoryMock.createAnalysisForOwner.mockRejectedValue(failure);
    repositoryMock.isAnalysisPersistenceError.mockImplementation((error: unknown) => error === failure);

    const response = await invoke(ASSET_ID, "token", { corrections: {}, finalizeToM8: true, goal: "refresh", hairType: "fine" });

    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
});
