import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.hoisted(() => ({ authenticateSessionRequest: vi.fn() }));
const evidenceRepoMock = vi.hoisted(() => ({
  listLearningEvidenceForOwner: vi.fn(),
  revokeLearningEvidence: vi.fn(),
  isProfessionalLearningEvidencePersistenceError: vi.fn(() => false),
  professionalLearningEvidencePersistenceUnavailableResponse: vi.fn(() =>
    Response.json({ error: "PROFESSIONAL_LEARNING_EVIDENCE_PERSISTENCE_UNAVAILABLE" }, { status: 503, headers: { "Cache-Control": "no-store" } }),
  ),
}));

vi.mock("@/lib/session-request-auth", () => authMock);
vi.mock("@/lib/professional-learning-evidence-repository", () => evidenceRepoMock);

import { DELETE, GET } from "./route";

const OWNER = { id: "owner-1", email: "owner@example.com", role: "professional", locale: "en" };

function invokeGet(query = ""): Promise<Response> {
  return GET(new Request(`http://localhost/api/v1/learning-evidence${query}`));
}

function invokeDelete(evidenceId: string | null): Promise<Response> {
  const url = evidenceId ? `http://localhost/api/v1/learning-evidence?evidenceId=${evidenceId}` : "http://localhost/api/v1/learning-evidence";
  return DELETE(new Request(url, { method: "DELETE" }));
}

beforeEach(() => {
  vi.clearAllMocks();
  authMock.authenticateSessionRequest.mockResolvedValue(OWNER);
  evidenceRepoMock.listLearningEvidenceForOwner.mockResolvedValue([]);
  evidenceRepoMock.revokeLearningEvidence.mockResolvedValue(true);
  evidenceRepoMock.isProfessionalLearningEvidencePersistenceError.mockReturnValue(false);
});

describe("GET /api/v1/learning-evidence", () => {
  it("8/29. returns 401 without a cookie -- no public learning-evidence endpoint exists", async () => {
    authMock.authenticateSessionRequest.mockResolvedValue(null);

    const response = await invokeGet();

    expect(response.status).toBe(401);
    expect(evidenceRepoMock.listLearningEvidenceForOwner).not.toHaveBeenCalled();
  });

  it("8/10. lists using the AUTHENTICATED user's id -- never a query-supplied one", async () => {
    await invokeGet("?ownerUserId=someone-else");

    expect(evidenceRepoMock.listLearningEvidenceForOwner).toHaveBeenCalledWith("owner-1", {});
  });

  it("forwards a recognized evidenceType/status filter", async () => {
    await invokeGet("?evidenceType=IMAGE&status=ACTIVE");

    expect(evidenceRepoMock.listLearningEvidenceForOwner).toHaveBeenCalledWith("owner-1", { evidenceType: "IMAGE", status: "ACTIVE" });
  });

  it("ignores an unrecognized evidenceType/status value rather than passing it through", async () => {
    await invokeGet("?evidenceType=NOT_REAL&status=BOGUS");

    expect(evidenceRepoMock.listLearningEvidenceForOwner).toHaveBeenCalledWith("owner-1", {});
  });

  it("returns a fail-closed 503 (no-store) when persistence is unavailable", async () => {
    evidenceRepoMock.listLearningEvidenceForOwner.mockRejectedValue(new Error("db down"));
    evidenceRepoMock.isProfessionalLearningEvidencePersistenceError.mockReturnValue(true);

    const response = await invokeGet();
    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("returns 200 with the evidence list on success", async () => {
    evidenceRepoMock.listLearningEvidenceForOwner.mockResolvedValue([{ id: "evidence-1" }]);
    const response = await invokeGet();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.evidence).toEqual([{ id: "evidence-1" }]);
  });
});

describe("DELETE /api/v1/learning-evidence (revoke)", () => {
  it("returns 401 without a cookie", async () => {
    authMock.authenticateSessionRequest.mockResolvedValue(null);

    const response = await invokeDelete("evidence-1");
    expect(response.status).toBe(401);
    expect(evidenceRepoMock.revokeLearningEvidence).not.toHaveBeenCalled();
  });

  it("returns 400 when evidenceId is missing", async () => {
    const response = await invokeDelete(null);
    expect(response.status).toBe(400);
    expect(evidenceRepoMock.revokeLearningEvidence).not.toHaveBeenCalled();
  });

  it("11. revokes scoped to the authenticated owner -- never a body/query-supplied owner", async () => {
    await invokeDelete("evidence-1");
    expect(evidenceRepoMock.revokeLearningEvidence).toHaveBeenCalledWith("owner-1", "evidence-1");
  });

  it("returns 404 when the evidence does not exist, is not owned by this caller, or is already revoked", async () => {
    evidenceRepoMock.revokeLearningEvidence.mockResolvedValue(false);

    const response = await invokeDelete("someone-elses-evidence");
    expect(response.status).toBe(404);
  });

  it("19. returns 200 with revoked: true on success -- a soft transition, never a delete call anywhere in this route", async () => {
    const response = await invokeDelete("evidence-1");
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ revoked: true });
  });

  it("returns a fail-closed 503 (no-store) when persistence is unavailable", async () => {
    evidenceRepoMock.revokeLearningEvidence.mockRejectedValue(new Error("db down"));
    evidenceRepoMock.isProfessionalLearningEvidencePersistenceError.mockReturnValue(true);

    const response = await invokeDelete("evidence-1");
    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
});
