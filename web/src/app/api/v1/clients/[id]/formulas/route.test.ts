import { beforeEach, describe, expect, it, vi } from "vitest";

const cookiesMock = vi.hoisted(() => ({ cookies: vi.fn() }));
const storeMock = vi.hoisted(() => ({
  getSession: vi.fn(),
  sanitize: vi.fn((value: unknown) => (typeof value === "string" ? value.trim() : "")),
}));
const clientRepositoryMock = vi.hoisted(() => ({ resolveOwnedClient: vi.fn() }));
const clientFormulaRepositoryMock = vi.hoisted(() => {
  class ClientFormulaDependencyError extends Error {
    readonly code = "CLIENT_FORMULA_CLIENT_NOT_FOUND";
    readonly httpStatus = 404;
  }
  return {
    ClientFormulaDependencyError,
    createClientFormulaForOwner: vi.fn(),
    listClientFormulasForOwner: vi.fn(),
    isClientFormulaPersistenceError: vi.fn(),
    clientFormulaPersistenceUnavailableResponse: vi.fn(),
  };
});

vi.mock("next/headers", () => cookiesMock);
vi.mock("@/lib/milestone1-store", () => storeMock);
vi.mock("@/lib/client-repository", () => clientRepositoryMock);
vi.mock("@/lib/client-formula-repository", () => clientFormulaRepositoryMock);

import { GET, POST } from "./route";

function getRequest(): Request {
  return new Request("http://localhost/api/v1/clients/client-1/formulas");
}

