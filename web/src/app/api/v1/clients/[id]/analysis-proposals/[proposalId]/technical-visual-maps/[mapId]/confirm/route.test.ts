import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.hoisted(() => ({ authenticateSessionRequest: vi.fn() }));
const clientRepositoryMock = vi.hoisted(() => ({ resolveOwnedClient: vi.fn() }));
const repositoryMock = vi.hoisted(() => {
  class TechnicalVisualMapPersistenceError extends Error {
    readonly code = "TECHNICAL_VISUAL_MAP_PERSISTENCE_UNAVAILABLE";
    readonly httpStatus = 503;
    constructor() {
      super("Technical Visual Map data is temporarily unavailable.");
      this.name = "TechnicalVisualMapPersistenceError";
    }
  }
  class TechnicalVisualMapDependencyError extends Error {
    constructor(
      readonly code: string,
      readonly httpStatus: number,
      message: string,
    ) {
      super(message);
      this.name = "TechnicalVisualMapDependencyError";
    }
  }
  class TechnicalVisualMapValidationError extends Error {
    readonly httpStatus = 422;
    constructor(
      readonly code: string,
      message: string,
    ) {
      super(message);
      this.name = "TechnicalVisualMapValidationError";
    }
  }
  class TechnicalVisualMapStateError extends Error {
    readonly code = "TECHNICAL_VISUAL_MAP_ILLEGAL_STATE_TRANSITION";
    readonly httpStatus = 409;
    constructor(
      readonly fromStatus: string,
      readonly attempted: "adjust" | "confirm",
      message: string,
    ) {
      super(message);
      this.name = "TechnicalVisualMapStateError";
    }
  }
  class TechnicalVisualMapConcurrencyError extends Error {
    readonly code = "TECHNICAL_VISUAL_MAP_CONCURRENCY_CONFLICT";
    readonly httpStatus = 409;
    constructor() {
      super("Technical Visual Map could not be confirmed because of a concurrent confirmation.");
      this.name = "TechnicalVisualMapConcurrencyError";
    }
  }
  return {
    TechnicalVisualMapPersistenceError,
    TechnicalVisualMapDependencyError,
    TechnicalVisualMapValidationError,
    TechnicalVisualMapStateError,
    TechnicalVisualMapConcurrencyError,
    findMapForOwner: vi.fn(),
    confirmDraftMap: vi.fn(),
    resolveEffectiveMapForRecord: vi.fn((record: { id: string }) => ({ effectiveOf: record.id })),
  };
});

vi.mock("@/lib/session-request-auth", () => authMock);
vi.mock("@/lib/client-repository", () => clientRepositoryMock);
vi.mock("@/lib/technical-visual-map-repository", () => repositoryMock);

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
const DRAFT_MAP = { id: "map-1", clientId: "client-1", analysisProposalId: "proposal-1", status: "DRAFT" };
const CONFIRMED_MAP = { ...DRAFT_MAP, status: "CONFIRMED", confirmedAt: "2026-08-29T00:00:00.000Z" };

const CONFLICT_BODY = {
  error: "TECHNICAL_VISUAL_MAP_CONFIRMATION_CONFLICT",
  message:
    "Another map was confirmed for this proposal while this draft was open. Review the current confirmed map before replacing it.",
};

function ctx(id = "client-1", proposalId = "proposal-1", mapId = "map-1") {
  return { params: Promise.resolve({ id, proposalId, mapId }) };
}

function req(body: unknown): Request {
  return new Request(
    "http://localhost/api/v1/clients/client-1/analysis-proposals/proposal-1/technical-visual-maps/map-1/confirm",
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
  );
}

