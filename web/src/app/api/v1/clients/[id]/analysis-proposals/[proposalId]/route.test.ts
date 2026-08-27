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
    editDraftProposal: vi.fn(),
  };
});

vi.mock("@/lib/session-request-auth", () => authMock);
vi.mock("@/lib/client-repository", () => clientRepositoryMock);
vi.mock("@/lib/proposal-repository", () => proposalRepositoryMock);

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
const PROPOSAL = {
  id: "proposal-1",
  clientId: "client-1",
  analysisId: "analysis-1",
  vertical: "cutting",
  status: "DRAFT",
  edits: [],
};
const EDITED = {
  ...PROPOSAL,
  edits: [{ field: "elevation", previousValue: "0_deg_blunt", newValue: "45_deg_graduation", source: "stylist_confirmed" }],
};

function ctx(id = "client-1", proposalId = "proposal-1") {
  return { params: Promise.resolve({ id, proposalId }) };
}

function getReq(): Request {
  return new Request("http://localhost/api/v1/clients/client-1/analysis-proposals/proposal-1");
}

function patchReq(body: unknown): Request {
  return new Request("http://localhost/api/v1/clients/client-1/analysis-proposals/proposal-1", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  authMock.authenticateSessionRequest.mockResolvedValue(OWNER);
  clientRepositoryMock.resolveOwnedClient.mockResolvedValue(CLIENT);
  proposalRepositoryMock.findProposalForOwner.mockResolvedValue(PROPOSAL);
  proposalRepositoryMock.editDraftProposal.mockResolvedValue(EDITED);
});

describe("GET /api/v1/clients/[id]/analysis-proposals/[proposalId]", () => {
  it("returns 401 without a session and never resolves the proposal", async () => {
    authMock.authenticateSessionRequest.mockResolvedValue(null);

    const response = await GET(getReq(), ctx());

    expect(response.status).toBe(401);
    expect(proposalRepositoryMock.findProposalForOwner).not.toHaveBeenCalled();
  });

  it("returns 404 for a foreign/nonexistent client, before resolving the proposal", async () => {
    clientRepositoryMock.resolveOwnedClient.mockResolvedValue(null);

    const response = await GET(getReq(), ctx());

    expect(response.status).toBe(404);
    expect(proposalRepositoryMock.findProposalForOwner).not.toHaveBeenCalled();
  });

  it("returns 404 'Proposal not found.' when the proposal does not exist / is not owned", async () => {
    proposalRepositoryMock.findProposalForOwner.mockResolvedValue(null);

    const response = await GET(getReq(), ctx());

    expect(response.status).toBe(404);
    expect((await response.json()).error).toBe("Proposal not found.");
  });

  it("returns a BYTE-IDENTICAL 404 whether the proposal is absent or belongs to a foreign client (no discovery oracle)", async () => {
    proposalRepositoryMock.findProposalForOwner.mockResolvedValueOnce(null);
    const absent = await GET(getReq(), ctx());
    const absentBody = await absent.json();

    proposalRepositoryMock.findProposalForOwner.mockResolvedValueOnce({ ...PROPOSAL, clientId: "someone-elses-client" });
    const foreign = await GET(getReq(), ctx());
    const foreignBody = await foreign.json();

    expect(absent.status).toBe(404);
    expect(foreign.status).toBe(absent.status);
    expect(foreignBody).toEqual(absentBody);
    expect(foreignBody).toEqual({ error: "Proposal not found." });
  });

  it("returns 200 with the resolved proposal on success (no second repository call needed)", async () => {
    const response = await GET(getReq(), ctx());

    expect(response.status).toBe(200);
    expect(proposalRepositoryMock.findProposalForOwner).toHaveBeenCalledWith("owner-1", "proposal-1");
    expect(await response.json()).toEqual({ proposal: PROPOSAL });
  });
});

