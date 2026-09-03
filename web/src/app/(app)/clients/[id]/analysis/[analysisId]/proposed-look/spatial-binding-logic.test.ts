import { describe, expect, it } from "vitest";

import { applySpatialBindingEditOperation, type TechnicalVisualMapSpatialPayload } from "@/lib/technical-visual-map-spatial-validators";

import {
  appendPerimeterPoint,
  applyLocalEdit,
  beginSave,
  buildZoneDragOperation,
  buildZonePlacementOperation,
  completeSaveFailure,
  completeSaveSuccess,
  createEditSession,
  filterSpatialBindingsByScope,
  findExistingDraftSpatialBinding,
  isEditSessionDirty,
  isSpatialPayloadDirty,
  mapSpatialBindingApiError,
  replacePerimeterPointAt,
  resolveAutoRestoreSelection,
  resolveSpatialBindingLoadStatus,
  zonesInCanonicalOrder,
} from "./spatial-binding-logic";
import type { TechnicalVisualMapSpatialBindingRecord } from "@/lib/technical-visual-map-spatial-binding-repository";

function binding(overrides: Partial<TechnicalVisualMapSpatialBindingRecord> = {}): TechnicalVisualMapSpatialBindingRecord {
  return {
    id: "binding-1",
    ownerUserId: "owner-1",
    clientId: "client-1",
    technicalVisualMapId: "map-1",
    sourceImageAssetId: "asset-1",
    sourceImageAnalysisId: null,
    viewLabel: "front",
    status: "CONFIRMED",
    spatialVersion: 1,
    geometrySchemaVersion: "1.0.0",
    payload: { zones: [], perimeter: { state: "not_placed" } },
    frozenWidth: 1080,
    frozenHeight: 1440,
    frozenOrientation: 0,
    frozenContentSha256: null,
    frozenStorageVersionId: null,
    supersededBySpatialBindingId: null,
    confirmedAt: "2026-08-31T10:00:00.000Z",
    supersededAt: null,
    createdAt: "2026-08-31T09:00:00.000Z",
    updatedAt: "2026-08-31T10:00:00.000Z",
    ...overrides,
  };
}

function skeleton(): TechnicalVisualMapSpatialPayload {
  return {
    zones: ["fringe", "crown", "sides", "nape", "top", "occipital"].map((zone) => ({ zone: zone as never, state: "not_placed" })),
    perimeter: { state: "not_placed" },
  };
}

describe("resolveSpatialBindingLoadStatus", () => {
  it("maps ok/non-ok responses", () => {
    expect(resolveSpatialBindingLoadStatus({ ok: true, status: 200 })).toBe("ready");
    expect(resolveSpatialBindingLoadStatus({ ok: false, status: 500 })).toBe("error");
  });
});

describe("findExistingDraftSpatialBinding", () => {
  it("returns the DRAFT binding from history, or null", () => {
    const draft = { id: "b1", status: "DRAFT" } as never;
    const confirmed = { id: "b2", status: "CONFIRMED" } as never;
    expect(findExistingDraftSpatialBinding([confirmed, draft])).toEqual(draft);
    expect(findExistingDraftSpatialBinding([confirmed])).toBeNull();
  });
});

describe("mapSpatialBindingApiError", () => {
  it("34. maps the parent-map-ineligible conflict to a clear, neutral, non-technical message", () => {
    const message = mapSpatialBindingApiError(409, "TECHNICAL_VISUAL_MAP_SPATIAL_BINDING_PARENT_MAP_INELIGIBLE");
    expect(message).toContain("no longer the current one");
    expect(message).not.toContain("TECHNICAL_VISUAL_MAP");
  });

  it("35. maps the dimensions-unavailable code to a clear unavailable-state message", () => {
    const message = mapSpatialBindingApiError(422, "TECHNICAL_VISUAL_MAP_SPATIAL_SOURCE_DIMENSIONS_UNAVAILABLE");
    expect(message).toContain("dimensions aren't available");
  });

  it("maps the confirmation-conflict code to a neutral message with no winner details", () => {
    const message = mapSpatialBindingApiError(409, "TECHNICAL_VISUAL_MAP_SPATIAL_BINDING_CONFIRMATION_CONFLICT");
    expect(message).toContain("Another spatial map was confirmed");
  });

  it("never leaks a raw internal code string for any mapped status", () => {
    for (const status of [400, 401, 404, 409, 422, 500, 503, 0]) {
      const message = mapSpatialBindingApiError(status, "SOME_INTERNAL_CODE");
      expect(message).not.toContain("SOME_INTERNAL_CODE");
    }
  });
});

