import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.hoisted(() => ({ authenticateSessionRequest: vi.fn() }));
const clientRepositoryMock = vi.hoisted(() => ({ resolveOwnedClient: vi.fn() }));
const generationRepositoryMock = vi.hoisted(() => ({ findVideoDemonstrationGenerationForOwner: vi.fn() }));

vi.mock("@/lib/session-request-auth", () => authMock);
vi.mock("@/lib/client-repository", () => clientRepositoryMock);
vi.mock("@/lib/video-generation-repository", () => generationRepositoryMock);

import { GET } from "./route";

const OWNER = { id: "owner-1", email: "owner@example.com", role: "professional", locale: "en" };
const CLIENT = { id: "client-1", ownerUserId: "owner-1" };
const GENERATION = {
  id: "gen-1",
  ownerUserId: "owner-1",
  clientId: "client-1",
  photoPreviewGenerationId: "pp-1",
  status: "PROCESSING",
  variationIndex: 0,
  providerOperationId: "op-internal-should-never-leak",
  sealedRequest: { schemaVersion: "1.0.0" },
  requestedAt: "2026-08-29T10:00:00.000Z",
  startedAt: "2026-08-29T10:00:05.000Z",
  submittedAt: "2026-08-29T10:00:06.000Z",
  completedAt: null,
  failedAt: null,
  errorCode: null,
  errorMetadata: null,
  generatedVideoAssetId: null,
};

function ctx(id = "client-1", generationId = "gen-1") {
  return { params: Promise.resolve({ id, generationId }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  authMock.authenticateSessionRequest.mockResolvedValue(OWNER);
  clientRepositoryMock.resolveOwnedClient.mockResolvedValue(CLIENT);
  generationRepositoryMock.findVideoDemonstrationGenerationForOwner.mockResolvedValue(GENERATION);
});

describe("GET /clients/[id]/video-demonstrations/[generationId]", () => {
  it("returns the safe status view -- stable, minimal contract, no internal fields", async () => {
    const response = await GET(new Request("http://localhost/api"), ctx());
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.generation).toEqual({
      id: "gen-1",
      photoPreviewGenerationId: "pp-1",
      clientId: "client-1",
      status: "PROCESSING",
      variationIndex: 0,
      createdAt: "2026-08-29T10:00:00.000Z",
      processingStartedAt: "2026-08-29T10:00:05.000Z",
      completedAt: null,
      failedAt: null,
      failureMessage: null,
      resultAsset: null,
      retryEligible: false,
    });
  });

  it("Stage 3 security: never exposes providerOperationId, sealedRequest, ownerUserId, or raw errorMetadata", async () => {
    const response = await GET(new Request("http://localhost/api"), ctx());
    const body = await response.json();
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("providerOperationId");
    expect(serialized).not.toContain("op-internal-should-never-leak");
    expect(serialized).not.toContain("sealedRequest");
    expect(serialized).not.toContain("ownerUserId");
    expect(serialized).not.toContain("errorMetadata");
  });

  it("an unauthenticated request is blocked with 401", async () => {
    authMock.authenticateSessionRequest.mockResolvedValue(null);
    const response = await GET(new Request("http://localhost/api"), ctx());
    expect(response.status).toBe(401);
    expect(generationRepositoryMock.findVideoDemonstrationGenerationForOwner).not.toHaveBeenCalled();
  });

  it("a foreign client is blocked with a generic 404", async () => {
    clientRepositoryMock.resolveOwnedClient.mockResolvedValue(null);
    const response = await GET(new Request("http://localhost/api"), ctx());
    expect(response.status).toBe(404);
  });

  it("a nonexistent generation id resolves to a generic 404", async () => {
    generationRepositoryMock.findVideoDemonstrationGenerationForOwner.mockResolvedValue(null);
    const response = await GET(new Request("http://localhost/api"), ctx());
    expect(response.status).toBe(404);
  });

  it("a generation belonging to a different client under the same owner resolves to a generic 404 -- never leaks it exists", async () => {
    generationRepositoryMock.findVideoDemonstrationGenerationForOwner.mockResolvedValue({ ...GENERATION, clientId: "some-other-client" });
    const response = await GET(new Request("http://localhost/api"), ctx());
    expect(response.status).toBe(404);
  });
});
