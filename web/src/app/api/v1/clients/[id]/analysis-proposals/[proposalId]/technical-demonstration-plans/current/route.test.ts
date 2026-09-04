import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.hoisted(() => ({ authenticateSessionRequest: vi.fn() }));
const clientRepositoryMock = vi.hoisted(() => ({ resolveOwnedClient: vi.fn() }));
const proposalRepositoryMock = vi.hoisted(() => ({ findProposalForOwner: vi.fn() }));
const repositoryMock = vi.hoisted(() => {
  class TechnicalDemonstrationPersistenceError extends Error {
    readonly code = "TECHNICAL_DEMONSTRATION_PERSISTENCE_UNAVAILABLE";
    readonly httpStatus = 503;
    constructor() {
      super("Technical Demonstration data is temporarily unavailable.");
      this.name = "TechnicalDemonstrationPersistenceError";
    }
  }
  class TechnicalDemonstrationInvariantError extends Error {
    readonly code = "TECHNICAL_DEMONSTRATION_INVARIANT_VIOLATED";
    readonly httpStatus = 500;
    constructor(message: string) {
      super(message);
      this.name = "TechnicalDemonstrationInvariantError";
    }
  }
  class TechnicalDemonstrationDependencyError extends Error {
    constructor(
      readonly code: string,
      readonly httpStatus: number,
      message: string,
    ) {
      super(message);
      this.name = "TechnicalDemonstrationDependencyError";
    }
  }
  class TechnicalDemonstrationStateError extends Error {
    readonly code = "TECHNICAL_DEMONSTRATION_ILLEGAL_STATE_TRANSITION";
    readonly httpStatus = 409;
    constructor(
      readonly fromStatus: string,
      readonly attempted: "confirm",
      message: string,
    ) {
      super(message);
      this.name = "TechnicalDemonstrationStateError";
    }
  }
  class TechnicalDemonstrationValidationError extends Error {
    readonly code = "TECHNICAL_DEMONSTRATION_INVALID_DERIVED_PAYLOAD";
    readonly httpStatus = 500;
    constructor(message: string) {
      super(message);
      this.name = "TechnicalDemonstrationValidationError";
    }
  }
  class TechnicalDemonstrationConcurrencyError extends Error {
    readonly code = "TECHNICAL_DEMONSTRATION_CONCURRENCY_CONFLICT";
    readonly httpStatus = 409;
    constructor() {
      super("Technical Demonstration Plan could not be confirmed because of a concurrent confirmation.");
      this.name = "TechnicalDemonstrationConcurrencyError";
    }
  }
  return {
    TechnicalDemonstrationPersistenceError,
    TechnicalDemonstrationInvariantError,
    TechnicalDemonstrationDependencyError,
    TechnicalDemonstrationStateError,
    TechnicalDemonstrationValidationError,
    TechnicalDemonstrationConcurrencyError,
    findCurrentConfirmedTechnicalDemonstrationPlan: vi.fn(),
    listTechnicalDemonstrationStepsForPlan: vi.fn(),
  };
});

vi.mock("@/lib/session-request-auth", () => authMock);
vi.mock("@/lib/client-repository", () => clientRepositoryMock);
vi.mock("@/lib/proposal-repository", () => proposalRepositoryMock);
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
const PROPOSAL = { id: "proposal-1", clientId: "client-1", vertical: "cutting", status: "CONFIRMED" };
const CONFIRMED_PLAN = { id: "plan-2", analysisProposalId: "proposal-1", clientId: "client-1", status: "CONFIRMED", planVersion: 2 };
const STEPS = [{ id: "step-1", planId: "plan-2", stepNumber: 1 }];

function ctx(id = "client-1", proposalId = "proposal-1") {
  return { params: Promise.resolve({ id, proposalId }) };
}

function getReq(): Request {
  return new Request("http://localhost/api/v1/clients/client-1/analysis-proposals/proposal-1/technical-demonstration-plans/current");
}

