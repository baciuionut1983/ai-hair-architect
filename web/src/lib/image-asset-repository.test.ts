import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMocks = vi.hoisted(() => ({
  configured: true,
  imageAssetFindMany: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  isDatabaseConfigured: () => prismaMocks.configured,
  prisma: {
    imageAsset: { findMany: prismaMocks.imageAssetFindMany },
  },
}));

import {
  ImageAssetPersistenceError,
  imageAssetPersistenceUnavailableResponse,
  isImageAssetPersistenceError,
  listEligibleSpatialSourceImagesForClient,
  listImageAssetPhotosForClient,
} from "@/lib/image-asset-repository";

function assetRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "asset-1",
    clientId: "client-1",
    ownerUserId: "owner-1",
    fileName: "before.jpg",
    mimeType: "image/jpeg",
    sizeBytes: 12345,
    uploadedAt: new Date("2026-08-10T10:00:00.000Z"),
    deletedAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  prismaMocks.configured = true;
  prismaMocks.imageAssetFindMany.mockReset();
});

// Regression: a client's real, correctly-uploaded photo (written to
// ImageAsset by the actual analysis-upload pipeline) never appeared in the
// History tab, because History only ever read the separate, practically
// unreachable ClientPhoto table. These lock in that ImageAsset rows are
// surfaced here as History-tab-compatible photo records.
describe("listImageAssetPhotosForClient", () => {
  it("maps an ImageAsset row into a ClientPhotoRecord-shaped photo, pointing at the authenticated content endpoint", async () => {
    prismaMocks.imageAssetFindMany.mockResolvedValue([assetRow()]);

    const result = await listImageAssetPhotosForClient("owner-1", "client-1");

    expect(result).toEqual([
      {
        id: "asset-1",
        clientId: "client-1",
        imageUrl: "/api/v1/image-assets/asset-1/content",
        caption: "",
        createdAt: "2026-08-10T10:00:00.000Z",
      },
    ]);
  });

  it("never includes a storage key, bucket, or storage path -- only the content endpoint path", async () => {
    prismaMocks.imageAssetFindMany.mockResolvedValue([assetRow({ storagePath: "s3://secret-bucket/key" })]);

    const [photo] = await listImageAssetPhotosForClient("owner-1", "client-1");

    expect(photo.imageUrl).not.toContain("s3://");
    expect(photo.imageUrl).not.toContain("secret-bucket");
    expect(photo.imageUrl).toBe("/api/v1/image-assets/asset-1/content");
  });

  it("scopes the query strictly by ownerUserId and clientId, and excludes soft-deleted/purged assets", async () => {
    prismaMocks.imageAssetFindMany.mockResolvedValue([]);

    await listImageAssetPhotosForClient("owner-1", "client-1");

    expect(prismaMocks.imageAssetFindMany).toHaveBeenCalledWith({
      where: { ownerUserId: "owner-1", clientId: "client-1", deletedAt: null },
      orderBy: [{ uploadedAt: "desc" }, { id: "desc" }],
    });
  });

  it("isolates listing between clients: a different client's images are never included (query-scoped, not filtered client-side)", async () => {
    prismaMocks.imageAssetFindMany.mockResolvedValue([]);

    await listImageAssetPhotosForClient("owner-1", "client-2");

    expect(prismaMocks.imageAssetFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ clientId: "client-2" }) }),
    );
  });

  it("isolates listing between owners: a different owner's images are never included", async () => {
    prismaMocks.imageAssetFindMany.mockResolvedValue([]);

    await listImageAssetPhotosForClient("owner-2", "client-1");

    expect(prismaMocks.imageAssetFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ ownerUserId: "owner-2" }) }),
    );
  });

  it("fails closed when the database is not configured", async () => {
    prismaMocks.configured = false;
    await expect(listImageAssetPhotosForClient("owner-1", "client-1")).rejects.toBeInstanceOf(ImageAssetPersistenceError);
    expect(prismaMocks.imageAssetFindMany).not.toHaveBeenCalled();
  });

  it("sanitizes unexpected Prisma failures", async () => {
    prismaMocks.imageAssetFindMany.mockRejectedValue(new Error("password=secret host=internal"));
    await expect(listImageAssetPhotosForClient("owner-1", "client-1")).rejects.toMatchObject({
      code: "IMAGE_ASSET_PERSISTENCE_UNAVAILABLE",
      httpStatus: 503,
      message: "Image asset data is temporarily unavailable.",
    });
  });

  it("exposes the standardized no-store error response and the type guard", () => {
    expect(isImageAssetPersistenceError(new ImageAssetPersistenceError())).toBe(true);
    expect(isImageAssetPersistenceError(new Error("other"))).toBe(false);

    const response = imageAssetPersistenceUnavailableResponse();
    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
});

describe("listEligibleSpatialSourceImagesForClient", () => {
  it("returns only assets with known width/height, mapped to the eligible-image shape", async () => {
    prismaMocks.imageAssetFindMany.mockResolvedValue([assetRow({ width: 1080, height: 1440 })]);

    const result = await listEligibleSpatialSourceImagesForClient("owner-1", "client-1");

    expect(result).toEqual([
      {
        id: "asset-1",
        fileName: "before.jpg",
        width: 1080,
        height: 1440,
        uploadedAt: "2026-08-10T10:00:00.000Z",
        imageUrl: "/api/v1/image-assets/asset-1/content",
      },
    ]);
  });

  it("filters out assets with null width/height at the query level, not client-side", async () => {
    prismaMocks.imageAssetFindMany.mockResolvedValue([]);

    await listEligibleSpatialSourceImagesForClient("owner-1", "client-1");

    expect(prismaMocks.imageAssetFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ width: { not: null }, height: { not: null } }),
      }),
    );
  });

  it("scopes strictly by owner and client, and excludes soft-deleted assets", async () => {
    prismaMocks.imageAssetFindMany.mockResolvedValue([]);
    await listEligibleSpatialSourceImagesForClient("owner-1", "client-1");
    expect(prismaMocks.imageAssetFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ ownerUserId: "owner-1", clientId: "client-1", deletedAt: null }) }),
    );
  });

  it("never includes a storage key, bucket, or storage path", async () => {
    prismaMocks.imageAssetFindMany.mockResolvedValue([assetRow({ width: 640, height: 480, storagePath: "s3://secret-bucket/key" })]);
    const [image] = await listEligibleSpatialSourceImagesForClient("owner-1", "client-1");
    expect(image.imageUrl).not.toContain("s3://");
  });

  it("fails closed when the database is not configured", async () => {
    prismaMocks.configured = false;
    await expect(listEligibleSpatialSourceImagesForClient("owner-1", "client-1")).rejects.toBeInstanceOf(ImageAssetPersistenceError);
  });
});
