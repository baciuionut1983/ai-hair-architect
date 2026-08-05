import { beforeEach, describe, expect, it, vi } from "vitest";

const cookiesMock = vi.hoisted(() => ({ cookies: vi.fn() }));
const storeMock = vi.hoisted(() => ({
  getSession: vi.fn(),
  sanitize: vi.fn((value: unknown) => (typeof value === "string" ? value.trim() : "")),
}));
const clientRepositoryMock = vi.hoisted(() => ({ resolveOwnedClient: vi.fn() }));
const clientTreatmentRepositoryMock = vi.hoisted(() => {
  class ClientTreatmentDependencyError extends Error {
    readonly code = "CLIENT_TREATMENT_CLIENT_NOT_FOUND";
    readonly httpStatus = 404;
  }
  return {
    ClientTreatmentDependencyError,
    createClientTreatmentForOwner: vi.fn(),
    listClientTreatmentsForOwner: vi.fn(),
    isClientTreatmentPersistenceError: vi.fn(),
    clientTreatmentPersistenceUnavailableResponse: vi.fn(),
  };
});

vi.mock("next/headers", () => cookiesMock);
vi.mock("@/lib/milestone1-store", () => storeMock);
vi.mock("@/lib/client-repository", () => clientRepositoryMock);
vi.mock("@/lib/client-treatment-repository", () => clientTreatmentRepositoryMock);

import { GET, POST } from "./route";

function getRequest(): Request {
  return new Request("http://localhost/api/v1/clients/client-1/treatments");
}