function postRequest(body: unknown): Request {
  return new Request("http://localhost/api/v1/clients/client-1/formulas", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const params = { params: Promise.resolve({ id: "client-1" }) };

beforeEach(() => {
  vi.clearAllMocks();
  cookiesMock.cookies.mockResolvedValue({ get: () => ({ value: "session-token" }) });
  storeMock.getSession.mockReturnValue({ id: "owner-1" });
  storeMock.sanitize.mockImplementation((value: unknown) => (typeof value === "string" ? value.trim() : ""));
  clientRepositoryMock.resolveOwnedClient.mockResolvedValue({ id: "client-1" });
  clientFormulaRepositoryMock.listClientFormulasForOwner.mockResolvedValue([]);
  clientFormulaRepositoryMock.createClientFormulaForOwner.mockResolvedValue({
    id: "formula-1",
    clientId: "client-1",
    formulaName: "Gray coverage",
    formulaDetails: "6N + 20vol",
    createdAt: "2026-08-05T10:00:00.000Z",
  });
  clientFormulaRepositoryMock.isClientFormulaPersistenceError.mockReturnValue(false);
});

describe("GET /api/v1/clients/:id/formulas", () => {
  it("returns 401 without a session", async () => {
    storeMock.getSession.mockReturnValue(null);
    const response = await GET(getRequest(), params);
    expect(response.status).toBe(401);
  });

  it("returns 404 for a nonexistent or another owner's client", async () => {
    clientRepositoryMock.resolveOwnedClient.mockResolvedValue(null);
    const response = await GET(getRequest(), params);
    expect(response.status).toBe(404);
    expect(clientFormulaRepositoryMock.listClientFormulasForOwner).not.toHaveBeenCalled();
  });

  it("lists formulas, preserving the existing response contract", async () => {
    clientFormulaRepositoryMock.listClientFormulasForOwner.mockResolvedValue([{
      id: "formula-1",
      clientId: "client-1",
      formulaName: "Gray coverage",
      formulaDetails: "6N + 20vol",
      createdAt: "2026-08-05T10:00:00.000Z",
    }]);

    const response = await GET(getRequest(), params);

    expect(response.status).toBe(200);
    expect(clientFormulaRepositoryMock.listClientFormulasForOwner).toHaveBeenCalledWith("owner-1", "client-1");
    const body = await response.json();
    expect(body).toEqual({
      formulas: [{
        id: "formula-1",
        clientId: "client-1",
        formulaName: "Gray coverage",
        formulaDetails: "6N + 20vol",
        createdAt: "2026-08-05T10:00:00.000Z",
      }],
    });
  });

  it("fails closed with 503 when formula persistence is unavailable", async () => {
    const error = new Error("db down");
    clientFormulaRepositoryMock.listClientFormulasForOwner.mockRejectedValue(error);
    clientFormulaRepositoryMock.isClientFormulaPersistenceError.mockImplementation(
      (value: unknown) => value === error,
    );
    clientFormulaRepositoryMock.clientFormulaPersistenceUnavailableResponse.mockReturnValue(
      Response.json({ error: "CLIENT_FORMULA_PERSISTENCE_UNAVAILABLE" }, {
        status: 503,
        headers: { "Cache-Control": "no-store" },
      }),
    );

    const response = await GET(getRequest(), params);
    expect(response.status).toBe(503);
  });
});

describe("POST /api/v1/clients/:id/formulas", () => {
  it("returns 401 without a session", async () => {
    storeMock.getSession.mockReturnValue(null);
    const response = await POST(postRequest({ formulaName: "n", formulaDetails: "d" }), params);
    expect(response.status).toBe(401);
    expect(clientFormulaRepositoryMock.createClientFormulaForOwner).not.toHaveBeenCalled();
  });

  it("returns 404 for a nonexistent or another owner's client", async () => {
    clientRepositoryMock.resolveOwnedClient.mockResolvedValue(null);
    const response = await POST(postRequest({ formulaName: "n", formulaDetails: "d" }), params);
    expect(response.status).toBe(404);
    expect(clientFormulaRepositoryMock.createClientFormulaForOwner).not.toHaveBeenCalled();
  });

  it("returns 400 when formulaName or formulaDetails is missing", async () => {
    const response = await POST(postRequest({ formulaName: "n" }), params);
    expect(response.status).toBe(400);
    expect(clientFormulaRepositoryMock.createClientFormulaForOwner).not.toHaveBeenCalled();
  });

  it("creates a formula, never sending sourceAnalysisId (not part of the public contract)", async () => {
    const response = await POST(postRequest({ formulaName: "Gray coverage", formulaDetails: "6N + 20vol" }), params);

    expect(response.status).toBe(201);
    expect(clientFormulaRepositoryMock.createClientFormulaForOwner).toHaveBeenCalledWith({
      clientId: "client-1",
      ownerUserId: "owner-1",
      formulaName: "Gray coverage",
      formulaDetails: "6N + 20vol",
    });
    const callArgs = clientFormulaRepositoryMock.createClientFormulaForOwner.mock.calls[0][0];
    expect(callArgs).not.toHaveProperty("sourceAnalysisId");

    const body = await response.json();
    expect(body).toEqual({
      formula: {
        id: "formula-1",
        clientId: "client-1",
        formulaName: "Gray coverage",
        formulaDetails: "6N + 20vol",
        createdAt: "2026-08-05T10:00:00.000Z",
      },
    });
  });

  it("ignores a sourceAnalysisId smuggled into the request body", async () => {
    await POST(
      postRequest({ formulaName: "n", formulaDetails: "d", sourceAnalysisId: "someone-elses-analysis" }),
      params,
    );

    const callArgs = clientFormulaRepositoryMock.createClientFormulaForOwner.mock.calls[0][0];
    expect(callArgs).not.toHaveProperty("sourceAnalysisId");
  });

  it("maps a repository dependency error to the existing 404 response", async () => {
    clientFormulaRepositoryMock.createClientFormulaForOwner.mockRejectedValue(
      new clientFormulaRepositoryMock.ClientFormulaDependencyError(),
    );
    const response = await POST(postRequest({ formulaName: "n", formulaDetails: "d" }), params);
    expect(response.status).toBe(404);
  });

  it("fails closed with 503 when formula persistence is unavailable", async () => {
    const error = new Error("db down");
    clientFormulaRepositoryMock.createClientFormulaForOwner.mockRejectedValue(error);
    clientFormulaRepositoryMock.isClientFormulaPersistenceError.mockImplementation(
      (value: unknown) => value === error,
    );
    clientFormulaRepositoryMock.clientFormulaPersistenceUnavailableResponse.mockReturnValue(
      Response.json({ error: "CLIENT_FORMULA_PERSISTENCE_UNAVAILABLE" }, {
        status: 503,
        headers: { "Cache-Control": "no-store" },
      }),
    );

    const response = await POST(postRequest({ formulaName: "n", formulaDetails: "d" }), params);
    expect(response.status).toBe(503);
  });
});
