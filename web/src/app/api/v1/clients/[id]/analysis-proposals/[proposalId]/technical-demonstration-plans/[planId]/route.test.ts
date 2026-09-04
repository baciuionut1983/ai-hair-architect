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
  class TechnicalDemonstrationOverrideValidationError extends Error {
    readonly code = "TECHNICAL_DEMONSTRATION_INVALID_OVERRIDE";
    readonly httpStatus = 422;
    constructor(message: string) {
      super(message);
      this.name = "TechnicalDemonstrationOverrideValidationError";
    }
  }
  class TechnicalDemonstrationStateError extends Error {
    readonly code = "TECHNICAL_DEMONSTRATION_ILLEGAL_STATE_TRANSITION";
    readonly httpStatus = 409;
    constructor(
      readonly fromStatus: string,
      readonly attempted: "confirm" | "adjust",
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
    TechnicalDemonstrationOverrideValidationError,
    TechnicalDemonstrationStateError,
    TechnicalDemonstrationConcurrencyError,
    TechnicalDemonstrationInvariantError,
    findTechnicalDemonstrationPlanForOwner: vi.fn(),
    listTechnicalDemonstrationStepsForPlan: vi.fn(),
    applyOverridesToDraft: vi.fn(),
    resolveEffectiveCuttingStepsForRecord: vi.fn((_plan: unknown, steps: unknown) => steps),
  };
});

vi.mock("@/lib/session-request-auth", () => authMock);
vi.mock("@/lib/client-repository", () => clientRepositoryMock);
vi.mock("@/lib/technical-demonstration-repository", () => repositoryMock);

import { GET, PATCH } from "./route";

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
const PLAN = { id: "plan-1", analysisProposalId: "proposal-1", clientId: "client-1", status: "DRAFT", planVersion: 1, professionalOverrides: [] };
const STEPS = [{ id: "step-1", planId: "plan-1", stepNumber: 1 }];

function ctx(id = "client-1", proposalId = "proposal-1", planId = "plan-1") {
  return { params: Promise.resolve({ id, proposalId, planId }) };
}

function getReq(): Request {
  return new Request("http://localhost/api/v1/clients/client-1/analysis-proposals/proposal-1/technical-demonstration-plans/plan-1");
}

