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
    createTechnicalDemonstrationPlanFromProposal: vi.fn(),
    listTechnicalDemonstrationPlansForProposal: vi.fn(),
    resolveEffectiveCuttingStepsForRecord: vi.fn((_plan: unknown, steps: unknown) => steps),
  };
});

vi.mock("@/lib/session-request-auth", () => authMock);
vi.mock("@/lib/client-repository", () => clientRepositoryMock);
vi.mock("@/lib/proposal-repository", () => proposalRepositoryMock);
vi.mock("@/lib/technical-demonstration-repository", () => repositoryMock);

import { GET, POST } from "./route";

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
const PLAN_A = { id: "plan-2", analysisProposalId: "proposal-1", clientId: "client-1", status: "CONFIRMED", planVersion: 2 };
const PLAN_B = { id: "plan-1", analysisProposalId: "proposal-1", clientId: "client-1", status: "SUPERSEDED", planVersion: 1 };
const STEPS = [{ id: "step-1", planId: "plan-2", stepNumber: 1 }];

function ctx(id = "client-1", proposalId = "proposal-1") {
  return { params: Promise.resolve({ id, proposalId }) };
}

function getReq(): Request {
  return new Request("http://localhost/api/v1/clients/client-1/analysis-proposals/proposal-1/technical-demonstration-plans");
}

function postReq(body?: unknown): Request {
  return new Request("http://localhost/api/v1/clients/client-1/analysis-proposals/proposal-1/technical-demonstration-plans", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  authMock.authenticateSessionRequest.mockResolvedValue(OWNER);
  clientRepositoryMock.resolveOwnedClient.mockResolvedValue(CLIENT);
  proposalRepositoryMock.findProposalForOwner.mockResolvedValue(PROPOSAL);
  repositoryMock.createTechnicalDemonstrationPlanFromProposal.mockResolvedValue({ plan: PLAN_A, steps: STEPS, created: true });
  repositoryMock.listTechnicalDemonstrationPlansForProposal.mockResolvedValue([PLAN_A, PLAN_B]);
});

