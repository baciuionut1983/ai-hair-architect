import { randomUUID } from "crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  sessionFindUnique: vi.fn(),
  imageAssetFindUnique: vi.fn(),
  imageAssetUpdate: vi.fn(),
}));
const storageMock = vi.hoisted(() => ({ deleteImageFile: vi.fn() }));

vi.mock("@/lib/prisma", () => ({
  isDatabaseConfigured: () => true,
  prisma: {
    session: { findUnique: prismaMock.sessionFindUnique },
    imageAsset: { findUnique: prismaMock.imageAssetFindUnique, update: prismaMock.imageAssetUpdate },
  },
}));

vi.mock("@/lib/image-storage", () => ({
  deleteImageFile: storageMock.deleteImageFile,
}));

import { GET, DELETE } from "./route";
import type { NextRequest } from "next/server";

function invoke(
  handler: (req: NextRequest, ctx: { params: Promise<{ assetId: string }> }) => Promise<Response>,
  assetId: string,
  token?: string,
  cookie?: string,
): Promise<Response> {
  const request = new Request(`http://localhost/api/v1/image-analyses/${assetId}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  attachCookies(request, cookie);
  return handler(request as never, { params: Promise.resolve({ assetId }) });
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

describe("GET /api/v1/image-analyses/[assetId]", () => {
  beforeEach(() => {
    prismaMock.sessionFindUnique.mockReset();
    prismaMock.imageAssetFindUnique.mockReset();
  });

  it("returns 401 without a bearer token, never touching the asset lookup", async () => {
    const response = await invoke(GET, randomUUID());
    expect(response.status).toBe(401);
    expect(prismaMock.imageAssetFindUnique).not.toHaveBeenCalled();
  });

  it("returns 401 for an unknown session token", async () => {
    prismaMock.sessionFindUnique.mockResolvedValue(null);
    const response = await invoke(GET, randomUUID(), "bogus-token");
    expect(response.status).toBe(401);
  });

  it("returns 401 for an expired session and never reaches the asset lookup", async () => {
    const userId = randomUUID();
    prismaMock.sessionFindUnique.mockResolvedValue(expiredSession({ id: userId }));

    const response = await invoke(GET, randomUUID(), "token");

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
    expect(prismaMock.imageAssetFindUnique).not.toHaveBeenCalled();
  });

  it("preserves existing behavior for a valid session: returns the asset and analyses", async () => {
    const userId = randomUUID();
    const assetId = "asset-1";
    prismaMock.sessionFindUnique.mockResolvedValue(activeSession({ id: userId }));
    prismaMock.imageAssetFindUnique.mockResolvedValue({
      id: assetId,
      ownerUserId: userId,
      fileName: "photo.jpg",
      uploadedAt: "2026-08-01T00:00:00.000Z",
      analyses: [],
    });

    const response = await invoke(GET, assetId, "token");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      asset: { id: assetId, fileName: "photo.jpg", uploadedAt: "2026-08-01T00:00:00.000Z" },
      analyses: [],
    });
  });

  it("returns 403 when the asset does not belong to the authenticated owner", async () => {
    const userId = randomUUID();
    prismaMock.sessionFindUnique.mockResolvedValue(activeSession({ id: userId }));
    prismaMock.imageAssetFindUnique.mockResolvedValue({
      id: "asset-1",
      ownerUserId: "someone-else",
      fileName: "photo.jpg",
      uploadedAt: "2026-08-01T00:00:00.000Z",
      analyses: [],
    });

    const response = await invoke(GET, "asset-1", "token");
    expect(response.status).toBe(403);
  });

  it("accepts a valid Postgres-backed cookie session (M31 GO-4 dual resolver)", async () => {
    const userId = randomUUID();
    const assetId = "asset-1";
    prismaMock.sessionFindUnique.mockResolvedValue({ expiresAt: new Date(Date.now() + 60_000), user: fullUser(userId) });
    prismaMock.imageAssetFindUnique.mockResolvedValue({
      id: assetId,
      ownerUserId: userId,
      fileName: "photo.jpg",
      uploadedAt: "2026-08-01T00:00:00.000Z",
      analyses: [],
    });

    const response = await invoke(GET, assetId, undefined, "cookie-token");

    expect(response.status).toBe(200);
  });

  it("rejects an expired cookie session with no fallback to the in-memory session store", async () => {
    prismaMock.sessionFindUnique.mockResolvedValue({ expiresAt: new Date(Date.now() - 1000), user: fullUser(randomUUID()) });

    const response = await invoke(GET, "asset-1", undefined, "expired-cookie-token");

    expect(response.status).toBe(401);
    expect(prismaMock.imageAssetFindUnique).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/v1/image-analyses/[assetId]", () => {
  beforeEach(() => {
    prismaMock.sessionFindUnique.mockReset();
    prismaMock.imageAssetFindUnique.mockReset();
    prismaMock.imageAssetUpdate.mockReset();
    storageMock.deleteImageFile.mockReset();
  });

  it("returns 401 without a bearer token, never touching the asset lookup or file deletion", async () => {
    const response = await invoke(DELETE, randomUUID());
    expect(response.status).toBe(401);
    expect(prismaMock.imageAssetFindUnique).not.toHaveBeenCalled();
    expect(storageMock.deleteImageFile).not.toHaveBeenCalled();
  });

  it("returns 401 for an unknown session token", async () => {
    prismaMock.sessionFindUnique.mockResolvedValue(null);
    const response = await invoke(DELETE, randomUUID(), "bogus-token");
    expect(response.status).toBe(401);
  });

  it("returns 401 for an expired session and never reaches the asset lookup, file deletion, or update", async () => {
    const userId = randomUUID();
    prismaMock.sessionFindUnique.mockResolvedValue(expiredSession({ id: userId }));

    const response = await invoke(DELETE, randomUUID(), "token");

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
    expect(prismaMock.imageAssetFindUnique).not.toHaveBeenCalled();
    expect(storageMock.deleteImageFile).not.toHaveBeenCalled();
    expect(prismaMock.imageAssetUpdate).not.toHaveBeenCalled();
  });

  it("preserves existing behavior for a valid session: soft-deletes the asset", async () => {
    const userId = randomUUID();
    const assetId = "asset-1";
    prismaMock.sessionFindUnique.mockResolvedValue(activeSession({ id: userId }));
    prismaMock.imageAssetFindUnique.mockResolvedValue({ id: assetId, ownerUserId: userId, storagePath: "/x/photo.jpg" });
    storageMock.deleteImageFile.mockResolvedValue(undefined);
    prismaMock.imageAssetUpdate.mockResolvedValue({});

    const response = await invoke(DELETE, assetId, "token");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true });
    expect(storageMock.deleteImageFile).toHaveBeenCalledWith("/x/photo.jpg");
  });

  it("returns 403 when the asset does not belong to the authenticated owner, never deleting the file", async () => {
    const userId = randomUUID();
    prismaMock.sessionFindUnique.mockResolvedValue(activeSession({ id: userId }));
    prismaMock.imageAssetFindUnique.mockResolvedValue({ id: "asset-1", ownerUserId: "someone-else", storagePath: "/x/photo.jpg" });

    const response = await invoke(DELETE, "asset-1", "token");

    expect(response.status).toBe(403);
    expect(storageMock.deleteImageFile).not.toHaveBeenCalled();
  });

  it("accepts a valid Postgres-backed cookie session (M31 GO-4 dual resolver)", async () => {
    const userId = randomUUID();
    const assetId = "asset-1";
    prismaMock.sessionFindUnique.mockResolvedValue({ expiresAt: new Date(Date.now() + 60_000), user: fullUser(userId) });
    prismaMock.imageAssetFindUnique.mockResolvedValue({ id: assetId, ownerUserId: userId, storagePath: "/x/photo.jpg" });
    storageMock.deleteImageFile.mockResolvedValue(undefined);
    prismaMock.imageAssetUpdate.mockResolvedValue({});

    const response = await invoke(DELETE, assetId, undefined, "cookie-token");

    expect(response.status).toBe(200);
  });

  it("rejects an expired cookie session with no fallback to the in-memory session store", async () => {
    prismaMock.sessionFindUnique.mockResolvedValue({ expiresAt: new Date(Date.now() - 1000), user: fullUser(randomUUID()) });

    const response = await invoke(DELETE, "asset-1", undefined, "expired-cookie-token");

    expect(response.status).toBe(401);
    expect(storageMock.deleteImageFile).not.toHaveBeenCalled();
  });
});
