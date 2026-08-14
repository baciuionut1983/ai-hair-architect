import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.hoisted(() => ({ authenticateSessionRequest: vi.fn() }));
const clientRepoMock = vi.hoisted(() => ({ resolveOwnedClient: vi.fn() }));
const hardeningMock = vi.hoisted(() => ({ checkRateLimit: vi.fn() }));
const memoryRepoMock = vi.hoisted(() => {
  class ProfessionalMemoryValidationError extends Error {
    readonly code = "PROFESSIONAL_MEMORY_VALIDATION_FAILED";
    readonly httpStatus = 400;
    constructor(message: string) {
      super(message);
    }
  }

  return {
    createConfirmedMemory: vi.fn(),
    revokeMemory: vi.fn(),
    isProfessionalMemoryPersistenceError: vi.fn(() => false),
    professionalMemoryPersistenceUnavailableResponse: vi.fn(() =>
      Response.json({ error: "PROFESSIONAL_MEMORY_PERSISTENCE_UNAVAILABLE" }, { status: 503, headers: { "Cache-Control": "no-store" } }),
    ),
    ProfessionalMemoryValidationError,
  };
});

vi.mock("@/lib/session-request-auth", () => authMock);
vi.mock("@/lib/client-repository", () => clientRepoMock);
vi.mock("@/lib/hardening", () => hardeningMock);
vi.mock("@/lib/professional-memory-repository", () => memoryRepoMock);

import { DELETE, POST } from "./route";

const OWNER = { id: "owner-1", email: "owner@example.com", role: "professional", locale: "en" };
const CLIENT = { id: "client-1", ownerUserId: "owner-1", fullName: "Jane Doe", email: "", phone: "", notes: "", createdAt: "", updatedAt: "" };