function postRequest(body: unknown): Request {
  return new Request("http://localhost/api/v1/clients/client-1/treatments", {
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
  clientTreatmentRepositoryMock.listClientTreatmentsForOwner.mockResolvedValue([]);
  clientTreatmentRepositoryMock.createClientTreatmentForOwner.mockResolvedValue({
    id: "treatment-1",
    clientId: "client-1",
    treatmentName: "Deep hydration",
    treatmentDetails: "Bond-building mask",
    createdAt: "2026-08-05T10:00:00.000Z",
  });
  clientTreatmentRepositoryMock.isClientTreatmentPersistenceError.mockReturnValue(false);
});

describe("GET /api/v1/clients/:id/treatments", () => {
  it("returns 401 without a session", async () => {
    storeMock.getSession.mockReturnValue(null);
    const response = await GET(getRequest(), params);
    expect(response.status).toBe(401);
  });

  it("returns 404 for a nonexistent or another owner's client", async () => {
    clientRepositoryMock.resolveOwnedClient.mockResolvedValue(null);
    const response = await GET(getRequest(), params);
    expect(response.status).toBe(404);
    expect(clientTreatmentRepositoryMock.listClientTreatmentsForOwner).not.toHaveBeenCalled();
  });

  it("lists treatments, preserving the existing response contract", async () => {
    clientTreatmentRepositoryMock.listClientTreatmentsForOwner.mockResolvedValue([{
      id: "treatment-1",
      clientId: "client-1",
      treatmentName: "Deep hydration",
      treatmentDetails: "Bond-building mask",
      createdAt: "2026-08-05T10:00:00.000Z",
    }]);

    const response = await GET(getRequest(), params);

    expect(response.status).toBe(200);
    expect(clientTreatmentRepositoryMock.listClientTreatmentsForOwner).toHaveBeenCalledWith("owner-1", "client-1");
    const body = await response.json();
    expect(body).toEqual({
      treatments: [{
        id: "treatment-1",
        clientId: "client-1",
        treatmentName: "Deep hydration",
        treatmentDetails: "Bond-building mask",
        createdAt: "2026-08-05T10:00:00.000Z",
      }],
    });
  });

  it("fails closed with 503 when treatment persistence is unavailable", async () => {
    const error = new Error("db down");
    clientTreatmentRepositoryMock.listClientTreatmentsForOwner.mockRejectedValue(error);
    clientTreatmentRepositoryMock.isClientTreatmentPersistenceError.mockImplementation(
      (value: unknown) => value === error,
    );
    clientTreatmentRepositoryMock.clientTreatmentPersistenceUnavailableResponse.mockReturnValue(
      Response.json({ error: "CLIENT_TREATMENT_PERSISTENCE_UNAVAILABLE" }, {
        status: 503,
        headers: { "Cache-Control": "no-store" },
      }),
    );

    const response = await GET(getRequest(), params);
    expect(response.status).toBe(503);
  });
});

describe("POST /api/v1/clients/:id/treatments", () => {
  it("returns 401 without a session", async () => {
    storeMock.getSession.mockReturnValue(null);
    const response = await POST(postRequest({ treatmentName: "n", treatmentDetails: "d" }), params);
    expect(response.status).toBe(401);
    expect(clientTreatmentRepositoryMock.createClientTreatmentForOwner).not.toHaveBeenCalled();
  });

  it("returns 404 for a nonexistent or another owner's client", async () => {
    clientRepositoryMock.resolveOwnedClient.mockResolvedValue(null);
    const response = await POST(postRequest({ treatmentName: "n", treatmentDetails: "d" }), params);
    expect(response.status).toBe(404);
    expect(clientTreatmentRepositoryMock.createClientTreatmentForOwner).not.toHaveBeenCalled();
  });

  it("returns 400 when treatmentName or treatmentDetails is missing", async () => {
    const response = await POST(postRequest({ treatmentName: "n" }), params);
    expect(response.status).toBe(400);
    expect(clientTreatmentRepositoryMock.createClientTreatmentForOwner).not.toHaveBeenCalled();
  });

  it("creates a treatment, never sending sourceAnalysisId (not part of the public contract)", async () => {
    const response = await POST(
      postRequest({ treatmentName: "Deep hydration", treatmentDetails: "Bond-building mask" }),
      params,
    );

    expect(response.status).toBe(201);
    expect(clientTreatmentRepositoryMock.createClientTreatmentForOwner).toHaveBeenCalledWith({
      clientId: "client-1",
      ownerUserId: "owner-1",
      treatmentName: "Deep hydration",
      treatmentDetails: "Bond-building mask",
    });
    const callArgs = clientTreatmentRepositoryMock.createClientTreatmentForOwner.mock.calls[0][0];
    expect(callArgs).not.toHaveProperty("sourceAnalysisId");

    const body = await response.json();
    expect(body).toEqual({
      treatment: {
        id: "treatment-1",
        clientId: "client-1",
        treatmentName: "Deep hydration",
        treatmentDetails: "Bond-building mask",
        createdAt: "2026-08-05T10:00:00.000Z",
      },
    });
  });

  it("ignores a sourceAnalysisId smuggled into the request body", async () => {
    await POST(
      postRequest({ treatmentName: "n", treatmentDetails: "d", sourceAnalysisId: "someone-elses-analysis" }),
      params,
    );

    const callArgs = clientTreatmentRepositoryMock.createClientTreatmentForOwner.mock.calls[0][0];
    expect(callArgs).not.toHaveProperty("sourceAnalysisId");
  });

  it("maps a repository dependency error to the existing 404 response", async () => {
    clientTreatmentRepositoryMock.createClientTreatmentForOwner.mockRejectedValue(
      new clientTreatmentRepositoryMock.ClientTreatmentDependencyError(),
    );
    const response = await POST(postRequest({ treatmentName: "n", treatmentDetails: "d" }), params);
    expect(response.status).toBe(404);
  });

  it("fails closed with 503 when treatment persistence is unavailable", async () => {
    const error = new Error("db down");
    clientTreatmentRepositoryMock.createClientTreatmentForOwner.mockRejectedValue(error);
    clientTreatmentRepositoryMock.isClientTreatmentPersistenceError.mockImplementation(
      (value: unknown) => value === error,
    );
    clientTreatmentRepositoryMock.clientTreatmentPersistenceUnavailableResponse.mockReturnValue(
      Response.json({ error: "CLIENT_TREATMENT_PERSISTENCE_UNAVAILABLE" }, {
        status: 503,
        headers: { "Cache-Control": "no-store" },
      }),
    );

    const response = await POST(postRequest({ treatmentName: "n", treatmentDetails: "d" }), params);
    expect(response.status).toBe(503);
  });
});
