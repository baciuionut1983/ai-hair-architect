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
    applyAdjustmentsToDraft: vi.fn(),
    resolveEffectiveMapForRecord: vi.fn((record: { id: string }) => ({ effectiveOf: record.id })),
  };
});

vi.mock("@/lib/session-request-auth", () => authMock);
vi.mock("@/lib/client-repository", () => clientRepositoryMock);
vi.mock("@/lib/technical-visual-map-repository", () => repositoryMock);

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
const DRAFT_MAP = {
  id: "map-1",
  ownerUserId: "owner-1",
  clientId: "client-1",
  analysisProposalId: "proposal-1",
  status: "DRAFT",
  mapVersion: 1,
  payload: { globalIntent: {}, zones: [], relationships: [], preserveConstraints: [] },
  professionalAdjustments: [],
};
const SUPERSEDED_MAP = { ...DRAFT_MAP, id: "map-0", status: "SUPERSEDED" };

const ADJUSTMENT = {
  target: "zone_preserve",
  zone: "fringe",
  previousValue: false,
  newValue: true,
  source: "professional",
};

function ctx(id = "client-1", proposalId = "proposal-1", mapId = "map-1") {
  return { params: Promise.resolve({ id, proposalId, mapId }) };
}

function getReq(): Request {
  return new Request("http://localhost/api/v1/clients/client-1/analysis-proposals/proposal-1/technical-visual-maps/map-1");
}

