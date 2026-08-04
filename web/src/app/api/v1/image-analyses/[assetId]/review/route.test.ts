import { randomUUID } from "crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  sessionFindUnique: vi.fn(),
  imageAssetFindUnique: vi.fn(),
  analysisCreate: vi.fn(),
}));
const serviceMock = vi.hoisted(() => ({ reviewAnalysis: vi.fn() }));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    session: { findUnique: prismaMock.sessionFindUnique },
    imageAsset: { findUnique: prismaMock.imageAssetFindUnique },
    analysis: { create: prismaMock.analysisCreate },
  },
}));

vi.mock("@/lib/image-analysis-service", () => ({
  reviewAnalysis: serviceMock.reviewAnalysis,
}));

import { POST } from "./route";

function invoke(assetId: string, token?: string, body?: unknown): Promise<Response> {
  const request = new Request(`http://localhost/api/v1/image-analyses/${assetId}/review`, {
    method: "POST",
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body ?? { corrections: {}, finalizeToM8: false }),
  });
  return POST(request as never, { params: Promise.resolve({ assetId }) });
}

function activeSession(user: { id: string }) {
  return { user, expiresAt: new Date(Date.now() + 60_000) };
}

function expiredSession(user: { id: string }) {
  return { user, expiresAt: new Date(Date.now() - 1000) };
}

describe("POST /api/v1/image-analyses/[assetId]/review", () => {
  beforeEach(() => {
    prismaMock.sessionFindUnique.mockReset();
    prismaMock.imageAssetFindUnique.mockReset();
    prismaMock.analysisCreate.mockReset();
    serviceMock.reviewAnalysis.mockReset();
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
});