describe("isSpatialPayloadDirty", () => {
  it("27/29. false when identical, true when different -- the dirty-state lifecycle primitive", () => {
    const a = skeleton();
    const b = skeleton();
    expect(isSpatialPayloadDirty(a, b)).toBe(false);

    const changed: TechnicalVisualMapSpatialPayload = {
      ...b,
      zones: b.zones.map((z) => (z.zone === "crown" ? { zone: "crown", state: "placed", x: 0.5, y: 0.5, source: "professional" } : z)),
    };
    expect(isSpatialPayloadDirty(a, changed)).toBe(true);
  });
});

describe("buildZonePlacementOperation", () => {
  it("11. an active zone + a click produces the correct set_zone_anchor operation", () => {
    const op = buildZonePlacementOperation("nape", { x: 0.4, y: 0.6 });
    expect(op).toEqual({ op: "set_zone_anchor", zone: "nape", x: 0.4, y: 0.6 });
  });

  it("12. no active zone means no operation is ever invented", () => {
    expect(buildZonePlacementOperation(null, { x: 0.4, y: 0.6 })).toBeNull();
  });
});

describe("buildZoneDragOperation", () => {
  it("13. produces a set_zone_anchor operation for the exact dragged zone", () => {
    expect(buildZoneDragOperation("crown", { x: 0.1, y: 0.2 })).toEqual({ op: "set_zone_anchor", zone: "crown", x: 0.1, y: 0.2 });
  });
});

describe("perimeter point list helpers", () => {
  it("16. appendPerimeterPoint builds up a polyline point by point", () => {
    let points = appendPerimeterPoint([], { x: 0.1, y: 0.1 });
    points = appendPerimeterPoint(points, { x: 0.9, y: 0.1 });
    expect(points).toEqual([{ x: 0.1, y: 0.1 }, { x: 0.9, y: 0.1 }]);
  });

  it("17. replacePerimeterPointAt updates only the dragged point, leaving the rest untouched", () => {
    const points = [{ x: 0.1, y: 0.1 }, { x: 0.9, y: 0.1 }, { x: 0.5, y: 0.5 }];
    const updated = replacePerimeterPointAt(points, 1, { x: 0.8, y: 0.2 });
    expect(updated).toEqual([{ x: 0.1, y: 0.1 }, { x: 0.8, y: 0.2 }, { x: 0.5, y: 0.5 }]);
    expect(points[1]).toEqual({ x: 0.9, y: 0.1 }); // never mutates the input
  });
});

describe("filterSpatialBindingsByScope", () => {
  it("20/21. only returns bindings for the exact (image, view) scope -- independent views and images never mix", () => {
    const history = [
      { id: "b1", sourceImageAssetId: "asset-A", viewLabel: "front" },
      { id: "b2", sourceImageAssetId: "asset-A", viewLabel: "back" },
      { id: "b3", sourceImageAssetId: "asset-B", viewLabel: "front" },
    ] as unknown as import("@/lib/technical-visual-map-spatial-binding-repository").TechnicalVisualMapSpatialBindingRecord[];

    expect(filterSpatialBindingsByScope(history, "asset-A", "front").map((b) => b.id)).toEqual(["b1"]);
    expect(filterSpatialBindingsByScope(history, "asset-A", "back").map((b) => b.id)).toEqual(["b2"]);
    expect(filterSpatialBindingsByScope(history, "asset-B", "front").map((b) => b.id)).toEqual(["b3"]);
  });
});