function patchReq(body: unknown): Request {
  return new Request(
    "http://localhost/api/v1/clients/client-1/analysis-proposals/proposal-1/technical-visual-maps/map-1",
    { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
  );
}

function rawPatchReq(rawBody: string): Request {
  return new Request(
    "http://localhost/api/v1/clients/client-1/analysis-proposals/proposal-1/technical-visual-maps/map-1",
    { method: "PATCH", headers: { "Content-Type": "application/json" }, body: rawBody },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  authMock.authenticateSessionRequest.mockResolvedValue(OWNER);
  clientRepositoryMock.resolveOwnedClient.mockResolvedValue(CLIENT);
  repositoryMock.findMapForOwner.mockResolvedValue(DRAFT_MAP);
  repositoryMock.applyAdjustmentsToDraft.mockResolvedValue({ ...DRAFT_MAP, professionalAdjustments: [ADJUSTMENT] });
});

describe("GET .../technical-visual-maps/[mapId]", () => {
  it("returns 401 without a session", async () => {
    authMock.authenticateSessionRequest.mockResolvedValue(null);
    const response = await GET(getReq(), ctx());
    expect(response.status).toBe(401);
    expect(repositoryMock.findMapForOwner).not.toHaveBeenCalled();
  });

  it("14. foreign owner cannot read -- findMapForOwner (already owner-scoped) resolving null yields 404", async () => {
    repositoryMock.findMapForOwner.mockResolvedValue(null);
    const response = await GET(getReq(), ctx());
    expect(response.status).toBe(404);
    expect((await response.json()).error).toBe("Technical Visual Map not found.");
  });

  it("15. a client-mismatched map is rejected with the byte-identical generic 404 (no discovery oracle)", async () => {
    repositoryMock.findMapForOwner.mockResolvedValueOnce(null);
    const absent = await GET(getReq(), ctx());
    const absentBody = await absent.json();

    repositoryMock.findMapForOwner.mockResolvedValueOnce({ ...DRAFT_MAP, clientId: "someone-elses-client" });
    const foreign = await GET(getReq(), ctx());
    const foreignBody = await foreign.json();

    expect(foreign.status).toBe(absent.status);
    expect(foreignBody).toEqual(absentBody);
  });

  it("a map belonging to a different proposal of the same owned client is rejected with the same generic 404", async () => {
    repositoryMock.findMapForOwner.mockResolvedValue({ ...DRAFT_MAP, analysisProposalId: "someone-elses-proposal" });
    const response = await GET(getReq(), ctx());
    expect(response.status).toBe(404);
    expect((await response.json()).error).toBe("Technical Visual Map not found.");
  });

  it("13. owner can read their own map", async () => {
    const response = await GET(getReq(), ctx());
    expect(response.status).toBe(200);
    expect(repositoryMock.findMapForOwner).toHaveBeenCalledWith("owner-1", "map-1");
    expect(await response.json()).toEqual({ map: DRAFT_MAP, effectiveMap: { effectiveOf: "map-1" } });
  });

  it("16. a SUPERSEDED historical map remains readable", async () => {
    repositoryMock.findMapForOwner.mockResolvedValue(SUPERSEDED_MAP);
    const response = await GET(getReq(), ctx());
    expect(response.status).toBe(200);
    expect((await response.json()).map.status).toBe("SUPERSEDED");
  });

  it("17. the effective map is computed via the Stage 2 resolver and returned alongside the baseline record", async () => {
    const response = await GET(getReq(), ctx());
    const body = await response.json();
    expect(repositoryMock.resolveEffectiveMapForRecord).toHaveBeenCalledWith(DRAFT_MAP);
    expect(body.effectiveMap).toEqual({ effectiveOf: "map-1" });
  });

  it("fails closed with a no-store 503 when persistence is unavailable", async () => {
    repositoryMock.findMapForOwner.mockRejectedValue(new repositoryMock.TechnicalVisualMapPersistenceError());
    const response = await GET(getReq(), ctx());
    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
});

describe("PATCH .../technical-visual-maps/[mapId] (professional adjustments)", () => {
  it("returns 401 without a session, touching nothing", async () => {
    authMock.authenticateSessionRequest.mockResolvedValue(null);
    const response = await PATCH(patchReq({ adjustments: [ADJUSTMENT] }), ctx());
    expect(response.status).toBe(401);
    expect(repositoryMock.applyAdjustmentsToDraft).not.toHaveBeenCalled();
  });

  it("33. foreign map is blocked with 404, never calling applyAdjustmentsToDraft", async () => {
    repositoryMock.findMapForOwner.mockResolvedValue(null);
    const response = await PATCH(patchReq({ adjustments: [ADJUSTMENT] }), ctx());
    expect(response.status).toBe(404);
    expect(repositoryMock.applyAdjustmentsToDraft).not.toHaveBeenCalled();
  });

  it("returns 400 for invalid JSON", async () => {
    const response = await PATCH(rawPatchReq("{oops"), ctx());
    expect(response.status).toBe(400);
    expect(repositoryMock.applyAdjustmentsToDraft).not.toHaveBeenCalled();
  });

  it("returns 400 when adjustments is missing, empty, or not an array", async () => {
    for (const body of [{}, { adjustments: [] }, { adjustments: "not-an-array" }]) {
      const response = await PATCH(patchReq(body), ctx());
      expect(response.status).toBe(400);
    }
    expect(repositoryMock.applyAdjustmentsToDraft).not.toHaveBeenCalled();
  });

  it("26. a valid DRAFT adjustment succeeds and forwards the exact array to the repository", async () => {
    const response = await PATCH(patchReq({ adjustments: [ADJUSTMENT] }), ctx());
    expect(response.status).toBe(200);
    expect(repositoryMock.applyAdjustmentsToDraft).toHaveBeenCalledWith("owner-1", "map-1", [ADJUSTMENT]);
  });

  it("27/28. the response reflects the repository's authoritative persisted map and its effective map", async () => {
    const persisted = { ...DRAFT_MAP, professionalAdjustments: [ADJUSTMENT] };
    repositoryMock.applyAdjustmentsToDraft.mockResolvedValue(persisted);

    const response = await PATCH(patchReq({ adjustments: [ADJUSTMENT] }), ctx());
    const body = await response.json();

    expect(body.map).toEqual(persisted);
    expect(body.map.payload).toEqual(DRAFT_MAP.payload); // baseline untouched
    expect(repositoryMock.resolveEffectiveMapForRecord).toHaveBeenCalledWith(persisted);
  });

  it("29. malformed adjustments are rejected by the domain layer's own validation, not route-level hand-validation, and mapped to 422", async () => {
    repositoryMock.applyAdjustmentsToDraft.mockRejectedValue(
      new repositoryMock.TechnicalVisualMapValidationError(
        "TECHNICAL_VISUAL_MAP_INVALID_ADJUSTMENT",
        "adjustments[0] is not a structurally valid MapAdjustmentEntry.",
      ),
    );

    const response = await PATCH(patchReq({ adjustments: [{ target: "not-real" }] }), ctx());

    expect(response.status).toBe(422);
    expect((await response.json()).error).toBe("TECHNICAL_VISUAL_MAP_INVALID_ADJUSTMENT");
  });

  it("30. an attempt to mutate a proposal-level field is rejected -- the closed target vocabulary makes this a validation error, not a silent no-op", async () => {
    repositoryMock.applyAdjustmentsToDraft.mockRejectedValue(
      new repositoryMock.TechnicalVisualMapValidationError(
        "TECHNICAL_VISUAL_MAP_INVALID_ADJUSTMENT",
        "adjustments[0] is not a structurally valid MapAdjustmentEntry.",
      ),
    );

    const response = await PATCH(
      patchReq({ adjustments: [{ target: "structuralTechnique", newValue: "one_length", source: "professional" }] }),
      ctx(),
    );

    expect(response.status).toBe(422);
  });

  it("31. adjustment of a CONFIRMED map is rejected with 409", async () => {
    repositoryMock.applyAdjustmentsToDraft.mockRejectedValue(
      new repositoryMock.TechnicalVisualMapStateError("CONFIRMED", "adjust", "Map map-1 is CONFIRMED; only a DRAFT map can receive professional adjustments."),
    );

    const response = await PATCH(patchReq({ adjustments: [ADJUSTMENT] }), ctx());

    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe("TECHNICAL_VISUAL_MAP_ILLEGAL_STATE_TRANSITION");
  });

  it("32. adjustment of a SUPERSEDED map is rejected with 409", async () => {
    repositoryMock.applyAdjustmentsToDraft.mockRejectedValue(
      new repositoryMock.TechnicalVisualMapStateError("SUPERSEDED", "adjust", "Map map-1 is SUPERSEDED; only a DRAFT map can receive professional adjustments."),
    );

    const response = await PATCH(patchReq({ adjustments: [ADJUSTMENT] }), ctx());

    expect(response.status).toBe(409);
  });

  it("34. attribution/reason on an adjustment entry is forwarded unchanged to the repository (audit trail preserved)", async () => {
    const withReason = { ...ADJUSTMENT, reason: "Client wants to keep the fringe length exactly as is." };
    await PATCH(patchReq({ adjustments: [withReason] }), ctx());
    expect(repositoryMock.applyAdjustmentsToDraft).toHaveBeenCalledWith("owner-1", "map-1", [withReason]);
  });

  it("returns 404 defensively when applyAdjustmentsToDraft resolves null", async () => {
    repositoryMock.applyAdjustmentsToDraft.mockResolvedValue(null);
    const response = await PATCH(patchReq({ adjustments: [ADJUSTMENT] }), ctx());
    expect(response.status).toBe(404);
  });

  it("fails closed with a no-store 503 when persistence is unavailable", async () => {
    repositoryMock.applyAdjustmentsToDraft.mockRejectedValue(new repositoryMock.TechnicalVisualMapPersistenceError());
    const response = await PATCH(patchReq({ adjustments: [ADJUSTMENT] }), ctx());
    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
});
