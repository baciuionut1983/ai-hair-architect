import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.hoisted(() => ({ authenticateSessionRequest: vi.fn() }));
const clientRepositoryMock = vi.hoisted(() => ({ resolveOwnedClient: vi.fn() }));
const generationRepositoryMock = vi.hoisted(() => ({ findVideoDemonstrationGenerationForOwner: vi.fn() }));
const executionServiceMock = vi.hoisted(() => ({ executeVideoDemonstrationGeneration: vi.fn() }));

vi.mock("@/lib/session-request-auth", () => authMock);
vi.mock("@/lib/client-repository", () => clientRepositoryMock);
vi.mock("@/lib/video-generation-repository", () => generationRepositoryMock);
vi.mock("@/lib/video-generation-execution-service", () => executionServiceMock);

import { POST } from "./route";

const OWNER = { id: "owner-1", email: "owner@example.com", role: "professional", locale: "en" };
const CLIENT = { id: "client-1", ownerUserId: "owner-1" };
const GENERATION_PROCESSING = { id: "gen-1", ownerUserId: "owner-1", clientId: "client-1", status: "PROCESSING", providerOperationId: "op-1" };
const GENERATION_COMPLETED = { ...GENERATION_PROCESSING, status: "COMPLETED", generatedVideoAssetId: "asset-1" };

function ctx(id = "client-1", generationId = "gen-1") {
  return { params: Promise.resolve({ id, generationId }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  authMock.authenticateSessionRequest.mockResolvedValue(OWNER);
  clientRepositoryMock.resolveOwnedClient.mockResolvedValue(CLIENT);
  generationRepositoryMock.findVideoDemonstrationGenerationForOwner.mockResolvedValue(GENERATION_PROCESSING);
});

describe("POST /clients/[id]/video-demonstrations/[generationId]/execute", () => {
  it("advances a PROCESSING generation (polls the existing operation) and returns the latest state", async () => {
    executionServiceMock.executeVideoDemonstrationGeneration.mockResolvedValue({ outcome: "completed", generation: GENERATION_COMPLETED });
    generationRepositoryMock.findVideoDemonstrationGenerationForOwner
      .mockResolvedValueOnce(GENERATION_PROCESSING) // pre-check
      .mockResolvedValueOnce(GENERATION_COMPLETED); // latest, after execution

    const response = await POST(new Request("http://localhost/api", { method: "POST" }), ctx());
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.generation.status).toBe("COMPLETED");
    expect(body.executionOutcome.outcome).toBe("completed");
    expect(executionServiceMock.executeVideoDemonstrationGeneration).toHaveBeenCalledWith("gen-1", "owner-1");
  });

  it("an unauthenticated request is blocked with 401, never reaching the execution service", async () => {
    authMock.authenticateSessionRequest.mockResolvedValue(null);
    const response = await POST(new Request("http://localhost/api", { method: "POST" }), ctx());
    expect(response.status).toBe(401);
    expect(executionServiceMock.executeVideoDemonstrationGeneration).not.toHaveBeenCalled();
  });

  it("a foreign client is blocked with a generic 404, never reaching the execution service", async () => {
    clientRepositoryMock.resolveOwnedClient.mockResolvedValue(null);
    const response = await POST(new Request("http://localhost/api", { method: "POST" }), ctx());
    expect(response.status).toBe(404);
    expect(executionServiceMock.executeVideoDemonstrationGeneration).not.toHaveBeenCalled();
  });

  it("a nonexistent generation id is blocked with a generic 404, never reaching the execution service -- no unauthenticated 'execute arbitrary id' path exists", async () => {
    generationRepositoryMock.findVideoDemonstrationGenerationForOwner.mockResolvedValue(null);
    const response = await POST(new Request("http://localhost/api", { method: "POST" }), ctx());
    expect(response.status).toBe(404);
    expect(executionServiceMock.executeVideoDemonstrationGeneration).not.toHaveBeenCalled();
  });

  it("Stage 2 security: a request body attempting to inject a providerOperationId / result URL / generatedVideoAssetId is completely ignored -- the server is the only authority", async () => {
    executionServiceMock.executeVideoDemonstrationGeneration.mockResolvedValue({ outcome: "still_processing", generation: GENERATION_PROCESSING });

    const maliciousBody = JSON.stringify({
      providerOperationId: "attacker-controlled-operation-id",
      generatedVideoAssetId: "attacker-controlled-asset-id",
      resultUrl: "https://attacker.example/fake-video.mp4",
      status: "COMPLETED",
    });
    const response = await POST(new Request("http://localhost/api", { method: "POST", body: maliciousBody }), ctx());

    expect(response.status).toBe(200);
    // The execution service is called with ONLY the URL-resolved
    // generationId and the authenticated ownerUserId -- nothing from the
    // request body is ever threaded through.
    expect(executionServiceMock.executeVideoDemonstrationGeneration).toHaveBeenCalledWith("gen-1", "owner-1");
    expect(executionServiceMock.executeVideoDemonstrationGeneration).toHaveBeenCalledTimes(1);
  });
});