describe("resolveAutoRestoreSelection -- Spatial Mapping revisit fix #1", () => {
  it("1/2. an existing CONFIRMED mapping restores both the source photo and the view", () => {
    const result = resolveAutoRestoreSelection([binding({ sourceImageAssetId: "asset-A", viewLabel: "front" })]);
    expect(result).toEqual({ sourceImageAssetId: "asset-A", viewLabel: "front" });
  });

  it("3. no CONFIRMED mapping at all -- returns null, selection stays empty/default", () => {
    expect(resolveAutoRestoreSelection([])).toBeNull();
    expect(resolveAutoRestoreSelection([binding({ status: "DRAFT", confirmedAt: null })])).toBeNull();
  });

  it("8. a SUPERSEDED binding is never restored as authoritative, even if it used to be confirmed", () => {
    const result = resolveAutoRestoreSelection([
      binding({ id: "old", status: "SUPERSEDED", sourceImageAssetId: "asset-OLD", confirmedAt: "2026-08-01T00:00:00.000Z" }),
    ]);
    expect(result).toBeNull();
  });

  it("a DRAFT binding is never restored -- only a real CONFIRMED one counts", () => {
    const result = resolveAutoRestoreSelection([binding({ status: "DRAFT", confirmedAt: null, sourceImageAssetId: "asset-DRAFT" })]);
    expect(result).toBeNull();
  });

  it("multiple independent CONFIRMED scopes (front, back, ...) can coexist -- the MOST RECENTLY confirmed one is picked as the initial default", () => {
    const result = resolveAutoRestoreSelection([
      binding({ id: "b-front", sourceImageAssetId: "asset-A", viewLabel: "front", confirmedAt: "2026-08-31T09:00:00.000Z" }),
      binding({ id: "b-back", sourceImageAssetId: "asset-B", viewLabel: "back", confirmedAt: "2026-08-31T11:00:00.000Z" }),
    ]);
    expect(result).toEqual({ sourceImageAssetId: "asset-B", viewLabel: "back" });
  });

  it("a mix of DRAFT/SUPERSEDED/CONFIRMED for the same map -- only the real CONFIRMED row is ever picked, never a stale/wrong one", () => {
    const result = resolveAutoRestoreSelection([
      binding({ id: "old", status: "SUPERSEDED", sourceImageAssetId: "asset-OLD", viewLabel: "front", confirmedAt: "2026-08-01T00:00:00.000Z" }),
      binding({ id: "draft", status: "DRAFT", confirmedAt: null, sourceImageAssetId: "asset-DRAFT", viewLabel: "back" }),
      binding({ id: "current", status: "CONFIRMED", sourceImageAssetId: "asset-CURRENT", viewLabel: "front", confirmedAt: "2026-08-31T10:00:00.000Z" }),
    ]);
    expect(result).toEqual({ sourceImageAssetId: "asset-CURRENT", viewLabel: "front" });
  });
});

