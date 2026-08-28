import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.hoisted(() => ({ authenticateSessionRequest: vi.fn() }));
const clientRepositoryMock = vi.hoisted(() => ({ resolveOwnedClient: vi.fn() }));
const consultationMessageRepositoryMock = vi.hoisted(() => {
  class ConsultationMessagePersistenceError extends Error {
    readonly code = "CONSULTATION_MESSAGE_PERSISTENCE_UNAVAILABLE";
    readonly httpStatus = 503;
    constructor() {
      super("Conversation data is temporarily unavailable.");
      this.name = "ConsultationMessagePersistenceError";
    }
  }
  return {
    ConsultationMessagePersistenceError,
    isConsultationMessagePersistenceError: vi.fn(
      (error: unknown) => error instanceof ConsultationMessagePersistenceError,
    ),
    findConsultationMessageForOwner: vi.fn(),
  };
});
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
      readonly attempted: "edit" | "reject" | "confirm" | "promote",
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
    promoteConsultationSourceToDraft: vi.fn(),
  };
});

vi.mock("@/lib/session-request-auth", () => authMock);
vi.mock("@/lib/client-repository", () => clientRepositoryMock);
vi.mock("@/lib/consultation-message-repository", () => consultationMessageRepositoryMock);
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
  promotedConsultationSources: [],
};
const UPDATED_PROPOSAL = {
  ...PROPOSAL,
  promotedConsultationSources: [
    { consultationMessageId: "msg-1", snapshotContent: "x", promotedAt: "2026-08-28T00:00:00.000Z" },
  ],
};

const ELIGIBLE_MESSAGE = {
  id: "msg-1",
  role: "assistant",
  content: "You could try a softer, rounder shape here.",
  proposedCorrection: null,
  proposedMemory: { action: "mark_preference", content: "Client prefers softer, rounder shapes.", reason: "Mentioned twice in conversation." },
  proposedMemoryDecision: null,
  createdAt: "2026-08-28T00:00:00.000Z",
};

function ctx(id = "client-1", proposalId = "proposal-1") {
  return { params: Promise.resolve({ id, proposalId }) };
}