function invokePost(id: string, body: unknown): Promise<Response> {
  return POST(
    new Request(`http://localhost/api/v1/clients/${id}/memories`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );
}

function invokeDelete(memoryId: string | null): Promise<Response> {
  const url = memoryId ? `http://localhost/api/v1/clients/client-1/memories?memoryId=${memoryId}` : "http://localhost/api/v1/clients/client-1/memories";
  return DELETE(new Request(url));
}

beforeEach(() => {
  vi.clearAllMocks();
  authMock.authenticateSessionRequest.mockResolvedValue(OWNER);
  clientRepoMock.resolveOwnedClient.mockResolvedValue(CLIENT);
  hardeningMock.checkRateLimit.mockReturnValue({ allowed: true, remaining: 19 });
  memoryRepoMock.createConfirmedMemory.mockResolvedValue({
    id: "memory-1",
    scope: "client_specific",
    kind: "fact",
    content: "Uses 6% developer.",
    confidence: 1,
    source: "typed",
    clientId: "client-1",
    createdAt: "2026-08-14T10:00:00.000Z",
  });
  memoryRepoMock.revokeMemory.mockResolvedValue(true);
  memoryRepoMock.isProfessionalMemoryPersistenceError.mockReturnValue(false);
});

describe("POST /api/v1/clients/[id]/memories", () => {
  it("returns 401 without a cookie, touching nothing else", async () => {
    authMock.authenticateSessionRequest.mockResolvedValue(null);

    const response = await invokePost("client-1", { action: "save_client_memory", content: "x", confirmed: true });

    expect(response.status).toBe(401);
    expect(memoryRepoMock.createConfirmedMemory).not.toHaveBeenCalled();
  });

  it("returns 429 when the rate limit is exceeded", async () => {
    hardeningMock.checkRateLimit.mockReturnValue({ allowed: false, remaining: 0 });

    const response = await invokePost("client-1", { action: "save_client_memory", content: "x", confirmed: true });

    expect(response.status).toBe(429);
    expect(memoryRepoMock.createConfirmedMemory).not.toHaveBeenCalled();
  });

  it("returns 404 for a foreign/nonexistent client -- P: cross-owner isolation enforced before any memory logic runs", async () => {
    clientRepoMock.resolveOwnedClient.mockResolvedValue(null);

    const response = await invokePost("foreign-client", { action: "save_client_memory", content: "x", confirmed: true });

    expect(response.status).toBe(404);
    expect(memoryRepoMock.createConfirmedMemory).not.toHaveBeenCalled();
  });

  it("returns 400 for an unrecognized action", async () => {
    const response = await invokePost("client-1", { action: "not_a_real_action", content: "x", confirmed: true });

    expect(response.status).toBe(400);
    expect(memoryRepoMock.createConfirmedMemory).not.toHaveBeenCalled();
  });

  it("returns 400 for empty or overlong content", async () => {
    const empty = await invokePost("client-1", { action: "save_client_memory", content: "   ", confirmed: true });
    expect(empty.status).toBe(400);

    const overlong = await invokePost("client-1", { action: "save_client_memory", content: "x".repeat(4001), confirmed: true });
    expect(overlong.status).toBe(400);

    expect(memoryRepoMock.createConfirmedMemory).not.toHaveBeenCalled();
  });

  // 12/J: zero auto-persist for free-text -- confirmed must be explicitly
  // true, never inferred from the presence of content alone.
  it("12/J: returns 409 and never persists when confirmed is not explicitly true", async () => {
    const missing = await invokePost("client-1", { action: "save_client_memory", content: "x" });
    expect(missing.status).toBe(409);

    const falsy = await invokePost("client-1", { action: "save_client_memory", content: "x", confirmed: false });
    expect(falsy.status).toBe(409);

    expect(memoryRepoMock.createConfirmedMemory).not.toHaveBeenCalled();
  });

  it("creates a client-scoped memory with the client id attached for save_client_memory", async () => {
    await invokePost("client-1", { action: "save_client_memory", content: "Uses 6% developer.", confirmed: true });

    expect(memoryRepoMock.createConfirmedMemory).toHaveBeenCalledWith(
      expect.objectContaining({ ownerUserId: "owner-1", clientId: "client-1", scope: "client_specific", kind: "fact", source: "typed", content: "Uses 6% developer." }),
    );
  });

  it("creates a stylist-wide memory with no clientId for save_professional_rule", async () => {
    await invokePost("client-1", { action: "save_professional_rule", content: "Prefer texturizing on fine hair.", confirmed: true });

    const call = memoryRepoMock.createConfirmedMemory.mock.calls[0][0];
    expect(call).toEqual(expect.objectContaining({ scope: "stylist_specific", kind: "professional_rule" }));
    expect(call).not.toHaveProperty("clientId");
  });

  // 8/9: a transcriptId marks the source as voice_transcript and is
  // recorded in provenance -- but only once this same explicit-confirm
  // POST is made; the transcript route itself never persists memory.
  it("9: tags the source as voice_transcript and records the transcriptId in provenance when one is supplied", async () => {
    await invokePost("client-1", { action: "save_client_memory", content: "From voice", confirmed: true, transcriptId: "transcript-1" });

    expect(memoryRepoMock.createConfirmedMemory).toHaveBeenCalledWith(
      expect.objectContaining({ source: "voice_transcript", provenance: expect.objectContaining({ channel: "voice", transcriptId: "transcript-1" }) }),
    );
  });

  it("returns 400 with the validation message when the repository rejects the scope/client combination", async () => {
    memoryRepoMock.createConfirmedMemory.mockRejectedValue(new memoryRepoMock.ProfessionalMemoryValidationError("clientId is required."));

    const response = await invokePost("client-1", { action: "save_client_memory", content: "x", confirmed: true });

    expect(response.status).toBe(400);
  });

  it("returns a fail-closed 503 (no-store) when persistence is unavailable", async () => {
    memoryRepoMock.createConfirmedMemory.mockRejectedValue(new Error("db down"));
    memoryRepoMock.isProfessionalMemoryPersistenceError.mockReturnValue(true);

    const response = await invokePost("client-1", { action: "save_client_memory", content: "x", confirmed: true });

    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("returns 201 with the created memory on success", async () => {
    const response = await invokePost("client-1", { action: "save_client_memory", content: "Uses 6% developer.", confirmed: true });

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.memory.id).toBe("memory-1");
  });
});

describe("DELETE /api/v1/clients/[id]/memories (revoke)", () => {
  it("returns 401 without a cookie", async () => {
    authMock.authenticateSessionRequest.mockResolvedValue(null);

    const response = await invokeDelete("memory-1");

    expect(response.status).toBe(401);
    expect(memoryRepoMock.revokeMemory).not.toHaveBeenCalled();
  });

  it("returns 400 when memoryId is missing", async () => {
    const response = await invokeDelete(null);

    expect(response.status).toBe(400);
    expect(memoryRepoMock.revokeMemory).not.toHaveBeenCalled();
  });

  it("revokes scoped to the authenticated owner", async () => {
    await invokeDelete("memory-1");

    expect(memoryRepoMock.revokeMemory).toHaveBeenCalledWith("owner-1", "memory-1");
  });

  it("returns 404 when the memory does not exist, is not owned by this caller, or is already revoked", async () => {
    memoryRepoMock.revokeMemory.mockResolvedValue(false);

    const response = await invokeDelete("someone-elses-memory");

    expect(response.status).toBe(404);
  });

  it("returns a fail-closed 503 (no-store) when persistence is unavailable", async () => {
    memoryRepoMock.revokeMemory.mockRejectedValue(new Error("db down"));
    memoryRepoMock.isProfessionalMemoryPersistenceError.mockReturnValue(true);

    const response = await invokeDelete("memory-1");

    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("returns 200 with revoked: true on success", async () => {
    const response = await invokeDelete("memory-1");

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ revoked: true });
  });
});