describe("edit session -- the save lifecycle state machine", () => {
  const napePlace = { op: "set_zone_anchor" as const, zone: "nape" as const, x: 0.4, y: 0.6 };
  const crownPlace = { op: "set_zone_anchor" as const, zone: "crown" as const, x: 0.5, y: 0.1 };

  it("24/27. starts clean; a local edit marks the session dirty and updates the working payload without touching saved", () => {
    const session = createEditSession(skeleton());
    expect(isEditSessionDirty(session)).toBe(false);

    const afterEdit = applyLocalEdit(session, napePlace);
    expect(isEditSessionDirty(afterEdit)).toBe(true);
    expect(afterEdit.workingPayload.zones.find((z) => z.zone === "nape")).toEqual({
      zone: "nape", state: "placed", x: 0.4, y: 0.6, source: "professional",
    });
    // The saved snapshot is untouched by a purely local edit.
    expect(afterEdit.savedPayload).toEqual(skeleton());
  });

  it("a momentarily-invalid operation (a single-point set_perimeter, below the required minimum of two) is applied locally for instant feedback but never queued for Save -- found live during Stage 5C validation, where queuing it made a later, perfectly valid Save fail with a 422", () => {
    const firstPointOnly = { op: "set_perimeter" as const, points: [{ x: 0.2, y: 0.3 }] };
    const session = applyLocalEdit(createEditSession(skeleton()), firstPointOnly);

    // Visible locally...
    expect(session.workingPayload.perimeter).toEqual({ state: "placed", points: [{ x: 0.2, y: 0.3 }], source: "professional" });
    // ...but never queued for the network.
    expect(session.pendingOperations).toEqual([]);
    expect(isEditSessionDirty(session)).toBe(false);
    expect(beginSave(session)).toBeNull();

    // A second point brings it up to the required minimum -- THIS operation
    // (which fully replaces the points array, describing the whole valid
    // perimeter on its own) is queued normally.
    const secondPointToo = { op: "set_perimeter" as const, points: [{ x: 0.2, y: 0.3 }, { x: 0.8, y: 0.3 }] };
    const afterSecond = applyLocalEdit(session, secondPointToo);
    expect(afterSecond.pendingOperations).toEqual([secondPointToo]);
    expect(isEditSessionDirty(afterSecond)).toBe(true);
  });

  it("beginSave returns null when there is nothing pending -- callers must not issue a request", () => {
    const session = createEditSession(skeleton());
    expect(beginSave(session)).toBeNull();
  });

  it("beginSave snapshots and clears the pending queue", () => {
    const session = applyLocalEdit(createEditSession(skeleton()), napePlace);
    const result = beginSave(session);
    expect(result?.toSend).toEqual([napePlace]);
    expect(result?.nextSession.pendingOperations).toEqual([]);
    // workingPayload is untouched by beginSave -- only the queue is cleared.
    expect(result?.nextSession.workingPayload).toEqual(session.workingPayload);
  });

  it("28. a save failure restores the failed operations to the front of the queue -- edits are never lost", () => {
    const session = applyLocalEdit(createEditSession(skeleton()), napePlace);
    const { toSend, nextSession } = beginSave(session)!;
    const afterFailure = completeSaveFailure(nextSession, toSend);

    expect(isEditSessionDirty(afterFailure)).toBe(true);
    expect(afterFailure.pendingOperations).toEqual([napePlace]);
    // workingPayload was never reverted -- the professional still sees their edit.
    expect(afterFailure.workingPayload.zones.find((z) => z.zone === "nape")?.state).toBe("placed");
  });

  it("29. a successful save never erases an edit made WHILE the request was in flight", () => {
    let session = createEditSession(skeleton());
    session = applyLocalEdit(session, napePlace); // edit #1
    const { nextSession } = beginSave(session)!; // snapshot [nape], queue cleared

    // The professional places ANOTHER zone while the nape save is still in flight.
    const sessionDuringSave = applyLocalEdit(nextSession, crownPlace); // edit #2, queued fresh

    // The server confirms edit #1 (nape) was persisted -- its own response
    // payload reflects exactly the pre-edit-#2 state.
    const persistedPayload = applySpatialBindingEditOperation(skeleton(), napePlace);
    const afterSuccess = completeSaveSuccess(sessionDuringSave, persistedPayload);

    // Edit #2 (crown), queued AFTER the snapshot, is still pending -- never erased.
    expect(afterSuccess.pendingOperations).toEqual([crownPlace]);
    expect(afterSuccess.workingPayload.zones.find((z) => z.zone === "crown")?.state).toBe("placed");
    expect(afterSuccess.workingPayload.zones.find((z) => z.zone === "nape")?.state).toBe("placed");
    expect(afterSuccess.savedPayload.zones.find((z) => z.zone === "nape")?.state).toBe("placed");
    expect(afterSuccess.savedPayload.zones.find((z) => z.zone === "crown")?.state).toBe("not_placed");
  });
});

describe("zonesInCanonicalOrder", () => {
  it("1. always returns exactly the six zones in HEAD_ZONES's own deterministic order, regardless of storage order", () => {
    const ordered = zonesInCanonicalOrder(skeleton());
    expect(ordered.map((z) => z.zone)).toEqual(["crown", "occipital", "nape", "top", "sides", "fringe"]);
  });
});