beforeEach(() => {
  vi.clearAllMocks();
  authMock.authenticateSessionRequest.mockResolvedValue(OWNER);
  clientRepositoryMock.resolveOwnedClient.mockResolvedValue(CLIENT);
  proposalRepositoryMock.findProposalForOwner.mockResolvedValue(PROPOSAL);
  repositoryMock.findCurrentConfirmedTechnicalDemonstrationPlan.mockResolvedValue(CONFIRMED_PLAN);
  repositoryMock.listTechnicalDemonstrationStepsForPlan.mockResolvedValue(STEPS);
});

describe("GET /api/v1/clients/[id]/analysis-proposals/[proposalId]/technical-demonstration-plans/current", () => {
  it("returns 401 without a session and touches nothing", async () => {
    authMock.authenticateSessionRequest.mockResolvedValue(null);

    const response = await GET(getReq(), ctx());

    expect(response.status).toBe(401);
    expect(repositoryMock.findCurrentConfirmedTechnicalDemonstrationPlan).not.toHaveBeenCalled();
  });

  it("returns 404 for a foreign/nonexistent client", async () => {
    clientRepositoryMock.resolveOwnedClient.mockResolvedValue(null);

    const response = await GET(getReq(), ctx());

    expect(response.status).toBe(404);
    expect(proposalRepositoryMock.findProposalForOwner).not.toHaveBeenCalled();
  });

  it("returns 404 for a foreign or nonexistent proposal, never calling the plan repository", async () => {
    proposalRepositoryMock.findProposalForOwner.mockResolvedValue(null);

    const response = await GET(getReq(), ctx());

    expect(response.status).toBe(404);
    expect(repositoryMock.findCurrentConfirmedTechnicalDemonstrationPlan).not.toHaveBeenCalled();
  });

  it("returns 404 when the proposal belongs to a different client", async () => {
    proposalRepositoryMock.findProposalForOwner.mockResolvedValue({ ...PROPOSAL, clientId: "someone-elses-client" });

    const response = await GET(getReq(), ctx());

    expect(response.status).toBe(404);
    expect(repositoryMock.findCurrentConfirmedTechnicalDemonstrationPlan).not.toHaveBeenCalled();
  });

  it("returns the current confirmed plan and its steps with 200, using the proposal's own vertical", async () => {
    const response = await GET(getReq(), ctx());

    expect(response.status).toBe(200);
    expect(repositoryMock.findCurrentConfirmedTechnicalDemonstrationPlan).toHaveBeenCalledWith("owner-1", "client-1", "proposal-1", "cutting");
    expect(repositoryMock.listTechnicalDemonstrationStepsForPlan).toHaveBeenCalledWith("owner-1", "client-1", "plan-2");
    expect(await response.json()).toEqual({ plan: CONFIRMED_PLAN, steps: STEPS });
  });

  it("returns plan: null with 200 (never 404) when no plan has been confirmed yet, and never queries steps", async () => {
    repositoryMock.findCurrentConfirmedTechnicalDemonstrationPlan.mockResolvedValue(null);

    const response = await GET(getReq(), ctx());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ plan: null, steps: [] });
    expect(repositoryMock.listTechnicalDemonstrationStepsForPlan).not.toHaveBeenCalled();
  });

  it("propagates an integrity violation (more than one CONFIRMED plan) rather than silently resolving it", async () => {
    repositoryMock.findCurrentConfirmedTechnicalDemonstrationPlan.mockRejectedValue(
      new repositoryMock.TechnicalDemonstrationInvariantError("Found 2 CONFIRMED Technical Demonstration Plans for the same scope -- expected at most 1."),
    );

    const response = await GET(getReq(), ctx());

    expect(response.status).toBe(500);
    expect((await response.json()).error).toBe("TECHNICAL_DEMONSTRATION_INVARIANT_VIOLATED");
  });

  it("fails closed with a no-store 503 when the repository reports persistence unavailable", async () => {
    repositoryMock.findCurrentConfirmedTechnicalDemonstrationPlan.mockRejectedValue(new repositoryMock.TechnicalDemonstrationPersistenceError());

    const response = await GET(getReq(), ctx());

    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
});
