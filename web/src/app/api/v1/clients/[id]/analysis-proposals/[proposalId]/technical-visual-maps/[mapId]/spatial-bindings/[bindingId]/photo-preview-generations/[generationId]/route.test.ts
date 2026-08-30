import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.hoisted(() => ({ authenticateSessionRequest: vi.fn() }));
const clientRepositoryMock = vi.hoisted(() => ({ resolveOwnedClient: vi.fn() }));
const generationRepositoryMock = vi.hoisted(() => ({ findPhotoPreviewGenerationForOwner: vi.fn() }));

vi.mock("@/lib/session-request-auth", () => authMock);
vi.mock("@/lib/client-repository", () => clientRepositoryMock);
vi.mock("@/lib/photo-preview-generation-repository", () => generationRepositoryMock);

import { GET } from "./route";

const OWNER = { id: "owner-1", email: "owner@example.com", role: "professional", locale: "en" };
const CLIENT = { id: "client-1", ownerUserId: "owner-1" };
const GENERATION = {
  id: "gen-1",
  ownerUserId: "owner-1",
  clientId: "client-1",
  spatialBindingId: "binding-1",
  status: "COMPLETED",
  generatedImageAssetId: "asset-gen-1",
  provider: "gemini",
  model: "gemini-3.1-flash-image",
};

function ctx(id = "client-1", bindingId = "binding-1", generationId = "gen-1") {
  return { params: Promise.resolve({ id, proposalId: "proposal-1", mapId: "map-1", bindingId, generationId }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  authMock.authenticateSessionRequest.mockResolvedValue(OWNER);
  clientRepositoryMock.resolveOwnedClient.mockResolvedValue(CLIENT);
});

describe("GET /photo-preview-generations/[generationId]", () => {
  it("50. status read is owner-scoped and returns the generation, incl. a safe reference to the generated image", async () => {
    generationRepositoryMock.findPhotoPreviewGenerationForOwner.mockResolvedValue(GENERATION);
    const response = await GET(new Request("http://localhost/api"), ctx());
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.generation.generatedImageAssetId).toBe("asset-gen-1");
    // 26/32: never leaks storage credentials/internal object-storage fields.
    expect(JSON.stringify(body)).not.toMatch(/storageKey|storageBucketAlias|apiKey|accessKey/i);
  });

  it("45. unauthenticated status reads are blocked", async () => {
    authMock.authenticateSessionRequest.mockResolvedValue(null);
    const response = await GET(new Request("http://localhost/api"), ctx());
    expect(response.status).toBe(401);
  });

  it("52. a foreign-owner or nonexistent generation returns the same generic not-found", async () => {
    generationRepositoryMock.findPhotoPreviewGenerationForOwner.mockResolvedValue(null);
    const notFound = await GET(new Request("http://localhost/api"), ctx());
    expect(notFound.status).toBe(404);

    generationRepositoryMock.findPhotoPreviewGenerationForOwner.mockResolvedValue({ ...GENERATION, clientId: "other-client" });
    const mismatched = await GET(new Request("http://localhost/api"), ctx());
    expect(mismatched.status).toBe(404);
    expect((await notFound.json()).error).toBe((await mismatched.json()).error);
  });

  it("53. a failed generation's status exposes only the safe application error code, never a raw provider response", async () => {
    generationRepositoryMock.findPhotoPreviewGenerationForOwner.mockResolvedValue({
      ...GENERATION,
      status: "FAILED",
      errorCode: "PHOTO_PREVIEW_PROVIDER_REFUSED",
      errorMetadata: { message: "Gemini declined to generate an image (SAFETY)." },
    });
    const response = await GET(new Request("http://localhost/api"), ctx());
    const body = await response.json();
    expect(body.generation.errorCode).toBe("PHOTO_PREVIEW_PROVIDER_REFUSED");
    expect(JSON.stringify(body)).not.toMatch(/stack|Authorization:|Bearer /i);
  });
});
