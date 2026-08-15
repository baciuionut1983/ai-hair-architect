import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.hoisted(() => ({ authenticateSessionRequest: vi.fn() }));
const clientRepoMock = vi.hoisted(() => ({ resolveOwnedClient: vi.fn() }));
const hardeningMock = vi.hoisted(() => ({ checkRateLimit: vi.fn() }));
const messageRepoMock = vi.hoisted(() => {
  class ConsultationMessagePersistenceError extends Error {
    readonly code = "CONSULTATION_MESSAGE_PERSISTENCE_UNAVAILABLE";
    readonly httpStatus = 503;
  }
  return {
    ConsultationMessagePersistenceError,
    markConsultationMessageMemoryDecision: vi.fn(),
    isConsultationMessagePersistenceError: vi.fn((error: unknown) => error instanceof ConsultationMessagePersistenceError),
  };
});

vi.mock("@/lib/session-request-auth", () => authMock);
vi.mock("@/lib/client-repository", () => clientRepoMock);
vi.mock("@/lib/hardening", () => hardeningMock);
vi.mock("@/lib/consultation-message-repository", () => messageRepoMock);

import { POST } from "./route";

const OWNER = { id: "owner-1", email: "owner@example.com", role: "professional", locale: "en" };
const CLIENT = { id: "client-1", ownerUserId: "owner-1", fullName: "Jane Doe", email: "", phone: "", notes: "", createdAt: "", updatedAt: "" };

function invoke(id: string, messageId: string): Promise<Response> {
  return POST(new Request(`http://localhost/api/v1/clients/${id}/chat/messages/${messageId}/reject-memory`, { method: "POST" }), {
    params: Promise.resolve({ id, messageId }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  authMock.authenticateSessionRequest.mockResolvedValue(OWNER);
  clientRepoMock.resolveOwnedClient.mockResolvedValue(CLIENT);
  hardeningMock.checkRateLimit.mockReturnValue({ allowed: true, remaining: 29 });
  messageRepoMock.markConsultationMessageMemoryDecision.mockResolvedValue(true);
});

describe("POST /api/v1/clients/[id]/chat/messages/[messageId]/reject-memory", () => {
  it("returns 401 without a cookie, never touching the repository", async () => {
    authMock.authenticateSessionRequest.mockResolvedValue(null);

    const response = await invoke("client-1", "message-1");

    expect(response.status).toBe(401);
    expect(messageRepoMock.markConsultationMessageMemoryDecision).not.toHaveBeenCalled();
  });

  it("returns 429 when the rate limit is exceeded", async () => {
    hardeningMock.checkRateLimit.mockReturnValue({ allowed: false, remaining: 0 });

    const response = await invoke("client-1", "message-1");

    expect(response.status).toBe(429);
    expect(messageRepoMock.markConsultationMessageMemoryDecision).not.toHaveBeenCalled();
  });

  it("returns 404 for a foreign/nonexistent client -- cross-owner isolation enforced before any decision is recorded", async () => {
    clientRepoMock.resolveOwnedClient.mockResolvedValue(null);

    const response = await invoke("foreign-client", "message-1");

    expect(response.status).toBe(404);
    expect(messageRepoMock.markConsultationMessageMemoryDecision).not.toHaveBeenCalled();
  });

  it("marks the message rejected, scoped to the authenticated owner, this client, and this exact message", async () => {
    await invoke("client-1", "message-42");

    expect(messageRepoMock.markConsultationMessageMemoryDecision).toHaveBeenCalledWith("owner-1", "client-1", "message-42", "rejected");
  });

  it("returns 200 with rejected: true on success", async () => {
    const response = await invoke("client-1", "message-1");

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ rejected: true });
  });

  // The repository returns false for a message that doesn't exist, isn't
  // owned by this owner/client, carries no proposedMemory, or was already
  // decided -- all four collapse to the same generic 404, matching
  // resolveOwnedClient's own existence-hiding convention.
  it("returns 404 when the repository reports the proposal could not be found (missing, foreign, no proposal, or already decided)", async () => {
    messageRepoMock.markConsultationMessageMemoryDecision.mockResolvedValue(false);

    const response = await invoke("client-1", "message-1");

    expect(response.status).toBe(404);
  });

  it("returns a fail-closed 503 (no-store) when persistence is unavailable", async () => {
    messageRepoMock.markConsultationMessageMemoryDecision.mockRejectedValue(new messageRepoMock.ConsultationMessagePersistenceError());

    const response = await invoke("client-1", "message-1");

    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
});