describe("PATCH /api/v1/clients/[id]/analysis-proposals/[proposalId] (edit DRAFT)", () => {
  it("returns 401 without a session and never edits", async () => {
    authMock.authenticateSessionRequest.mockResolvedValue(null);

    const response = await PATCH(patchReq({ edits: [{ field: "elevation", previousValue: null, newValue: "45_deg_graduation", source: "stylist_confirmed" }] }), ctx());

    expect(response.status).toBe(401);
    expect(proposalRepositoryMock.editDraftProposal).not.toHaveBeenCalled();
  });

  it("returns 404 for a foreign/nonexistent client, before resolving or editing the proposal", async () => {
    clientRepositoryMock.resolveOwnedClient.mockResolvedValue(null);

    const response = await PATCH(patchReq({ edits: [{ field: "elevation", previousValue: null, newValue: "45_deg_graduation", source: "stylist_confirmed" }] }), ctx());

    expect(response.status).toBe(404);
    expect(proposalRepositoryMock.findProposalForOwner).not.toHaveBeenCalled();
    expect(proposalRepositoryMock.editDraftProposal).not.toHaveBeenCalled();
  });

  it("returns 404 'Proposal not found.' when the proposal does not exist, without editing", async () => {
    proposalRepositoryMock.findProposalForOwner.mockResolvedValue(null);

    const response = await PATCH(patchReq({ edits: [{ field: "elevation", previousValue: null, newValue: "45_deg_graduation", source: "stylist_confirmed" }] }), ctx());

    expect(response.status).toBe(404);
    expect((await response.json()).error).toBe("Proposal not found.");
    expect(proposalRepositoryMock.editDraftProposal).not.toHaveBeenCalled();
  });

  it("returns 404 when the resolved proposal belongs to a foreign client, without editing", async () => {
    proposalRepositoryMock.findProposalForOwner.mockResolvedValue({ ...PROPOSAL, clientId: "someone-elses-client" });

    const response = await PATCH(patchReq({ edits: [{ field: "elevation", previousValue: null, newValue: "45_deg_graduation", source: "stylist_confirmed" }] }), ctx());

    expect(response.status).toBe(404);
    expect((await response.json()).error).toBe("Proposal not found.");
    expect(proposalRepositoryMock.editDraftProposal).not.toHaveBeenCalled();
  });

  it("returns 400 when the request body is not valid JSON", async () => {
    const badRequest = new Request("http://localhost/api/v1/clients/client-1/analysis-proposals/proposal-1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: "{oops",
    });

    const response = await PATCH(badRequest, ctx());

    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("Invalid request body.");
    expect(proposalRepositoryMock.editDraftProposal).not.toHaveBeenCalled();
  });

  it.each([
    ["a missing edits key", {}],
    ["a non-array edits value", { edits: "elevation" }],
    ["an empty edits array", { edits: [] }],
  ])("returns 400 for %s, without editing", async (_label, body) => {
    const response = await PATCH(patchReq(body), ctx());

    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("edits must be a non-empty array.");
    expect(proposalRepositoryMock.editDraftProposal).not.toHaveBeenCalled();
  });

  it("forwards the edits array through to editDraftProposal unchanged and returns 200 with the updated proposal", async () => {
    const edits = [
      {
        field: "elevation",
        previousValue: "0_deg_blunt",
        newValue: "45_deg_graduation",
        source: "stylist_confirmed",
        reason: "client wants a softer perimeter",
      },
      { field: "guideline", previousValue: "stationary", newValue: "traveling", source: "stylist_confirmed" },
    ];

    const response = await PATCH(patchReq({ edits }), ctx());

    expect(response.status).toBe(200);
    expect(proposalRepositoryMock.editDraftProposal).toHaveBeenCalledWith("owner-1", "proposal-1", edits);
    expect(await response.json()).toEqual({ proposal: EDITED });
  });

  it.each(["CONFIRMED", "REJECTED", "SUPERSEDED"])(
    "maps editDraftProposal's ProposalStateError from a %s target to 409 with the repository's own code",
    async (fromStatus) => {
      proposalRepositoryMock.editDraftProposal.mockRejectedValue(
        new proposalRepositoryMock.ProposalStateError(
          fromStatus,
          "edit",
          `Proposal proposal-1 is ${fromStatus}; only a DRAFT proposal can be edited.`,
        ),
      );

      const response = await PATCH(patchReq({ edits: [{ field: "elevation", previousValue: null, newValue: "45_deg_graduation", source: "stylist_confirmed" }] }), ctx());

      expect(response.status).toBe(409);
      expect((await response.json()).error).toBe("PROPOSAL_ILLEGAL_STATE_TRANSITION");
    },
  );

  it("maps editDraftProposal's ProposalValidationError (malformed edit entry) to its own 422", async () => {
    proposalRepositoryMock.editDraftProposal.mockRejectedValue(
      new proposalRepositoryMock.ProposalValidationError(
        "PROPOSAL_INVALID_EDIT",
        "edits[0] must be { field, previousValue, newValue, source } with a valid source.",
      ),
    );

    const response = await PATCH(patchReq({ edits: [{ field: "elevation" }] }), ctx());

    expect(response.status).toBe(422);
    expect((await response.json()).error).toBe("PROPOSAL_INVALID_EDIT");
  });

  it("returns 404 defensively when editDraftProposal resolves null", async () => {
    proposalRepositoryMock.editDraftProposal.mockResolvedValue(null);

    const response = await PATCH(patchReq({ edits: [{ field: "elevation", previousValue: null, newValue: "45_deg_graduation", source: "stylist_confirmed" }] }), ctx());

    expect(response.status).toBe(404);
    expect((await response.json()).error).toBe("Proposal not found.");
  });

  it("fails closed with a no-store 503 when editDraftProposal reports persistence unavailable", async () => {
    proposalRepositoryMock.editDraftProposal.mockRejectedValue(new proposalRepositoryMock.ProposalPersistenceError());

    const response = await PATCH(patchReq({ edits: [{ field: "elevation", previousValue: null, newValue: "45_deg_graduation", source: "stylist_confirmed" }] }), ctx());

    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
});
