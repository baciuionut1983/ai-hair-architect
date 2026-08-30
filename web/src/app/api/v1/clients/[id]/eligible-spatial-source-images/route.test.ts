import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.hoisted(() => ({ authenticateSessionRequest: vi.fn() }));
const clientRepositoryMock = vi.hoisted(() => ({ resolveOwnedClient: vi.fn() }));
const imageAssetRepositoryMock = vi.hoisted(() => {
  class ImageAssetPersistenceError extends Error {
    readonly code = "IMAGE_ASSET_PERSISTENCE_UNAVAILABLE";
    readonly httpStatus = 503;
    constructor() {
      super("Image asset data is temporarily unavailable.");
      this.name = "ImageAssetPersistenceError";
    }
  }
  return {
    ImageAssetPersistenceError,
    isImageAssetPersistenceError: (e: unknown) => e instanceof ImageAssetPersistenceError,
    imageAssetPersistenceUnavailableResponse: () =>
      Response.json({ error: "IMAGE_ASSET_PERSISTENCE_UNAVAILABLE" }, { status: 503, headers: { "Cache-Control": "no-store" } }),
    listEligibleSpatialSourceImagesForClient: vi.fn(),
  };
});

vi.mock("@/lib/session-request-auth", () => authMock);
vi.mock("@/lib/client-repository", () => clientRepositoryMock);
vi.mock("@/lib/image-asset-repository", () => imageAssetRepositoryMock);

import { GET } from "./route";

const OWNER = { id: "owner-1", email: "owner@example.com", role: "professional", locale: "en" };
const CLIENT = { id: "client-1", ownerUserId: "owner-1", fullName: "Jane", email: "", phone: "", notes: "", createdAt: "", updatedAt: "" };
const IMAGE = { id: "asset-1", fileName: "photo.jpg", width: 1080, height: 1440, uploadedAt: "2026-08-10T00:00:00.000Z", imageUrl: "/api/v1/image-assets/asset-1/content" };

function ctx(id = "client-1") {
  return { params: Promise.resolve({ id }) };
}
function req(): Request {
  return new Request("http://localhost/api/v1/clients/client-1/eligible-spatial-source-images");
}

beforeEach(() => {
  vi.clearAllMocks();
  authMock.authenticateSessionRequest.mockResolvedValue(OWNER);
  clientRepositoryMock.resolveOwnedClient.mockResolvedValue(CLIENT);
  imageAssetRepositoryMock.listEligibleSpatialSourceImagesForClient.mockResolvedValue([IMAGE]);
});

describe("GET /api/v1/clients/[id]/eligible-spatial-source-images", () => {
  it("returns 401 without a session", async () => {
    authMock.authenticateSessionRequest.mockResolvedValue(null);
    const response = await GET(req(), ctx());
    expect(response.status).toBe(401);
    expect(imageAssetRepositoryMock.listEligibleSpatialSourceImagesForClient).not.toHaveBeenCalled();
  });

  it("returns 404 for a foreign/nonexistent client", async () => {
    clientRepositoryMock.resolveOwnedClient.mockResolvedValue(null);
    const response = await GET(req(), ctx());
    expect(response.status).toBe(404);
  });

  it("returns the eligible images for the exact owned client", async () => {
    const response = await GET(req(), ctx());
    expect(response.status).toBe(200);
    expect(imageAssetRepositoryMock.listEligibleSpatialSourceImagesForClient).toHaveBeenCalledWith("owner-1", "client-1");
    expect(await response.json()).toEqual({ images: [IMAGE] });
  });

  it("fails closed with a no-store 503 on persistence failure", async () => {
    imageAssetRepositoryMock.listEligibleSpatialSourceImagesForClient.mockRejectedValue(
      new imageAssetRepositoryMock.ImageAssetPersistenceError(),
    );
    const response = await GET(req(), ctx());
    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
});
