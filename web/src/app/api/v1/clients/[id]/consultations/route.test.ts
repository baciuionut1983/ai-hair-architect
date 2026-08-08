import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.hoisted(() => ({ authenticateSessionRequest: vi.fn() }));
const clientRepositoryMock = vi.hoisted(() => ({ resolveOwnedClient: vi.fn() }));
const consultationRepositoryMock = vi.hoisted(() => ({
  listConsultationsForClient: vi.fn(),
  isConsultationPersistenceError: vi.fn(),
  consultationPersistenceUnavailableResponse: vi.fn(),
}));

vi.mock("@/lib/client-repository", () => clientRepositoryMock);
vi.mock("@/lib/consultation-repository", () => consultationRepositoryMock);
vi.mock("@/lib/session-request-auth", () => authMock);

import { GET } from "./route";

const OWNER_A = { id: "owner-1", email: "owner-a@example.com", role: "professional", locale: "en" };

function invoke(clientId = "client-1"): Promise<Response> {
  return GET(new Request("http://localhost"), { params: Promise.resolve({ id: clientId }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  authMock.authenticateSessionRequest.mockResolvedValue(OWNER_A);
  clientRepositoryMock.resolveOwnedClient.mockResolvedValue({ id: "client-1" });
  consultationRepositoryMock.listConsultationsForClient.mockResolvedValue([]);
  consultationRepositoryMock.isConsultationPersistenceError.mockReturnValue(false);
});

describe("GET /api/v1/clients/:id/consultations", () => {
  it("returns 401 without a cookie, never reading any repository", async () => {
    authMock.authenticateSessionRequest.mockResolvedValue(null);

    const response = await invoke();

    expect(response.status).toBe(401);
    expect(clientRepositoryMock.resolveOwnedClient).not.toHaveBeenCalled();
  });

  it("returns 401 for an unknown or expired session (no in-memory fallback)", async () => {
    authMock.authenticateSessionRequest.mockResolvedValue(null);

    const response = await invoke();

    expect(response.status).toBe(401);
  });

  it("returns 404 for a nonexistent or another owner's client, never listing consultations", async () => {
    clientRepositoryMock.resolveOwnedClient.mockResolvedValue(null);

    const response = await invoke("someone-elses-client");

    expect(response.status).toBe(404);
    expect(consultationRepositoryMock.listConsultationsForClient).not.toHaveBeenCalled();
  });

  it("lists consultations, owner- and client-scoped, for a valid session", async () => {
    consultationRepositoryMock.listConsultationsForClient.mockResolvedValue([
      { id: "consultation-1", clientId: "client-1", analysisId: "analysis-1", summary: "Summary", nextSteps: [], createdAt: "2026-08-05T10:00:00.000Z" },
    ]);

    const response = await invoke();

    expect(response.status).toBe(200);
    expect(consultationRepositoryMock.listConsultationsForClient).toHaveBeenCalledWith("owner-1", "client-1");
    await expect(response.json()).resolves.toEqual({
      consultations: [{ id: "consultation-1", clientId: "client-1", analysisId: "analysis-1", summary: "Summary", nextSteps: [], createdAt: "2026-08-05T10:00:00.000Z" }],
    });
  });

  it("scopes the list strictly to the authenticated owner (cross-user isolation)", async () => {
    authMock.authenticateSessionRequest.mockResolvedValue({ ...OWNER_A, id: "owner-2" });

    await invoke();

    expect(consultationRepositoryMock.listConsultationsForClient).toHaveBeenCalledWith("owner-2", "client-1");
    expect(consultationRepositoryMock.listConsultationsForClient).not.toHaveBeenCalledWith("owner-1", "client-1");
  });

  it("fails closed with 503 when consultation persistence is unavailable", async () => {
    const error = new Error("db down");
    consultationRepositoryMock.listConsultationsForClient.mockRejectedValue(error);
    consultationRepositoryMock.isConsultationPersistenceError.mockImplementation((value: unknown) => value === error);
    consultationRepositoryMock.consultationPersistenceUnavailableResponse.mockReturnValue(
      Response.json({ error: "CONSULTATION_PERSISTENCE_UNAVAILABLE" }, { status: 503, headers: { "Cache-Control": "no-store" } }),
    );

    const response = await invoke();

    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
});
