import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.hoisted(() => ({ authenticateSessionRequest: vi.fn() }));
const clientRepositoryMock = vi.hoisted(() => ({ resolveOwnedClient: vi.fn() }));
const proposalRepositoryMock = vi.hoisted(() => {
  class ProposalPersistenceError extends Error {
    readonly code = "PROPOSAL_PERSISTENCE_UNAVAILABLE";
    readonly httpStatus = 503;
    constructor() {
      super("Proposal data is temporarily unavailable.");
      this.name = "ProposalPersistenceError";
    }
  }
  class ProposalDependencyError extends Error {
    constructor(
      readonly code: string,
      readonly httpStatus: number,
      message: string,
    ) {
      super(message);
      this.name = "ProposalDependencyError";
    }
  }
  class ProposalValidationError extends Error {
    readonly httpStatus = 422;
    constructor(
      readonly code: string,
      message: string,
    ) {
      super(message);
      this.name = "ProposalValidationError";
    }
  }
  class ProposalStateError extends Error {
    readonly code = "PROPOSAL_ILLEGAL_STATE_TRANSITION";
    readonly httpStatus = 409;
    constructor(
      readonly fromStatus: string,
      readonly attempted: "edit" | "reject" | "confirm",
      message: string,
    ) {
      super(message);
      this.name = "ProposalStateError";
    }
  }
  class ProposalConcurrencyError extends Error {
    readonly code = "PROPOSAL_CONCURRENCY_CONFLICT";
    readonly httpStatus = 409;
    constructor() {
      super("Proposal could not be confirmed because of a concurrent confirmation.");
      this.name = "ProposalConcurrencyError";
    }
  }
  class ProposalInvariantError extends Error {
    readonly code = "PROPOSAL_CONFIRMED_INVARIANT_VIOLATED";
    readonly httpStatus = 500;
    constructor(message: string) {
      super(message);
      this.name = "ProposalInvariantError";
    }
  }
  return {
    ProposalPersistenceError,
    ProposalDependencyError,
    ProposalValidationError,
    ProposalStateError,
    ProposalConcurrencyError,
    ProposalInvariantError,
    findCurrentConfirmedProposal: vi.fn(),
  };
});

vi.mock("@/lib/session-request-auth", () => authMock);
vi.mock("@/lib/client-repository", () => clientRepositoryMock);
vi.mock("@/lib/proposal-repository", () => proposalRepositoryMock);

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
const CONFIRMED = {
  id: "proposal-7",
  clientId: "client-1",
  analysisId: "analysis-1",
  vertical: "cutting",
  status: "CONFIRMED",
  confirmedByUserId: "owner-1",
  confirmedAt: "2026-08-27T10:00:00.000Z",
};

const params = { params: Promise.resolve({ id: "client-1" }) };

function req(query = "?vertical=cutting"): Request {
  return new Request(`http://localhost/api/v1/clients/client-1/analysis-proposals/current${query}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  authMock.authenticateSessionRequest.mockResolvedValue(OWNER);
  clientRepositoryMock.resolveOwnedClient.mockResolvedValue(CLIENT);
  proposalRepositoryMock.findCurrentConfirmedProposal.mockResolvedValue(CONFIRMED);
});

describe("GET /api/v1/clients/[id]/analysis-proposals/current", () => {
  it("returns 401 without a session and never touches the domain layer", async () => {
    authMock.authenticateSessionRequest.mockResolvedValue(null);

    const response = await GET(req(), params);

    expect(response.status).toBe(401);
    expect(proposalRepositoryMock.findCurrentConfirmedProposal).not.toHaveBeenCalled();
  });

  it("returns 404 for a foreign/nonexistent client", async () => {
    clientRepositoryMock.resolveOwnedClient.mockResolvedValue(null);

    const response = await GET(req(), params);

    expect(response.status).toBe(404);
    expect(proposalRepositoryMock.findCurrentConfirmedProposal).not.toHaveBeenCalled();
  });

  it("returns 400 when the vertical query param is missing", async () => {
    const response = await GET(req(""), params);

    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("PROPOSAL_INVALID_VERTICAL");
    expect(proposalRepositoryMock.findCurrentConfirmedProposal).not.toHaveBeenCalled();
  });

  it("returns 400 when the vertical query param is not supported", async () => {
    const response = await GET(req("?vertical=treatment"), params);

    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("PROPOSAL_INVALID_VERTICAL");
    expect(proposalRepositoryMock.findCurrentConfirmedProposal).not.toHaveBeenCalled();
  });

  it("returns 200 with the authoritative CONFIRMED proposal", async () => {
    const response = await GET(req("?vertical=cutting"), params);

    expect(response.status).toBe(200);
    expect(proposalRepositoryMock.findCurrentConfirmedProposal).toHaveBeenCalledWith("owner-1", "client-1", "cutting");
    expect(await response.json()).toEqual({ proposal: CONFIRMED });
  });

  it("returns 200 with { proposal: null } when there is no confirmed proposal yet (never a 404)", async () => {
    proposalRepositoryMock.findCurrentConfirmedProposal.mockResolvedValue(null);

    const response = await GET(req("?vertical=cutting"), params);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ proposal: null });
  });

  it("re-throws ProposalInvariantError (the impossible >1 CONFIRMED state) rather than fabricating an empty result", async () => {
    proposalRepositoryMock.findCurrentConfirmedProposal.mockRejectedValue(
      new proposalRepositoryMock.ProposalInvariantError(
        'Found 2 CONFIRMED "cutting" proposals for one client -- the partial unique index should make this impossible.',
      ),
    );

    await expect(GET(req("?vertical=cutting"), params)).rejects.toThrow(/Found 2 CONFIRMED/);
  });

  it("fails closed with a no-store 503 when proposal persistence is unavailable", async () => {
    proposalRepositoryMock.findCurrentConfirmedProposal.mockRejectedValue(new proposalRepositoryMock.ProposalPersistenceError());

    const response = await GET(req("?vertical=cutting"), params);

    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
});
