import { randomUUID } from "crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  sessionFindUnique: vi.fn(),
  imageAssetFindUnique: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    session: { findUnique: prismaMock.sessionFindUnique },
    imageAsset: { findUnique: prismaMock.imageAssetFindUnique },
  },
}));

import { GET } from "./route";

function invoke(assetId: string, token?: string): Promise<Response> {
  const request = new Request(`http://localhost/api/v1/image-assets/${assetId}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  return GET(request as never, { params: Promise.resolve({ id: assetId }) });
}

function activeSession(user: { id: string }) {
  return { user, expiresAt: new Date(Date.now() + 60_000) };
}

function expiredSession(user: { id: string }) {
  return { user, expiresAt: new Date(Date.now() - 1000) };
}

describe("GET /api/v1/image-assets/[id]", () => {
  beforeEach(() => {
    prismaMock.sessionFindUnique.mockReset();
    prismaMock.imageAssetFindUnique.mockReset();
  });

  it("returns 401 without a bearer token, never touching the asset lookup", async () => {
    const response = await invoke(randomUUID());
    expect(response.status).toBe(401);
    expect(prismaMock.imageAssetFindUnique).not.toHaveBeenCalled();
  });

  it("returns 401 for an unknown session token", async () => {
    prismaMock.sessionFindUnique.mockResolvedValue(null);
    const response = await invoke(randomUUID(), "bogus-token");
    expect(response.status).toBe(401);
    expect(prismaMock.imageAssetFindUnique).not.toHaveBeenCalled();
  });

  it("returns 401 for an expired session and never reaches the asset lookup", async () => {
    const userId = randomUUID();
    prismaMock.sessionFindUnique.mockResolvedValue(expiredSession({ id: userId }));

    const response = await invoke(randomUUID(), "token");

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
    expect(prismaMock.imageAssetFindUnique).not.toHaveBeenCalled();
  });

  it("preserves existing behavior for a valid session: returns the asset unchanged", async () => {
    const userId = randomUUID();
    const assetId = "asset-1";
    const asset = { id: assetId, ownerUserId: userId, deletedAt: null, fileName: "photo.jpg" };
    prismaMock.sessionFindUnique.mockResolvedValue(activeSession({ id: userId }));
    prismaMock.imageAssetFindUnique.mockResolvedValue(asset);

    const response = await invoke(assetId, "token");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ asset });
  });

  it("returns 403 when the asset does not belong to the authenticated owner (ownership regression)", async () => {
    const userId = randomUUID();
    prismaMock.sessionFindUnique.mockResolvedValue(activeSession({ id: userId }));
    prismaMock.imageAssetFindUnique.mockResolvedValue({
      id: "asset-1",
      ownerUserId: "someone-else",
      deletedAt: null,
    });

    const response = await invoke("asset-1", "token");
    expect(response.status).toBe(403);
  });

  it("returns 410 for a soft-deleted asset (existing behavior preserved)", async () => {
    const userId = randomUUID();
    prismaMock.sessionFindUnique.mockResolvedValue(activeSession({ id: userId }));
    prismaMock.imageAssetFindUnique.mockResolvedValue({
      id: "asset-1",
      ownerUserId: userId,
      deletedAt: new Date(),
    });

    const response = await invoke("asset-1", "token");
    expect(response.status).toBe(410);
  });

  it("returns 404 for an absent asset", async () => {
    const userId = randomUUID();
    prismaMock.sessionFindUnique.mockResolvedValue(activeSession({ id: userId }));
    prismaMock.imageAssetFindUnique.mockResolvedValue(null);

    const response = await invoke("asset-1", "token");
    expect(response.status).toBe(404);
  });
});
