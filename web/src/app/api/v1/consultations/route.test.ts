import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.hoisted(() => ({ authenticateSessionRequest: vi.fn() }));
const repositoryMock = vi.hoisted(() => {
  class ConsultationDependencyError extends Error {
    constructor(readonly httpStatus: number, message: string) {
      super(message);
    }
  }
  class ConsultationValidationError extends Error {
    constructor(readonly code: string, readonly httpStatus: number, message: string) {
      super(message);
    }
  }
  return {
    ConsultationDependencyError,
    ConsultationValidationError,
    consultationPersistenceUnavailableResponse: vi.fn(() =>
      Response.json({ error: "CONSULTATION_PERSISTENCE_UNAVAILABLE" }, { status: 503, headers: { "Cache-Control": "no-store" } }),
    ),
    createConsultationForOwner: vi.fn(),
    isConsultationPersistenceError: vi.fn(),
    normalizeConsultationNextSteps: vi.fn((value: unknown) => (Array.isArray(value) ? value : [])),
    normalizeConsultationSummary: vi.fn((value: unknown) => String(value ?? "")),
  };
});

vi.mock("@/lib/consultation-repository", () => repositoryMock);
vi.mock("@/lib/session-request-auth", () => authMock);

import { POST } from "./route";

const mutableEnv = process.env as Record<string, string | undefined>;
const originalNodeEnv = process.env.NODE_ENV;
const OWNER_A = { id: "owner-1", email: "owner-a@example.com", role: "professional", locale: "en" };

function invoke(body: unknown = { clientId: "client-1", analysisId: "analysis-1" }): Promise<Response> {
  return POST(
    new Request("http://localhost/api/v1/consultations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

describe("consultations durable persistence guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mutableEnv.NODE_ENV = "test";
    authMock.authenticateSessionRequest.mockResolvedValue(OWNER_A);
    repositoryMock.isConsultationPersistenceError.mockReturnValue(false);
    repositoryMock.createConsultationForOwner.mockResolvedValue({
      id: "consultation-1",
      clientId: "client-1",
      analysisId: "analysis-1",
      summary: "",
      nextSteps: [],
      createdAt: "2026-08-05T10:00:00.000Z",
    });
  });

  afterEach(() => {
    mutableEnv.NODE_ENV = originalNodeEnv;
  });

  it("returns 401 without a cookie in production, never touching persistence", async () => {
    mutableEnv.NODE_ENV = "production";
    authMock.authenticateSessionRequest.mockResolvedValue(null);

    const response = await invoke();

    expect(response.status).toBe(401);
    expect(authMock.authenticateSessionRequest).toHaveBeenCalledOnce();
    expect(repositoryMock.createConsultationForOwner).not.toHaveBeenCalled();
  });

  it("returns 401 without a cookie in test, bypassing the business-persistence guard", async () => {
    authMock.authenticateSessionRequest.mockResolvedValue(null);

    const response = await invoke();

    expect(response.status).toBe(401);
    expect(authMock.authenticateSessionRequest).toHaveBeenCalledOnce();
  });

  it("returns 401 for an unknown or expired session (no in-memory fallback)", async () => {
    authMock.authenticateSessionRequest.mockResolvedValue(null);

    const response = await invoke();

    expect(response.status).toBe(401);
    expect(repositoryMock.createConsultationForOwner).not.toHaveBeenCalled();
  });

  it("creates a consultation owner-scoped for a valid session", async () => {
    const response = await invoke();

    expect(response.status).toBe(201);
    expect(repositoryMock.createConsultationForOwner).toHaveBeenCalledWith(
      "owner-1",
      expect.objectContaining({ clientId: "client-1", analysisId: "analysis-1" }),
    );
  });

  it("scopes creation strictly to the authenticated owner (cross-user isolation)", async () => {
    authMock.authenticateSessionRequest.mockResolvedValue({ ...OWNER_A, id: "owner-2" });

    await invoke();

    expect(repositoryMock.createConsultationForOwner).toHaveBeenCalledWith("owner-2", expect.any(Object));
    expect(repositoryMock.createConsultationForOwner).not.toHaveBeenCalledWith("owner-1", expect.any(Object));
  });

  it("maps a dependency error (e.g. client owned by someone else) to its existing status", async () => {
    repositoryMock.createConsultationForOwner.mockRejectedValue(
      new repositoryMock.ConsultationDependencyError(404, "Client not found."),
    );

    const response = await invoke();

    expect(response.status).toBe(404);
  });

  it("fails closed with 503 when consultation persistence is unavailable", async () => {
    const error = new Error("db down");
    repositoryMock.createConsultationForOwner.mockRejectedValue(error);
    repositoryMock.isConsultationPersistenceError.mockImplementation((value: unknown) => value === error);

    const response = await invoke();

    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
});