function rawReq(rawBody: string): Request {
  return new Request(
    "http://localhost/api/v1/clients/client-1/analysis-proposals/proposal-1/technical-visual-maps/map-1/confirm",
    { method: "POST", headers: { "Content-Type": "application/json" }, body: rawBody },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  authMock.authenticateSessionRequest.mockResolvedValue(OWNER);
  clientRepositoryMock.resolveOwnedClient.mockResolvedValue(CLIENT);
  repositoryMock.findMapForOwner.mockResolvedValue(DRAFT_MAP);
  repositoryMock.confirmDraftMap.mockResolvedValue(CONFIRMED_MAP);
});

describe("POST .../technical-visual-maps/[mapId]/confirm", () => {
  it("returns 401 without a session and never resolves the client, map, or confirms", async () => {
    authMock.authenticateSessionRequest.mockResolvedValue(null);

    const response = await POST(req({ expectedCurrentConfirmedMapId: null }), ctx());

    expect(response.status).toBe(401);
    expect(clientRepositoryMock.resolveOwnedClient).not.toHaveBeenCalled();
    expect(repositoryMock.confirmDraftMap).not.toHaveBeenCalled();
  });

  it("returns 404 for a foreign/nonexistent client, before resolving the map", async () => {
    clientRepositoryMock.resolveOwnedClient.mockResolvedValue(null);

    const response = await POST(req({ expectedCurrentConfirmedMapId: null }), ctx());

    expect(response.status).toBe(404);
    expect(repositoryMock.findMapForOwner).not.toHaveBeenCalled();
  });

  it("43. foreign map is blocked with 404, without confirming", async () => {
    repositoryMock.findMapForOwner.mockResolvedValue(null);

    const response = await POST(req({ expectedCurrentConfirmedMapId: null }), ctx());

    expect(response.status).toBe(404);
    expect((await response.json()).error).toBe("Technical Visual Map not found.");
    expect(repositoryMock.confirmDraftMap).not.toHaveBeenCalled();
  });

  it("returns the byte-identical 404 when the map belongs to a foreign client or a different proposal (no discovery oracle)", async () => {
    repositoryMock.findMapForOwner.mockResolvedValueOnce(null);
    const absent = await POST(req({ expectedCurrentConfirmedMapId: null }), ctx());
    const absentBody = await absent.json();

    repositoryMock.findMapForOwner.mockResolvedValueOnce({ ...DRAFT_MAP, clientId: "someone-elses-client" });
    const foreignClient = await POST(req({ expectedCurrentConfirmedMapId: null }), ctx());

    repositoryMock.findMapForOwner.mockResolvedValueOnce({ ...DRAFT_MAP, analysisProposalId: "someone-elses-proposal" });
    const foreignProposal = await POST(req({ expectedCurrentConfirmedMapId: null }), ctx());

    expect(foreignClient.status).toBe(absent.status);
    expect(foreignProposal.status).toBe(absent.status);
    expect(await foreignClient.json()).toEqual(absentBody);
    expect(await foreignProposal.json()).toEqual(absentBody);
    expect(repositoryMock.confirmDraftMap).not.toHaveBeenCalled();
  });

  it("returns 400 for invalid JSON", async () => {
    const response = await POST(rawReq("{oops"), ctx());
    expect(response.status).toBe(400);
    expect(repositoryMock.confirmDraftMap).not.toHaveBeenCalled();
  });

  it("44. returns 400 when expectedCurrentConfirmedMapId is omitted or malformed", async () => {
    for (const body of [{}, { expectedCurrentConfirmedMapId: 42 }, { expectedCurrentConfirmedMapId: "" }, { expectedCurrentConfirmedMapId: {} }]) {
      const response = await POST(req(body), ctx());
      expect(response.status).toBe(400);
    }
    expect(repositoryMock.confirmDraftMap).not.toHaveBeenCalled();
  });

  it("35. null expectedCurrentConfirmedMapId (first confirmation) succeeds and forwards the exact arguments", async () => {
    const response = await POST(req({ expectedCurrentConfirmedMapId: null }), ctx());

    expect(response.status).toBe(200);
    expect(repositoryMock.confirmDraftMap).toHaveBeenCalledWith("owner-1", "map-1", null);
    expect(await response.json()).toEqual({ map: CONFIRMED_MAP, effectiveMap: { effectiveOf: "map-1" } });
  });

  it("36/37/38. intentional replacement with the incumbent's real id is forwarded, and the response reflects the new authority", async () => {
    const response = await POST(req({ expectedCurrentConfirmedMapId: "map-0" }), ctx());

    expect(response.status).toBe(200);
    expect(repositoryMock.confirmDraftMap).toHaveBeenCalledWith("owner-1", "map-1", "map-0");
    expect((await response.json()).map.status).toBe("CONFIRMED");
  });

  it("returns 404 defensively when confirmDraftMap resolves null", async () => {
    repositoryMock.confirmDraftMap.mockResolvedValue(null);

    const response = await POST(req({ expectedCurrentConfirmedMapId: null }), ctx());

    expect(response.status).toBe(404);
  });

  it("39/40/41/42. a stale expectedCurrentConfirmedMapId maps to the EXACT 409 override body, not the repository's own code -- and never retries", async () => {
    repositoryMock.confirmDraftMap.mockRejectedValue(new repositoryMock.TechnicalVisualMapConcurrencyError());

    const response = await POST(req({ expectedCurrentConfirmedMapId: "stale-id" }), ctx());
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toEqual(CONFLICT_BODY);
    expect(JSON.stringify(body)).not.toContain("TECHNICAL_VISUAL_MAP_CONCURRENCY_CONFLICT");
    expect(repositoryMock.confirmDraftMap).toHaveBeenCalledTimes(1); // no silent retry
  });

  it("produces the byte-identical 409 conflict body regardless of the stated expectation (never an oracle)", async () => {
    repositoryMock.confirmDraftMap.mockRejectedValue(new repositoryMock.TechnicalVisualMapConcurrencyError());

    const a = await POST(req({ expectedCurrentConfirmedMapId: "real-looking-foreign-map-id-999" }), ctx());
    const b = await POST(req({ expectedCurrentConfirmedMapId: "b6e6b9a0-2f1e-4a3a-9c7a-6b6e6b9a02f1" }), ctx());

    expect(await a.json()).toEqual(CONFLICT_BODY);
    expect(await b.json()).toEqual(CONFLICT_BODY);
  });

  it("maps a repeated confirm on an already-CONFIRMED target (TechnicalVisualMapStateError) to 409, calling confirmDraftMap exactly once", async () => {
    repositoryMock.confirmDraftMap.mockRejectedValue(
      new repositoryMock.TechnicalVisualMapStateError("CONFIRMED", "confirm", "Map map-1 is CONFIRMED; only a DRAFT map can be confirmed."),
    );

    const response = await POST(req({ expectedCurrentConfirmedMapId: null }), ctx());

    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe("TECHNICAL_VISUAL_MAP_ILLEGAL_STATE_TRANSITION");
    expect(repositoryMock.confirmDraftMap).toHaveBeenCalledTimes(1);
  });

  it("maps confirmDraftMap's TechnicalVisualMapDependencyError via its own code/httpStatus", async () => {
    repositoryMock.confirmDraftMap.mockRejectedValue(
      new repositoryMock.TechnicalVisualMapDependencyError("TECHNICAL_VISUAL_MAP_DEPENDENCY_CHANGED", 409, "Technical Visual Map dependencies changed."),
    );

    const response = await POST(req({ expectedCurrentConfirmedMapId: null }), ctx());

    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe("TECHNICAL_VISUAL_MAP_DEPENDENCY_CHANGED");
  });

  it("fails closed with a no-store 503 when confirmDraftMap reports persistence unavailable", async () => {
    repositoryMock.confirmDraftMap.mockRejectedValue(new repositoryMock.TechnicalVisualMapPersistenceError());

    const response = await POST(req({ expectedCurrentConfirmedMapId: null }), ctx());

    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
});