function patchReq(body?: unknown): Request {
  return new Request("http://localhost/api/v1/clients/client-1/analysis-proposals/proposal-1/technical-demonstration-plans/plan-1", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  authMock.authenticateSessionRequest.mockResolvedValue(OWNER);
  clientRepositoryMock.resolveOwnedClient.mockResolvedValue(CLIENT);
  repositoryMock.findTechnicalDemonstrationPlanForOwner.mockResolvedValue(PLAN);
  repositoryMock.listTechnicalDemonstrationStepsForPlan.mockResolvedValue(STEPS);
  repositoryMock.applyOverridesToDraft.mockResolvedValue(PLAN);
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

  it("returns the exact owned, correctly-related plan with its ordered steps and effective steps", async () => {
    const response = await GET(getReq(), ctx());

    expect(response.status).toBe(200);
    expect(repositoryMock.listTechnicalDemonstrationStepsForPlan).toHaveBeenCalledWith("owner-1", "client-1", "plan-1");
    expect(await response.json()).toEqual({ plan: PLAN, steps: STEPS, effectiveSteps: STEPS });
  });

  it("fails closed with a no-store 503 when the repository reports persistence unavailable", async () => {
    repositoryMock.findTechnicalDemonstrationPlanForOwner.mockRejectedValue(new repositoryMock.TechnicalDemonstrationPersistenceError());

    const response = await GET(getReq(), ctx());

    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
});

// Stage 2.5.b -- PATCH (professional overrides).
describe("PATCH /api/v1/clients/[id]/analysis-proposals/[proposalId]/technical-demonstration-plans/[planId]", () => {
  const VALID_OVERRIDE = { op: "set_value", stepNumber: 1, field: "tool", value: "custom-shears" };

  it("returns 401 without a session and touches nothing", async () => {
    authMock.authenticateSessionRequest.mockResolvedValue(null);

    const response = await PATCH(patchReq({ overrides: [VALID_OVERRIDE] }), ctx());

    expect(response.status).toBe(401);
    expect(repositoryMock.applyOverridesToDraft).not.toHaveBeenCalled();
  });

  it("returns 404 for a foreign/nonexistent client, before resolving the plan", async () => {
    clientRepositoryMock.resolveOwnedClient.mockResolvedValue(null);

    const response = await PATCH(patchReq({ overrides: [VALID_OVERRIDE] }), ctx());

    expect(response.status).toBe(404);
    expect(repositoryMock.applyOverridesToDraft).not.toHaveBeenCalled();
  });

  it("returns 404 for a nonexistent/foreign-owner plan id, never reading the body or calling applyOverridesToDraft", async () => {
    repositoryMock.findTechnicalDemonstrationPlanForOwner.mockResolvedValue(null);

    const response = await PATCH(patchReq({ overrides: [VALID_OVERRIDE] }), ctx());

    expect(response.status).toBe(404);
    expect(repositoryMock.applyOverridesToDraft).not.toHaveBeenCalled();
  });

  it("returns 404 when a real, owned plan belongs to a DIFFERENT client or proposal than the URL", async () => {
    repositoryMock.findTechnicalDemonstrationPlanForOwner.mockResolvedValue({ ...PLAN, clientId: "someone-elses-client" });

    const response = await PATCH(patchReq({ overrides: [VALID_OVERRIDE] }), ctx());

    expect(response.status).toBe(404);
    expect(repositoryMock.applyOverridesToDraft).not.toHaveBeenCalled();
  });

  it("returns 400 for an invalid/unparseable JSON body", async () => {
    const badRequest = new Request("http://localhost/api/v1/clients/client-1/analysis-proposals/proposal-1/technical-demonstration-plans/plan-1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: "{not json",
    });

    const response = await PATCH(badRequest, ctx());

    expect(response.status).toBe(400);
    expect(repositoryMock.applyOverridesToDraft).not.toHaveBeenCalled();
  });

  it("returns 400 when `overrides` is missing, empty, or not an array", async () => {
    expect((await PATCH(patchReq({}), ctx())).status).toBe(400);
    expect((await PATCH(patchReq({ overrides: [] }), ctx())).status).toBe(400);
    expect((await PATCH(patchReq({ overrides: "not-an-array" }), ctx())).status).toBe(400);
    expect(repositoryMock.applyOverridesToDraft).not.toHaveBeenCalled();
  });

  it("returns 400 for a structurally invalid override entry, never forwarding it to the repository", async () => {
    const response = await PATCH(patchReq({ overrides: [{ op: "set_value", stepNumber: 1, field: "elevation", value: "not_a_real_elevation" }] }), ctx());

    expect(response.status).toBe(400);
    expect(repositoryMock.applyOverridesToDraft).not.toHaveBeenCalled();
  });

  it("accepts a valid override and forwards exactly the caller-suppliable shape to applyOverridesToDraft -- source/setAt are never read from the request body", async () => {
    const attackerBody = {
      overrides: [{ ...VALID_OVERRIDE, source: "not-a-professional", setAt: "2000-01-01T00:00:00.000Z" }],
    };
    const response = await PATCH(patchReq(attackerBody), ctx());

    expect(response.status).toBe(200);
    expect(repositoryMock.applyOverridesToDraft).toHaveBeenCalledWith(
      "owner-1",
      "client-1",
      "plan-1",
      // The forwarded array still literally contains whatever extra keys the
      // caller sent (route-level validation doesn't strip them) -- but
      // toCuttingStepOverrideEntry (a REAL, unmocked repository-layer
      // function, proven in technical-demonstration-cutting-overrides.test.ts)
      // is what actually persists an entry, and it NEVER reads source/setAt
      // from its input; only stamps its own server-side values. This test
      // proves the ROUTE forwards the body unmodified to the repository --
      // the repository's own tests prove the stamping discipline.
      [expect.objectContaining({ op: "set_value", stepNumber: 1, field: "tool", value: "custom-shears" })],
    );
    const body = await response.json();
    expect(body.plan).toEqual(PLAN);
    expect(body.effectiveSteps).toEqual(STEPS);
  });

  it("returns 404 if the plan disappears between the ownership check and the write (defensive, never a discovery oracle)", async () => {
    repositoryMock.applyOverridesToDraft.mockResolvedValue(null);

    const response = await PATCH(patchReq({ overrides: [VALID_OVERRIDE] }), ctx());

    expect(response.status).toBe(404);
    expect(repositoryMock.listTechnicalDemonstrationStepsForPlan).not.toHaveBeenCalled();
  });

  it("maps a TechnicalDemonstrationStateError (non-DRAFT plan) to 409, never silently reopening the plan", async () => {
    repositoryMock.applyOverridesToDraft.mockRejectedValue(
      new repositoryMock.TechnicalDemonstrationStateError("CONFIRMED", "adjust", "Technical Demonstration Plan plan-1 is CONFIRMED; only a DRAFT plan can receive professional overrides."),
    );

    const response = await PATCH(patchReq({ overrides: [VALID_OVERRIDE] }), ctx());

    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe("TECHNICAL_DEMONSTRATION_ILLEGAL_STATE_TRANSITION");
  });

  it("maps a TechnicalDemonstrationOverrideValidationError (e.g. nonexistent stepNumber) to 422", async () => {
    repositoryMock.applyOverridesToDraft.mockRejectedValue(
      new repositoryMock.TechnicalDemonstrationOverrideValidationError("Step 999 does not exist on this plan."),
    );

    const response = await PATCH(patchReq({ overrides: [{ op: "set_value", stepNumber: 999, field: "tool", value: "x" }] }), ctx());

    expect(response.status).toBe(422);
    expect((await response.json()).error).toBe("TECHNICAL_DEMONSTRATION_INVALID_OVERRIDE");
  });

  it("fails closed with a no-store 503 when the repository reports persistence unavailable", async () => {
    repositoryMock.applyOverridesToDraft.mockRejectedValue(new repositoryMock.TechnicalDemonstrationPersistenceError());

    const response = await PATCH(patchReq({ overrides: [VALID_OVERRIDE] }), ctx());

    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
});
