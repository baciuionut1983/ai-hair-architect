import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.hoisted(() => ({ authenticateSessionRequest: vi.fn() }));
const clientRepositoryMock = vi.hoisted(() => ({ resolveOwnedClient: vi.fn() }));
const repositoryMock = vi.hoisted(() => {
  class TechnicalDemonstrationPersistenceError extends Error {
    readonly code = "TECHNICAL_DEMONSTRATION_PERSISTENCE_UNAVAILABLE";
    readonly httpStatus = 503;
    constructor() {
      super("Technical Demonstration data is temporarily unavailable.");
      this.name = "TechnicalDemonstrationPersistenceError";
    }
  }
  return {
    TechnicalDemonstrationPersistenceError,
    findTechnicalDemonstrationPlanForOwner: vi.fn(),
    listTechnicalDemonstrationStepsForPlan: vi.fn(),
  };
});

vi.mock("@/lib/session-request-auth", () => authMock);
vi.mock("@/lib/client-repository", () => clientRepositoryMock);
vi.mock("@/lib/technical-demonstration-repository", () => repositoryMock);

import { GET } from "./route";

const OWNER = { id: "owner-1", email: "owner@example.com", role: "professional", locale: "en" };
const CLIENT = {
  id: "client-1",
  ownerUserId: "owner-1",
  fullName: "Jane Doe",
  email: "",
  phone: "",
  notes: "",
  createdAt: "",
  updatedAt: "",
};
const PLAN = { id: "plan-1", analysisProposalId: "proposal-1", clientId: "client-1", status: "DRAFT", planVersion: 1 };
const STEPS = [{ id: "step-1", planId: "plan-1", stepNumber: 1 }];

function ctx(id = "client-1", proposalId = "proposal-1", planId = "plan-1") {
  return { params: Promise.resolve({ id, proposalId, planId }) };
}

function getReq(): Request {
  return new Request("http://localhost/api/v1/clients/client-1/analysis-proposals/proposal-1/technical-demonstration-plans/plan-1");
}

beforeEach(() => {
  vi.clearAllMocks();
  authMock.authenticateSessionRequest.mockResolvedValue(OWNER);
  clientRepositoryMock.resolveOwnedClient.mockResolvedValue(CLIENT);
  repositoryMock.findTechnicalDemonstrationPlanForOwner.mockResolvedValue(PLAN);
  repositoryMock.listTechnicalDemonstrationStepsForPlan.mockResolvedValue(STEPS);
});

describe("GET /api/v1/clients/[id]/analysis-proposals/[proposalId]/technical-demonstration-plans/[planId]", () => {
  it("returns 401 without a session and touches nothing", async () => {
    authMock.authenticateSessionRequest.mockResolvedValue(null);

    const response = await GET(getReq(), ctx());

    expect(response.status).toBe(401);
    expect(repositoryMock.findTechnicalDemonstrationPlanForOwner).not.toHaveBeenCalled();
  });

  it("returns 404 for a foreign/nonexistent client, before resolving the plan", async () => {
    clientRepositoryMock.resolveOwnedClient.mockResolvedValue(null);

    const response = await GET(getReq(), ctx());

    expect(response.status).toBe(404);
    expect(repositoryMock.findTechnicalDemonstrationPlanForOwner).not.toHaveBeenCalled();
  });

  it("returns 404 for a nonexistent/foreign-owner plan id", async () => {
    repositoryMock.findTechnicalDemonstrationPlanForOwner.mockResolvedValue(null);

    const response = await GET(getReq(), ctx());

    expect(response.status).toBe(404);
    expect((await response.json()).error).toBe("Technical Demonstration Plan not found.");
    expect(repositoryMock.listTechnicalDemonstrationStepsForPlan).not.toHaveBeenCalled();
  });

  it("returns 404 when a real, owned plan belongs to a DIFFERENT client than the URL's own id", async () => {
    repositoryMock.findTechnicalDemonstrationPlanForOwner.mockResolvedValue({ ...PLAN, clientId: "someone-elses-client" });

    const response = await GET(getReq(), ctx());

    expect(response.status).toBe(404);
    expect(repositoryMock.listTechnicalDemonstrationStepsForPlan).not.toHaveBeenCalled();
  });

  it("returns 404 when a real, owned plan belongs to a DIFFERENT proposal than the URL's own proposalId, even for the correct client", async () => {
    repositoryMock.findTechnicalDemonstrationPlanForOwner.mockResolvedValue({ ...PLAN, analysisProposalId: "some-other-proposal" });

    const response = await GET(getReq(), ctx());

    expect(response.status).toBe(404);
    expect(repositoryMock.listTechnicalDemonstrationStepsForPlan).not.toHaveBeenCalled();
  });

  it("returns the byte-identical 404 for absent vs. mismatched-relationship plans (no discovery oracle)", async () => {
    repositoryMock.findTechnicalDemonstrationPlanForOwner.mockResolvedValueOnce(null);
    const absent = await GET(getReq(), ctx());
    const absentBody = await absent.json();

    repositoryMock.findTechnicalDemonstrationPlanForOwner.mockResolvedValueOnce({ ...PLAN, clientId: "someone-elses-client" });
    const mismatched = await GET(getReq(), ctx());
    const mismatchedBody = await mismatched.json();

    expect(mismatched.status).toBe(absent.status);
    expect(mismatchedBody).toEqual(absentBody);
  });

  it("returns the exact owned, correctly-related plan with its ordered steps", async () => {
    const response = await GET(getReq(), ctx());

    expect(response.status).toBe(200);
    expect(repositoryMock.listTechnicalDemonstrationStepsForPlan).toHaveBeenCalledWith("owner-1", "client-1", "plan-1");
    expect(await response.json()).toEqual({ plan: PLAN, steps: STEPS });
  });

  it("fails closed with a no-store 503 when the repository reports persistence unavailable", async () => {
    repositoryMock.findTechnicalDemonstrationPlanForOwner.mockRejectedValue(new repositoryMock.TechnicalDemonstrationPersistenceError());

    const response = await GET(getReq(), ctx());

    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
});
