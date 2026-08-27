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
    confirmProposal: vi.fn(),
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
const CONFIRMED = { ...PROPOSAL, status: "CONFIRMED", confirmedByUserId: "owner-1", confirmedAt: "2026-08-27T00:00:00.000Z" };

const CONFLICT_BODY = {
  error: "ANALYSIS_PROPOSAL_CONFIRMATION_CONFLICT",
  message: "Another proposal was confirmed while this draft was open. Review the current confirmed proposal before replacing it.",
};

function ctx(id = "client-1", proposalId = "proposal-1") {
  return { params: Promise.resolve({ id, proposalId }) };
}

function req(body: unknown): Request {
  return new Request("http://localhost/api/v1/clients/client-1/analysis-proposals/proposal-1/confirm", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function rawReq(rawBody: string): Request {
  return new Request("http://localhost/api/v1/clients/client-1/analysis-proposals/proposal-1/confirm", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: rawBody,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  authMock.authenticateSessionRequest.mockResolvedValue(OWNER);
  clientRepositoryMock.resolveOwnedClient.mockResolvedValue(CLIENT);
  proposalRepositoryMock.findProposalForOwner.mockResolvedValue(PROPOSAL);
  proposalRepositoryMock.confirmProposal.mockResolvedValue(CONFIRMED);
});

describe("POST /api/v1/clients/[id]/analysis-proposals/[proposalId]/confirm", () => {
  it("returns 401 without a session and never resolves the client, proposal, or confirms", async () => {
    authMock.authenticateSessionRequest.mockResolvedValue(null);

    const response = await POST(req({ expectedCurrentConfirmedProposalId: null }), ctx());

    expect(response.status).toBe(401);
    expect(clientRepositoryMock.resolveOwnedClient).not.toHaveBeenCalled();
    expect(proposalRepositoryMock.findProposalForOwner).not.toHaveBeenCalled();
    expect(proposalRepositoryMock.confirmProposal).not.toHaveBeenCalled();
  });

  it("returns 404 'Client not found.' for a foreign/nonexistent client, before resolving the proposal", async () => {
    clientRepositoryMock.resolveOwnedClient.mockResolvedValue(null);

    const response = await POST(req({ expectedCurrentConfirmedProposalId: null }), ctx());

    expect(response.status).toBe(404);
    expect((await response.json()).error).toBe("Client not found.");
    expect(proposalRepositoryMock.findProposalForOwner).not.toHaveBeenCalled();
    expect(proposalRepositoryMock.confirmProposal).not.toHaveBeenCalled();
  });

  it("passes through a Response returned by resolveOwnedClient as-is (e.g. persistence unavailable)", async () => {
    const dbDownResponse = Response.json({ error: "CLIENT_PERSISTENCE_UNAVAILABLE" }, { status: 503 });
    clientRepositoryMock.resolveOwnedClient.mockResolvedValue(dbDownResponse);

    const response = await POST(req({ expectedCurrentConfirmedProposalId: null }), ctx());

    expect(response).toBe(dbDownResponse);
    expect(proposalRepositoryMock.confirmProposal).not.toHaveBeenCalled();
  });

  it("returns 404 'Proposal not found.' when the proposal does not exist, without confirming", async () => {
    proposalRepositoryMock.findProposalForOwner.mockResolvedValue(null);

    const response = await POST(req({ expectedCurrentConfirmedProposalId: null }), ctx());

    expect(response.status).toBe(404);
    expect((await response.json()).error).toBe("Proposal not found.");
    expect(proposalRepositoryMock.confirmProposal).not.toHaveBeenCalled();
  });

  it("returns a BYTE-IDENTICAL 404 when the proposal belongs to a foreign client (no discovery oracle)", async () => {
    proposalRepositoryMock.findProposalForOwner.mockResolvedValueOnce(null);
    const absent = await POST(req({ expectedCurrentConfirmedProposalId: null }), ctx());
    const absentBody = await absent.json();

    proposalRepositoryMock.findProposalForOwner.mockResolvedValueOnce({ ...PROPOSAL, clientId: "someone-elses-client" });
    const foreign = await POST(req({ expectedCurrentConfirmedProposalId: null }), ctx());
    const foreignBody = await foreign.json();

    expect(foreign.status).toBe(absent.status);
    expect(foreignBody).toEqual(absentBody);
    expect(foreignBody).toEqual({ error: "Proposal not found." });
    expect(proposalRepositoryMock.confirmProposal).not.toHaveBeenCalled();
  });

  it("returns 400 when the request body is not valid JSON", async () => {
    const response = await POST(rawReq("{oops"), ctx());

    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("Invalid request body.");
    expect(proposalRepositoryMock.confirmProposal).not.toHaveBeenCalled();
  });

  it("returns 400 when the expectedCurrentConfirmedProposalId key is omitted entirely", async () => {
    const response = await POST(req({}), ctx());

    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe(
      "expectedCurrentConfirmedProposalId (string or null) is required.",
    );
    expect(proposalRepositoryMock.confirmProposal).not.toHaveBeenCalled();
  });

  it.each([
    ["a number", 42],
    ["an object", { id: "x" }],
    ["a boolean", true],
    ["an empty string", ""],
  ])("returns 400 when expectedCurrentConfirmedProposalId is %s", async (_label, value) => {
    const response = await POST(req({ expectedCurrentConfirmedProposalId: value }), ctx());

    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe(
      "expectedCurrentConfirmedProposalId (string or null) is required.",
    );
    expect(proposalRepositoryMock.confirmProposal).not.toHaveBeenCalled();
  });

  it("null expectedCurrentConfirmedProposalId (no prior confirmed) succeeds and forwards the exact arguments", async () => {
    const response = await POST(req({ expectedCurrentConfirmedProposalId: null }), ctx());

    expect(response.status).toBe(200);
    expect(proposalRepositoryMock.confirmProposal).toHaveBeenCalledWith("owner-1", "proposal-1", "owner-1", null);
    expect(await response.json()).toEqual({ proposal: CONFIRMED });
  });

  it("a real prior-confirmed id (intentional replacement) is forwarded as the 4th argument", async () => {
    const response = await POST(req({ expectedCurrentConfirmedProposalId: "previously-confirmed-proposal" }), ctx());

    expect(response.status).toBe(200);
    expect(proposalRepositoryMock.confirmProposal).toHaveBeenCalledWith(
      "owner-1",
      "proposal-1",
      "owner-1",
      "previously-confirmed-proposal",
    );
  });

  it("returns 404 defensively when confirmProposal resolves null", async () => {
    proposalRepositoryMock.confirmProposal.mockResolvedValue(null);

    const response = await POST(req({ expectedCurrentConfirmedProposalId: null }), ctx());

    expect(response.status).toBe(404);
    expect((await response.json()).error).toBe("Proposal not found.");
  });

  it("maps ProposalConcurrencyError to the EXACT 409 override body, never the repository's own code/message", async () => {
    proposalRepositoryMock.confirmProposal.mockRejectedValue(new proposalRepositoryMock.ProposalConcurrencyError());

    const response = await POST(req({ expectedCurrentConfirmedProposalId: null }), ctx());
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toEqual(CONFLICT_BODY);
    expect(JSON.stringify(body)).not.toContain("PROPOSAL_CONCURRENCY_CONFLICT");
  });

  it("produces the byte-identical 409 conflict body regardless of what expectedCurrentConfirmedProposalId looks like (never an oracle)", async () => {
    proposalRepositoryMock.confirmProposal.mockRejectedValue(new proposalRepositoryMock.ProposalConcurrencyError());

    const withForeignLookingId = await POST(
      req({ expectedCurrentConfirmedProposalId: "real-looking-foreign-proposal-id-999" }),
      ctx(),
    );
    const withRandomUuid = await POST(
      req({ expectedCurrentConfirmedProposalId: "b6e6b9a0-2f1e-4a3a-9c7a-6b6e6b9a02f1" }),
      ctx(),
    );

    expect(withForeignLookingId.status).toBe(409);
    expect(withRandomUuid.status).toBe(409);
    expect(await withForeignLookingId.json()).toEqual(CONFLICT_BODY);
    expect(await withRandomUuid.json()).toEqual(CONFLICT_BODY);
  });

  it("maps a repeated confirm on an already-CONFIRMED target (ProposalStateError) to 409, calling confirmProposal exactly once", async () => {
    proposalRepositoryMock.confirmProposal.mockRejectedValue(
      new proposalRepositoryMock.ProposalStateError(
        "CONFIRMED",
        "confirm",
        "Proposal proposal-1 is CONFIRMED; only a DRAFT proposal can be confirmed.",
      ),
    );

    const response = await POST(req({ expectedCurrentConfirmedProposalId: null }), ctx());

    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe("PROPOSAL_ILLEGAL_STATE_TRANSITION");
    expect(proposalRepositoryMock.confirmProposal).toHaveBeenCalledTimes(1);
  });

  it("maps confirmProposal's ProposalDependencyError via its own code/httpStatus", async () => {
    proposalRepositoryMock.confirmProposal.mockRejectedValue(
      new proposalRepositoryMock.ProposalDependencyError("PROPOSAL_DEPENDENCY_CHANGED", 409, "Proposal dependencies changed."),
    );

    const response = await POST(req({ expectedCurrentConfirmedProposalId: null }), ctx());

    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe("PROPOSAL_DEPENDENCY_CHANGED");
  });

  it("fails closed with a no-store 503 when confirmProposal reports persistence unavailable", async () => {
    proposalRepositoryMock.confirmProposal.mockRejectedValue(new proposalRepositoryMock.ProposalPersistenceError());

    const response = await POST(req({ expectedCurrentConfirmedProposalId: null }), ctx());

    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
});
