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
  return {
    ProposalPersistenceError,
    ProposalDependencyError,
    ProposalValidationError,
    ProposalStateError,
    ProposalConcurrencyError,
    findProposalForOwner: vi.fn(),
    rejectProposal: vi.fn(),
  };
});

vi.mock("@/lib/session-request-auth", () => authMock);
vi.mock("@/lib/client-repository", () => clientRepositoryMock);
vi.mock("@/lib/proposal-repository", () => proposalRepositoryMock);

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
const PROPOSAL = {
  id: "proposal-1",
  clientId: "client-1",
  analysisId: "analysis-1",
  vertical: "cutting",
  status: "DRAFT",
  edits: [],
};
const REJECTED = { ...PROPOSAL, status: "REJECTED", rejectedAt: "2026-08-27T00:00:00.000Z" };

function ctx(id = "client-1", proposalId = "proposal-1") {
  return { params: Promise.resolve({ id, proposalId }) };
}

function req(): Request {
  return new Request("http://localhost/api/v1/clients/client-1/analysis-proposals/proposal-1/reject", {
    method: "POST",
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  authMock.authenticateSessionRequest.mockResolvedValue(OWNER);
  clientRepositoryMock.resolveOwnedClient.mockResolvedValue(CLIENT);
  proposalRepositoryMock.findProposalForOwner.mockResolvedValue(PROPOSAL);
  proposalRepositoryMock.rejectProposal.mockResolvedValue(REJECTED);
});

describe("POST /api/v1/clients/[id]/analysis-proposals/[proposalId]/reject", () => {
  it("returns 401 without a session and never resolves the client, proposal, or rejects", async () => {
    authMock.authenticateSessionRequest.mockResolvedValue(null);

    const response = await POST(req(), ctx());

    expect(response.status).toBe(401);
    expect(clientRepositoryMock.resolveOwnedClient).not.toHaveBeenCalled();
    expect(proposalRepositoryMock.findProposalForOwner).not.toHaveBeenCalled();
    expect(proposalRepositoryMock.rejectProposal).not.toHaveBeenCalled();
  });

  it("returns 404 'Client not found.' for a foreign/nonexistent client, before resolving the proposal", async () => {
    clientRepositoryMock.resolveOwnedClient.mockResolvedValue(null);

    const response = await POST(req(), ctx());

    expect(response.status).toBe(404);
    expect((await response.json()).error).toBe("Client not found.");
    expect(proposalRepositoryMock.findProposalForOwner).not.toHaveBeenCalled();
    expect(proposalRepositoryMock.rejectProposal).not.toHaveBeenCalled();
  });

  it("passes through a Response returned by resolveOwnedClient as-is (e.g. persistence unavailable)", async () => {
    const dbDownResponse = Response.json({ error: "CLIENT_PERSISTENCE_UNAVAILABLE" }, { status: 503 });
    clientRepositoryMock.resolveOwnedClient.mockResolvedValue(dbDownResponse);

    const response = await POST(req(), ctx());

    expect(response).toBe(dbDownResponse);
    expect(proposalRepositoryMock.rejectProposal).not.toHaveBeenCalled();
  });

  it("returns 404 'Proposal not found.' when the proposal does not exist, without rejecting", async () => {
    proposalRepositoryMock.findProposalForOwner.mockResolvedValue(null);

    const response = await POST(req(), ctx());

    expect(response.status).toBe(404);
    expect((await response.json()).error).toBe("Proposal not found.");
    expect(proposalRepositoryMock.rejectProposal).not.toHaveBeenCalled();
  });

  it("returns a BYTE-IDENTICAL 404 when the proposal belongs to a foreign client (no discovery oracle)", async () => {
    proposalRepositoryMock.findProposalForOwner.mockResolvedValueOnce(null);
    const absent = await POST(req(), ctx());
    const absentBody = await absent.json();

    proposalRepositoryMock.findProposalForOwner.mockResolvedValueOnce({ ...PROPOSAL, clientId: "someone-elses-client" });
    const foreign = await POST(req(), ctx());
    const foreignBody = await foreign.json();

    expect(foreign.status).toBe(absent.status);
    expect(foreignBody).toEqual(absentBody);
    expect(foreignBody).toEqual({ error: "Proposal not found." });
    expect(proposalRepositoryMock.rejectProposal).not.toHaveBeenCalled();
  });

  it("succeeds on a DRAFT target, forwarding the exact arguments and returning the rejected proposal", async () => {
    const response = await POST(req(), ctx());

    expect(response.status).toBe(200);
    expect(proposalRepositoryMock.rejectProposal).toHaveBeenCalledWith("owner-1", "proposal-1");
    expect(await response.json()).toEqual({ proposal: REJECTED });
  });

  it("returns 404 defensively when rejectProposal resolves null", async () => {
    proposalRepositoryMock.rejectProposal.mockResolvedValue(null);

    const response = await POST(req(), ctx());

    expect(response.status).toBe(404);
    expect((await response.json()).error).toBe("Proposal not found.");
  });

  it.each(["CONFIRMED", "SUPERSEDED"])(
    "maps rejectProposal's ProposalStateError from a %s target to 409 with the repository's own code (invalid transition blocked)",
    async (fromStatus) => {
      proposalRepositoryMock.rejectProposal.mockRejectedValue(
        new proposalRepositoryMock.ProposalStateError(
          fromStatus,
          "reject",
          `Proposal proposal-1 is ${fromStatus}; only a DRAFT proposal can be rejected.`,
        ),
      );

      const response = await POST(req(), ctx());

      expect(response.status).toBe(409);
      expect((await response.json()).error).toBe("PROPOSAL_ILLEGAL_STATE_TRANSITION");
    },
  );

  it("a repeated reject on an already-REJECTED target maps to 409 and calls rejectProposal exactly once (no state corruption)", async () => {
    proposalRepositoryMock.rejectProposal.mockRejectedValue(
      new proposalRepositoryMock.ProposalStateError(
        "REJECTED",
        "reject",
        "Proposal proposal-1 is REJECTED; only a DRAFT proposal can be rejected.",
      ),
    );

    const response = await POST(req(), ctx());

    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe("PROPOSAL_ILLEGAL_STATE_TRANSITION");
    expect(proposalRepositoryMock.rejectProposal).toHaveBeenCalledTimes(1);
  });

  it("maps rejectProposal's ProposalDependencyError via its own code/httpStatus", async () => {
    proposalRepositoryMock.rejectProposal.mockRejectedValue(
      new proposalRepositoryMock.ProposalDependencyError("PROPOSAL_DEPENDENCY_CHANGED", 409, "Proposal dependencies changed."),
    );

    const response = await POST(req(), ctx());

    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe("PROPOSAL_DEPENDENCY_CHANGED");
  });

  it("fails closed with a no-store 503 when rejectProposal reports persistence unavailable", async () => {
    proposalRepositoryMock.rejectProposal.mockRejectedValue(new proposalRepositoryMock.ProposalPersistenceError());

    const response = await POST(req(), ctx());

    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
});