function req(body: unknown): Request {
  return new Request(
    "http://localhost/api/v1/clients/client-1/analysis-proposals/proposal-1/promote-consultation-source",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

function rawReq(rawBody: string): Request {
  return new Request(
    "http://localhost/api/v1/clients/client-1/analysis-proposals/proposal-1/promote-consultation-source",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: rawBody,
    },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  authMock.authenticateSessionRequest.mockResolvedValue(OWNER);
  clientRepositoryMock.resolveOwnedClient.mockResolvedValue(CLIENT);
  proposalRepositoryMock.findProposalForOwner.mockResolvedValue(PROPOSAL);
  consultationMessageRepositoryMock.findConsultationMessageForOwner.mockResolvedValue(ELIGIBLE_MESSAGE);
  proposalRepositoryMock.promoteConsultationSourceToDraft.mockResolvedValue(UPDATED_PROPOSAL);
});

describe("POST /api/v1/clients/[id]/analysis-proposals/[proposalId]/promote-consultation-source", () => {
  it("returns 401 without a session and calls nothing else", async () => {
    authMock.authenticateSessionRequest.mockResolvedValue(null);

    const response = await POST(req({ consultationMessageId: "msg-1" }), ctx());

    expect(response.status).toBe(401);
    expect(clientRepositoryMock.resolveOwnedClient).not.toHaveBeenCalled();
    expect(proposalRepositoryMock.findProposalForOwner).not.toHaveBeenCalled();
  });

  it("returns 404 'Client not found.' for a foreign/nonexistent client", async () => {
    clientRepositoryMock.resolveOwnedClient.mockResolvedValue(null);

    const response = await POST(req({ consultationMessageId: "msg-1" }), ctx());

    expect(response.status).toBe(404);
    expect((await response.json()).error).toBe("Client not found.");
    expect(proposalRepositoryMock.findProposalForOwner).not.toHaveBeenCalled();
  });

  it("passes through a Response returned by resolveOwnedClient as-is", async () => {
    const dbDown = Response.json({ error: "CLIENT_PERSISTENCE_UNAVAILABLE" }, { status: 503 });
    clientRepositoryMock.resolveOwnedClient.mockResolvedValue(dbDown);

    const response = await POST(req({ consultationMessageId: "msg-1" }), ctx());

    expect(response).toBe(dbDown);
  });

  it("returns 404 'Proposal not found.' when the proposal does not exist", async () => {
    proposalRepositoryMock.findProposalForOwner.mockResolvedValue(null);

    const response = await POST(req({ consultationMessageId: "msg-1" }), ctx());

    expect(response.status).toBe(404);
    expect((await response.json()).error).toBe("Proposal not found.");
    expect(consultationMessageRepositoryMock.findConsultationMessageForOwner).not.toHaveBeenCalled();
    expect(proposalRepositoryMock.promoteConsultationSourceToDraft).not.toHaveBeenCalled();
  });

  it("returns a BYTE-IDENTICAL 404 when the proposal belongs to a foreign client", async () => {
    proposalRepositoryMock.findProposalForOwner.mockResolvedValueOnce(null);
    const absent = await POST(req({ consultationMessageId: "msg-1" }), ctx());
    const absentBody = await absent.json();

    proposalRepositoryMock.findProposalForOwner.mockResolvedValueOnce({ ...PROPOSAL, clientId: "someone-elses-client" });
    const foreign = await POST(req({ consultationMessageId: "msg-1" }), ctx());
    const foreignBody = await foreign.json();

    expect(foreign.status).toBe(absent.status);
    expect(foreignBody).toEqual(absentBody);
    expect(foreignBody).toEqual({ error: "Proposal not found." });
  });

  it.each([
    ["missing", {}],
    ["empty string", { consultationMessageId: "" }],
    ["a number", { consultationMessageId: 42 }],
  ])("returns 400 when consultationMessageId is %s", async (_label, body) => {
    const response = await POST(req(body), ctx());

    expect(response.status).toBe(400);
    expect(consultationMessageRepositoryMock.findConsultationMessageForOwner).not.toHaveBeenCalled();
  });

  it("returns 400 when the request body is not valid JSON", async () => {
    const response = await POST(rawReq("{oops"), ctx());

    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("Invalid request body.");
  });

  it.each([
    "nonexistent id",
    "foreign owner",
    "foreign client",
  ])("returns 404 'Consultation message not found.' for %s (one identical response, no oracle)", async () => {
    consultationMessageRepositoryMock.findConsultationMessageForOwner.mockResolvedValue(null);

    const response = await POST(req({ consultationMessageId: "msg-1" }), ctx());

    expect(response.status).toBe(404);
    expect((await response.json()).error).toBe("Consultation message not found.");
    expect(proposalRepositoryMock.promoteConsultationSourceToDraft).not.toHaveBeenCalled();
  });

  it("returns 422 CONSULTATION_MESSAGE_NOT_ELIGIBLE when proposedMemory is null", async () => {
    consultationMessageRepositoryMock.findConsultationMessageForOwner.mockResolvedValue({
      ...ELIGIBLE_MESSAGE,
      proposedMemory: null,
    });

    const response = await POST(req({ consultationMessageId: "msg-1" }), ctx());

    expect(response.status).toBe(422);
    expect((await response.json()).error).toBe("CONSULTATION_MESSAGE_NOT_ELIGIBLE");
    expect(proposalRepositoryMock.promoteConsultationSourceToDraft).not.toHaveBeenCalled();
  });

  it("returns the SAME 422 for a message carrying only a proposedCorrection (evidence correction, never promotable)", async () => {
    consultationMessageRepositoryMock.findConsultationMessageForOwner.mockResolvedValue({
      ...ELIGIBLE_MESSAGE,
      proposedMemory: null,
      proposedCorrection: { field: "hairType", value: "coarse", reason: "Visually coarser than recorded.", source: "visual_ai" },
    });

    const response = await POST(req({ consultationMessageId: "msg-1" }), ctx());

    expect(response.status).toBe(422);
    expect((await response.json()).error).toBe("CONSULTATION_MESSAGE_NOT_ELIGIBLE");
    expect(proposalRepositoryMock.promoteConsultationSourceToDraft).not.toHaveBeenCalled();
  });

  it("returns the SAME 422 for a malformed proposedMemory (no content)", async () => {
    consultationMessageRepositoryMock.findConsultationMessageForOwner.mockResolvedValue({
      ...ELIGIBLE_MESSAGE,
      proposedMemory: { action: "mark_preference" },
    });

    const response = await POST(req({ consultationMessageId: "msg-1" }), ctx());

    expect(response.status).toBe(422);
    expect((await response.json()).error).toBe("CONSULTATION_MESSAGE_NOT_ELIGIBLE");
  });

  it("on success with a reason present, forwards a snapshotContent containing both content and reason", async () => {
    const response = await POST(req({ consultationMessageId: "msg-1" }), ctx());

    expect(response.status).toBe(200);
    expect(proposalRepositoryMock.promoteConsultationSourceToDraft).toHaveBeenCalledWith(
      "owner-1",
      "proposal-1",
      expect.objectContaining({
        consultationMessageId: "msg-1",
        snapshotContent: expect.stringContaining("Client prefers softer, rounder shapes."),
      }),
    );
    const call = proposalRepositoryMock.promoteConsultationSourceToDraft.mock.calls[0][2];
    expect(call.snapshotContent).toContain("Mentioned twice in conversation.");
    expect(await response.json()).toEqual({ proposal: UPDATED_PROPOSAL });
  });

  it("when reason is empty/absent, snapshotContent equals content alone", async () => {
    consultationMessageRepositoryMock.findConsultationMessageForOwner.mockResolvedValue({
      ...ELIGIBLE_MESSAGE,
      proposedMemory: { action: "mark_preference", content: "Client prefers softer shapes.", reason: "" },
    });

    await POST(req({ consultationMessageId: "msg-1" }), ctx());

    const call = proposalRepositoryMock.promoteConsultationSourceToDraft.mock.calls[0][2];
    expect(call.snapshotContent).toBe("Client prefers softer shapes.");
  });

  it("maps promoteConsultationSourceToDraft's ProposalStateError (non-DRAFT target) to 409", async () => {
    proposalRepositoryMock.promoteConsultationSourceToDraft.mockRejectedValue(
      new proposalRepositoryMock.ProposalStateError(
        "CONFIRMED",
        "promote",
        "Proposal proposal-1 is CONFIRMED; only a DRAFT proposal can have a consultation source promoted onto it.",
      ),
    );

    const response = await POST(req({ consultationMessageId: "msg-1" }), ctx());

    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe("PROPOSAL_ILLEGAL_STATE_TRANSITION");
  });

  it("returns 404 defensively when promoteConsultationSourceToDraft resolves null", async () => {
    proposalRepositoryMock.promoteConsultationSourceToDraft.mockResolvedValue(null);

    const response = await POST(req({ consultationMessageId: "msg-1" }), ctx());

    expect(response.status).toBe(404);
    expect((await response.json()).error).toBe("Proposal not found.");
  });

  it("fails closed with a no-store 503 when findConsultationMessageForOwner reports persistence unavailable", async () => {
    consultationMessageRepositoryMock.findConsultationMessageForOwner.mockRejectedValue(
      new consultationMessageRepositoryMock.ConsultationMessagePersistenceError(),
    );

    const response = await POST(req({ consultationMessageId: "msg-1" }), ctx());

    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
});