describe("GET /api/v1/clients/[id]/analysis-proposals/[proposalId]/technical-demonstration-plans", () => {
  it("returns 401 without a session and touches nothing", async () => {
    authMock.authenticateSessionRequest.mockResolvedValue(null);

    const response = await GET(getReq(), ctx());

    expect(response.status).toBe(401);
    expect(clientRepositoryMock.resolveOwnedClient).not.toHaveBeenCalled();
    expect(repositoryMock.listTechnicalDemonstrationPlansForProposal).not.toHaveBeenCalled();
  });

  it("returns 404 for a foreign/nonexistent client, before resolving the proposal", async () => {
    clientRepositoryMock.resolveOwnedClient.mockResolvedValue(null);

    const response = await GET(getReq(), ctx());

    expect(response.status).toBe(404);
    expect(proposalRepositoryMock.findProposalForOwner).not.toHaveBeenCalled();
  });

  it("hides history for a foreign or nonexistent proposal with a generic 404, never calling the repository", async () => {
    proposalRepositoryMock.findProposalForOwner.mockResolvedValue(null);

    const response = await GET(getReq(), ctx());

    expect(response.status).toBe(404);
    expect((await response.json()).error).toBe("Proposal not found.");
    expect(repositoryMock.listTechnicalDemonstrationPlansForProposal).not.toHaveBeenCalled();
  });

  it("hides history when the proposal belongs to a different client (byte-identical 404, no discovery oracle)", async () => {
    proposalRepositoryMock.findProposalForOwner.mockResolvedValueOnce(null);
    const absent = await GET(getReq(), ctx());
    const absentBody = await absent.json();

    proposalRepositoryMock.findProposalForOwner.mockResolvedValueOnce({ ...PROPOSAL, clientId: "someone-elses-client" });
    const foreign = await GET(getReq(), ctx());
    const foreignBody = await foreign.json();

    expect(foreign.status).toBe(absent.status);
    expect(foreignBody).toEqual(absentBody);
    expect(repositoryMock.listTechnicalDemonstrationPlansForProposal).not.toHaveBeenCalled();
  });

  it("returns the exact owned proposal's history, in the order the repository returns it, using its own vertical", async () => {
    const response = await GET(getReq(), ctx());

    expect(response.status).toBe(200);
    expect(repositoryMock.listTechnicalDemonstrationPlansForProposal).toHaveBeenCalledWith("owner-1", "client-1", "proposal-1", "cutting");
    expect(await response.json()).toEqual({ plans: [PLAN_A, PLAN_B] });
  });

  it("history preserves DRAFT/CONFIRMED/SUPERSEDED rows exactly as the repository returns them", async () => {
    const draft = { ...PLAN_A, id: "plan-3", status: "DRAFT", planVersion: 3 };
    repositoryMock.listTechnicalDemonstrationPlansForProposal.mockResolvedValue([draft, PLAN_A, PLAN_B]);

    const response = await GET(getReq(), ctx());

    expect(await response.json()).toEqual({ plans: [draft, PLAN_A, PLAN_B] });
  });

  it("fails closed with a no-store 503 when the repository reports persistence unavailable", async () => {
    repositoryMock.listTechnicalDemonstrationPlansForProposal.mockRejectedValue(new repositoryMock.TechnicalDemonstrationPersistenceError());

    const response = await GET(getReq(), ctx());

    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
});

describe("POST /api/v1/clients/[id]/analysis-proposals/[proposalId]/technical-demonstration-plans", () => {
  it("1. authenticated owner derives a DRAFT Technical Demonstration Plan from their owned CONFIRMED cutting proposal", async () => {
    const response = await POST(postReq(), ctx());

    expect(response.status).toBe(201);
    expect(repositoryMock.createTechnicalDemonstrationPlanFromProposal).toHaveBeenCalledWith("owner-1", "client-1", "proposal-1");
    expect(await response.json()).toEqual({ plan: PLAN_A, steps: STEPS, effectiveSteps: STEPS, created: true });
  });

  it("2. an idempotent reopen (same exact confirmed proposal version) returns 200, not 201, with created: false", async () => {
    repositoryMock.createTechnicalDemonstrationPlanFromProposal.mockResolvedValue({ plan: PLAN_A, steps: STEPS, created: false });

    const response = await POST(postReq(), ctx());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ plan: PLAN_A, steps: STEPS, effectiveSteps: STEPS, created: false });
  });

  it("unauthenticated is blocked, touching nothing", async () => {
    authMock.authenticateSessionRequest.mockResolvedValue(null);

    const response = await POST(postReq(), ctx());

    expect(response.status).toBe(401);
    expect(repositoryMock.createTechnicalDemonstrationPlanFromProposal).not.toHaveBeenCalled();
  });

  it("foreign/nonexistent client is blocked with 404, never calling the repository", async () => {
    clientRepositoryMock.resolveOwnedClient.mockResolvedValue(null);

    const response = await POST(postReq(), ctx());

    expect(response.status).toBe(404);
    expect(repositoryMock.createTechnicalDemonstrationPlanFromProposal).not.toHaveBeenCalled();
  });

  it("3. never derives from a non-CONFIRMED proposal -- the repository's own dependency error (422) is propagated, not swallowed", async () => {
    repositoryMock.createTechnicalDemonstrationPlanFromProposal.mockRejectedValue(
      new repositoryMock.TechnicalDemonstrationDependencyError(
        "TECHNICAL_DEMONSTRATION_PROPOSAL_NOT_CONFIRMED",
        422,
        "Only a CONFIRMED proposal can produce a Technical Demonstration Plan.",
      ),
    );

    const response = await POST(postReq(), ctx());

    expect(response.status).toBe(422);
    expect((await response.json()).error).toBe("TECHNICAL_DEMONSTRATION_PROPOSAL_NOT_CONFIRMED");
  });

  it("an unknown/foreign-owner proposal is rejected via the repository's own dependency error", async () => {
    repositoryMock.createTechnicalDemonstrationPlanFromProposal.mockRejectedValue(
      new repositoryMock.TechnicalDemonstrationDependencyError("TECHNICAL_DEMONSTRATION_PROPOSAL_NOT_FOUND", 404, "Proposal not found."),
    );

    const response = await POST(postReq(), ctx());

    expect(response.status).toBe(404);
    expect((await response.json()).error).toBe("TECHNICAL_DEMONSTRATION_PROPOSAL_NOT_FOUND");
  });

  it("a proposal/client mismatch is rejected via the repository's own dependency error", async () => {
    repositoryMock.createTechnicalDemonstrationPlanFromProposal.mockRejectedValue(
      new repositoryMock.TechnicalDemonstrationDependencyError(
        "TECHNICAL_DEMONSTRATION_PROPOSAL_CLIENT_MISMATCH",
        404,
        "Proposal does not belong to this client.",
      ),
    );

    const response = await POST(postReq(), ctx());

    expect(response.status).toBe(404);
    expect((await response.json()).error).toBe("TECHNICAL_DEMONSTRATION_PROPOSAL_CLIENT_MISMATCH");
  });

  it("4. an unsupported vertical is rejected with 422, never silently ignored", async () => {
    repositoryMock.createTechnicalDemonstrationPlanFromProposal.mockRejectedValue(
      new repositoryMock.TechnicalDemonstrationDependencyError(
        "TECHNICAL_DEMONSTRATION_VERTICAL_NOT_SUPPORTED",
        422,
        'Technical Demonstration does not yet support the "color" vertical.',
      ),
    );

    const response = await POST(postReq(), ctx());

    expect(response.status).toBe(422);
    expect((await response.json()).error).toBe("TECHNICAL_DEMONSTRATION_VERTICAL_NOT_SUPPORTED");
  });

  it("a malformed derived payload is rejected safely (500, not silently persisted)", async () => {
    repositoryMock.createTechnicalDemonstrationPlanFromProposal.mockRejectedValue(
      new repositoryMock.TechnicalDemonstrationValidationError("Derived step 1 produced a structurally invalid payload -- refusing to persist."),
    );

    const response = await POST(postReq(), ctx());

    expect(response.status).toBe(500);
    expect((await response.json()).error).toBe("TECHNICAL_DEMONSTRATION_INVALID_DERIVED_PAYLOAD");
  });

  it("reads no request body at all -- nothing in the body can influence derivation", async () => {
    const response = await POST(
      postReq({
        plan: { planVersion: 999, status: "CONFIRMED" },
        steps: [{ stepNumber: 1, payload: { zones: { value: ["evil"], provenance: "OBSERVED" } } }],
      }),
      ctx(),
    );

    expect(response.status).toBe(201);
    expect(repositoryMock.createTechnicalDemonstrationPlanFromProposal).toHaveBeenCalledWith("owner-1", "client-1", "proposal-1");
    expect(repositoryMock.createTechnicalDemonstrationPlanFromProposal).toHaveBeenCalledTimes(1);
  });

  it("a request with NO body at all (undefined) behaves identically -- the body is never required or read", async () => {
    const response = await POST(postReq(undefined), ctx());

    expect(response.status).toBe(201);
    expect(repositoryMock.createTechnicalDemonstrationPlanFromProposal).toHaveBeenCalledWith("owner-1", "client-1", "proposal-1");
  });

  it("fails closed with a no-store 503 when the repository reports persistence unavailable", async () => {
    repositoryMock.createTechnicalDemonstrationPlanFromProposal.mockRejectedValue(new repositoryMock.TechnicalDemonstrationPersistenceError());

    const response = await POST(postReq(), ctx());

    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("maps a TechnicalDemonstrationConcurrencyError (exhausted allocation retries) to 409", async () => {
    repositoryMock.createTechnicalDemonstrationPlanFromProposal.mockRejectedValue(new repositoryMock.TechnicalDemonstrationConcurrencyError());

    const response = await POST(postReq(), ctx());

    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe("TECHNICAL_DEMONSTRATION_CONCURRENCY_CONFLICT");
  });
});
