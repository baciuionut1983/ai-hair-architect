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
  class TechnicalDemonstrationValidationError extends Error {
    readonly code = "TECHNICAL_DEMONSTRATION_INVALID_DERIVED_PAYLOAD";
    readonly httpStatus = 500;
    constructor(message: string) {
      super(message);
      this.name = "TechnicalDemonstrationValidationError";
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
  class TechnicalDemonstrationConcurrencyError extends Error {
    readonly code = "TECHNICAL_DEMONSTRATION_CONCURRENCY_CONFLICT";
    readonly httpStatus = 409;
    constructor() {
      super("Technical Demonstration Plan could not be confirmed because of a concurrent confirmation.");
      this.name = "TechnicalDemonstrationConcurrencyError";
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
  return {
    TechnicalDemonstrationPersistenceError,
    TechnicalDemonstrationDependencyError,
    TechnicalDemonstrationValidationError,
    TechnicalDemonstrationStateError,
    TechnicalDemonstrationConcurrencyError,
    TechnicalDemonstrationInvariantError,
    findTechnicalDemonstrationPlanForOwner: vi.fn(),
    confirmTechnicalDemonstrationPlan: vi.fn(),
    listTechnicalDemonstrationStepsForPlan: vi.fn(),
  };
});

vi.mock("@/lib/session-request-auth", () => authMock);
vi.mock("@/lib/client-repository", () => clientRepositoryMock);
vi.mock("@/lib/technical-demonstration-repository", () => repositoryMock);

import { POST } from "./route";

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
const DRAFT_PLAN = { id: "plan-1", analysisProposalId: "proposal-1", clientId: "client-1", status: "DRAFT", planVersion: 1 };
const CONFIRMED_PLAN = { ...DRAFT_PLAN, status: "CONFIRMED", confirmedAt: "2026-09-04T00:00:00.000Z" };
const STEPS = [{ id: "step-1", planId: "plan-1", stepNumber: 1 }];

function ctx(id = "client-1", proposalId = "proposal-1", planId = "plan-1") {
  return { params: Promise.resolve({ id, proposalId, planId }) };
}

function postReq(body?: unknown): Request {
  return new Request("http://localhost/api/v1/clients/client-1/analysis-proposals/proposal-1/technical-demonstration-plans/plan-1/confirm", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  authMock.authenticateSessionRequest.mockResolvedValue(OWNER);
  clientRepositoryMock.resolveOwnedClient.mockResolvedValue(CLIENT);
  repositoryMock.findTechnicalDemonstrationPlanForOwner.mockResolvedValue(DRAFT_PLAN);
  repositoryMock.confirmTechnicalDemonstrationPlan.mockResolvedValue(CONFIRMED_PLAN);
  repositoryMock.listTechnicalDemonstrationStepsForPlan.mockResolvedValue(STEPS);
});

describe("POST /api/v1/clients/[id]/analysis-proposals/[proposalId]/technical-demonstration-plans/[planId]/confirm", () => {
  it("returns 401 without a session and touches nothing", async () => {
    authMock.authenticateSessionRequest.mockResolvedValue(null);

    const response = await POST(postReq({ expectedCurrentConfirmedPlanId: null }), ctx());

    expect(response.status).toBe(401);
    expect(repositoryMock.confirmTechnicalDemonstrationPlan).not.toHaveBeenCalled();
  });

  it("returns 404 for a foreign/nonexistent client", async () => {
    clientRepositoryMock.resolveOwnedClient.mockResolvedValue(null);

    const response = await POST(postReq({ expectedCurrentConfirmedPlanId: null }), ctx());

    expect(response.status).toBe(404);
    expect(repositoryMock.findTechnicalDemonstrationPlanForOwner).not.toHaveBeenCalled();
  });

  it("returns 404 for a nonexistent/foreign-owner plan id, never reading the body or calling confirm", async () => {
    repositoryMock.findTechnicalDemonstrationPlanForOwner.mockResolvedValue(null);

    const response = await POST(postReq({ expectedCurrentConfirmedPlanId: null }), ctx());

    expect(response.status).toBe(404);
    expect(repositoryMock.confirmTechnicalDemonstrationPlan).not.toHaveBeenCalled();
  });

  it("returns 404 when a real, owned plan belongs to a DIFFERENT client than the URL's own id", async () => {
    repositoryMock.findTechnicalDemonstrationPlanForOwner.mockResolvedValue({ ...DRAFT_PLAN, clientId: "someone-elses-client" });

    const response = await POST(postReq({ expectedCurrentConfirmedPlanId: null }), ctx());

    expect(response.status).toBe(404);
    expect(repositoryMock.confirmTechnicalDemonstrationPlan).not.toHaveBeenCalled();
  });

  it("returns 404 when a real, owned plan belongs to a DIFFERENT proposal than the URL's own proposalId", async () => {
    repositoryMock.findTechnicalDemonstrationPlanForOwner.mockResolvedValue({ ...DRAFT_PLAN, analysisProposalId: "some-other-proposal" });

    const response = await POST(postReq({ expectedCurrentConfirmedPlanId: null }), ctx());

    expect(response.status).toBe(404);
    expect(repositoryMock.confirmTechnicalDemonstrationPlan).not.toHaveBeenCalled();
  });

  it("returns 400 when expectedCurrentConfirmedPlanId is omitted -- never silently defaulted", async () => {
    const response = await POST(postReq({}), ctx());

    expect(response.status).toBe(400);
    expect(repositoryMock.confirmTechnicalDemonstrationPlan).not.toHaveBeenCalled();
  });

  it("returns 400 for an invalid expectedCurrentConfirmedPlanId (empty string / wrong type)", async () => {
    const emptyString = await POST(postReq({ expectedCurrentConfirmedPlanId: "" }), ctx());
    expect(emptyString.status).toBe(400);

    const wrongType = await POST(postReq({ expectedCurrentConfirmedPlanId: 42 }), ctx());
    expect(wrongType.status).toBe(400);

    expect(repositoryMock.confirmTechnicalDemonstrationPlan).not.toHaveBeenCalled();
  });

  it("returns 400 for an invalid/unparseable JSON body", async () => {
    const badRequest = new Request("http://localhost/api/v1/clients/client-1/analysis-proposals/proposal-1/technical-demonstration-plans/plan-1/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{not json",
    });

    const response = await POST(badRequest, ctx());

    expect(response.status).toBe(400);
    expect(repositoryMock.confirmTechnicalDemonstrationPlan).not.toHaveBeenCalled();
  });

  it("10. confirms a DRAFT plan (no prior confirmed plan for this scope), server-authoritatively sealing it, and returns it with its steps", async () => {
    const response = await POST(postReq({ expectedCurrentConfirmedPlanId: null }), ctx());

    expect(response.status).toBe(200);
    expect(repositoryMock.confirmTechnicalDemonstrationPlan).toHaveBeenCalledWith("owner-1", "plan-1", null);
    expect(repositoryMock.listTechnicalDemonstrationStepsForPlan).toHaveBeenCalledWith("owner-1", "client-1", "plan-1");
    const body = await response.json();
    expect(body.plan).toEqual(CONFIRMED_PLAN);
    expect(body.plan.status).toBe("CONFIRMED");
    expect(body.steps).toEqual(STEPS);
  });

  it("10. confirming supersedes the exact previously-confirmed plan the caller stated it observed", async () => {
    const response = await POST(postReq({ expectedCurrentConfirmedPlanId: "plan-0" }), ctx());

    expect(response.status).toBe(200);
    expect(repositoryMock.confirmTechnicalDemonstrationPlan).toHaveBeenCalledWith("owner-1", "plan-1", "plan-0");
  });

  it("11. a confirmed plan can never silently mutate -- re-confirming an already-CONFIRMED plan is rejected via the repository's own illegal-state-transition error, not silently accepted", async () => {
    repositoryMock.findTechnicalDemonstrationPlanForOwner.mockResolvedValue(CONFIRMED_PLAN);
    repositoryMock.confirmTechnicalDemonstrationPlan.mockRejectedValue(
      new repositoryMock.TechnicalDemonstrationStateError("CONFIRMED", "confirm", "Technical Demonstration Plan plan-1 is CONFIRMED; only a DRAFT plan can be confirmed."),
    );

    const response = await POST(postReq({ expectedCurrentConfirmedPlanId: "plan-1" }), ctx());

    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe("TECHNICAL_DEMONSTRATION_ILLEGAL_STATE_TRANSITION");
  });

  it("stale confirmation attempt (a race confirmed a different plan first) is rejected with the special, information-leak-free 409 -- never the repository's own code/message", async () => {
    repositoryMock.confirmTechnicalDemonstrationPlan.mockRejectedValue(new repositoryMock.TechnicalDemonstrationConcurrencyError());

    const response = await POST(postReq({ expectedCurrentConfirmedPlanId: null }), ctx());

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error).toBe("TECHNICAL_DEMONSTRATION_CONFIRMATION_CONFLICT");
    expect(body.message).not.toContain("Technical Demonstration Plan could not be confirmed because of a concurrent confirmation");
    expect(body.message).toContain("Review the current confirmed plan");
  });

  it("returns 404 if the plan disappears between the ownership check and the confirm call (defensive, not a discovery oracle)", async () => {
    repositoryMock.confirmTechnicalDemonstrationPlan.mockResolvedValue(null);

    const response = await POST(postReq({ expectedCurrentConfirmedPlanId: null }), ctx());

    expect(response.status).toBe(404);
    expect(repositoryMock.listTechnicalDemonstrationStepsForPlan).not.toHaveBeenCalled();
  });

  it("propagates an integrity violation rather than silently resolving it", async () => {
    repositoryMock.confirmTechnicalDemonstrationPlan.mockRejectedValue(
      new repositoryMock.TechnicalDemonstrationInvariantError("integrity violation"),
    );

    const response = await POST(postReq({ expectedCurrentConfirmedPlanId: null }), ctx());

    expect(response.status).toBe(500);
    expect((await response.json()).error).toBe("TECHNICAL_DEMONSTRATION_INVARIANT_VIOLATED");
  });

  it("fails closed with a no-store 503 when the repository reports persistence unavailable", async () => {
    repositoryMock.confirmTechnicalDemonstrationPlan.mockRejectedValue(new repositoryMock.TechnicalDemonstrationPersistenceError());

    const response = await POST(postReq({ expectedCurrentConfirmedPlanId: null }), ctx());

    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
});
