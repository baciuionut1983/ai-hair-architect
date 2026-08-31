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
const GENERATION = { id: "gen-1", ownerUserId: "owner-1", clientId: "client-1", status: "PROCESSING" };

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
  it("returns the owner-scoped generation status", async () => {
    const response = await GET(new Request("http://localhost/api"), ctx());
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.generation).toEqual(GENERATION);
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
