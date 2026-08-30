import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.hoisted(() => ({ authenticateSessionRequest: vi.fn() }));
const clientRepositoryMock = vi.hoisted(() => ({ resolveOwnedClient: vi.fn() }));
const generationRepositoryMock = vi.hoisted(() => ({ findPhotoPreviewGenerationForOwner: vi.fn() }));
const executionServiceMock = vi.hoisted(() => ({ executePhotoPreviewGeneration: vi.fn() }));

vi.mock("@/lib/session-request-auth", () => authMock);
vi.mock("@/lib/client-repository", () => clientRepositoryMock);
vi.mock("@/lib/photo-preview-generation-repository", () => generationRepositoryMock);
vi.mock("@/lib/photo-preview-execution-service", () => executionServiceMock);

import { POST } from "./route";

const OWNER = { id: "owner-1", email: "owner@example.com", role: "professional", locale: "en" };
const CLIENT = { id: "client-1", ownerUserId: "owner-1" };
const GENERATION_REQUESTED = { id: "gen-1", ownerUserId: "owner-1", clientId: "client-1", spatialBindingId: "binding-1", status: "REQUESTED" };

function ctx(id = "client-1", bindingId = "binding-1", generationId = "gen-1") {
  return { params: Promise.resolve({ id, proposalId: "proposal-1", mapId: "map-1", bindingId, generationId }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  authMock.authenticateSessionRequest.mockResolvedValue(OWNER);
  clientRepositoryMock.resolveOwnedClient.mockResolvedValue(CLIENT);
  generationRepositoryMock.findPhotoPreviewGenerationForOwner.mockResolvedValue(GENERATION_REQUESTED);
});

describe("POST /photo-preview-generations/[generationId]/execute", () => {
  it("this is a real, authenticated, owner-scoped endpoint -- never an unauthenticated 'execute arbitrary id' surface", async () => {
    authMock.authenticateSessionRequest.mockResolvedValue(null);
    const response = await POST(new Request("http://localhost/api", { method: "POST" }), ctx());
    expect(response.status).toBe(401);
    expect(executionServiceMock.executePhotoPreviewGeneration).not.toHaveBeenCalled();
  });

  it("46/47. a foreign client or a generation that doesn't belong to this exact binding is a generic not-found, never executed", async () => {
    clientRepositoryMock.resolveOwnedClient.mockResolvedValue(null);
    const response = await POST(new Request("http://localhost/api", { method: "POST" }), ctx());
    expect(response.status).toBe(404);
    expect(executionServiceMock.executePhotoPreviewGeneration).not.toHaveBeenCalled();
  });

  it("52. a nonexistent generation is a generic not-found", async () => {
    generationRepositoryMock.findPhotoPreviewGenerationForOwner.mockResolvedValue(null);
    const response = await POST(new Request("http://localhost/api", { method: "POST" }), ctx());
    expect(response.status).toBe(404);
  });

  it("executes an eligible generation and returns the latest state", async () => {
    executionServiceMock.executePhotoPreviewGeneration.mockResolvedValue({ outcome: "completed", generation: { ...GENERATION_REQUESTED, status: "COMPLETED" } });
    generationRepositoryMock.findPhotoPreviewGenerationForOwner
      .mockResolvedValueOnce(GENERATION_REQUESTED) // ownership pre-check
      .mockResolvedValueOnce({ ...GENERATION_REQUESTED, status: "COMPLETED" }); // latest, after execution

    const response = await POST(new Request("http://localhost/api", { method: "POST" }), ctx());
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.generation.status).toBe("COMPLETED");
    expect(executionServiceMock.executePhotoPreviewGeneration).toHaveBeenCalledWith("gen-1", "owner-1");
  });
});
