import type { TechnicalVisualMapSpatialBindingRecord } from "@/lib/technical-visual-map-spatial-binding-repository";
import {
  type HeadZone,
  HEAD_ZONES,
} from "@/lib/technical-visual-map-validators";
import {
  applySpatialBindingEditOperation,
  isSpatialBindingEditOperation,
  type NormalizedPoint,
  type SpatialBindingEditOperation,
  type TechnicalVisualMapSpatialPayload,
  type ViewLabel,
} from "@/lib/technical-visual-map-spatial-validators";

// Technical Visual Map, Stage 5C -- pure logic for the spatial-authoring UI.
// No React, no DOM, no fetch -- mirrors technical-visual-map-logic.ts's own
// plain-function style exactly.

export type SpatialBindingLoadStatus = "ready" | "error";

export function resolveSpatialBindingLoadStatus(response: { ok: boolean; status: number }): SpatialBindingLoadStatus {
  return response.ok ? "ready" : "error";
}

// history has at most one DRAFT at a time per the locked lifecycle, but this
// does not assume/enforce that -- it just returns the first match honestly.
export function findExistingDraftSpatialBinding(
  history: TechnicalVisualMapSpatialBindingRecord[],
): TechnicalVisualMapSpatialBindingRecord | null {
  return history.find((binding) => binding.status === "DRAFT") ?? null;
}

// The Stage 5B list endpoint returns EVERY binding for the whole map (every
// source image, every view -- requirement #21/#25's own map-wide history).
// This narrows it down to the professional's CURRENTLY SELECTED (image,
// view) scope -- e.g. so "is there already a draft for what I have open
// right now" never accidentally picks up a draft that actually belongs to a
// different image or view (requirement #27's "no fake cross-view data": a
// scope is independent, never merged/propagated/interpolated).
export function filterSpatialBindingsByScope(
  history: TechnicalVisualMapSpatialBindingRecord[],
  sourceImageAssetId: string,
  viewLabel: string,
): TechnicalVisualMapSpatialBindingRecord[] {
  return history.filter((binding) => binding.sourceImageAssetId === sourceImageAssetId && binding.viewLabel === viewLabel);
}

// Short, safe, professional-facing messages -- never a raw internal error.
export function mapSpatialBindingApiError(status: number, code?: string): string {
  if (status === 401) return "Please sign in again.";
  if (status === 404) return "This spatial map is no longer available.";
  if (status === 409 && code === "TECHNICAL_VISUAL_MAP_SPATIAL_BINDING_CONFIRMATION_CONFLICT") {
    return "Another spatial map was confirmed for this image and view while this draft was open. Review the current confirmed map, then try again if you still want to replace it.";
  }
  if (status === 409 && code === "TECHNICAL_VISUAL_MAP_SPATIAL_BINDING_PARENT_MAP_INELIGIBLE") {
    return "The Technical Visual Map this spatial map belongs to is no longer the current one, so it can no longer be confirmed. Create a spatial map from the current Technical Visual Map instead.";
  }
  if (status === 409 && code === "TECHNICAL_VISUAL_MAP_SPATIAL_BINDING_ILLEGAL_STATE_TRANSITION") {
    return "This spatial map is no longer a draft, so it can't be changed.";
  }
  if (status === 422 && code === "TECHNICAL_VISUAL_MAP_SPATIAL_SOURCE_DIMENSIONS_UNAVAILABLE") {
    return "This photo's dimensions aren't available yet, so a spatial map can't be created from it.";
  }
  if (status === 400 || status === 422) {
    return "This request could not be completed with the current data. Please review and try again.";
  }
  if (status === 503) return "The spatial mapping service is temporarily unavailable. Please try again shortly.";
  return "Something went wrong. Please try again.";
}

// ---------------------------------------------------------------------------
// Display labels
// ---------------------------------------------------------------------------

export const HEAD_ZONE_ABBREVIATIONS: Record<HeadZone, string> = {
  crown: "CR",
  occipital: "OC",
  nape: "NP",
  top: "TP",
  sides: "SD",
  fringe: "FR",
};

export const HEAD_ZONE_LABELS: Record<HeadZone, string> = {
  crown: "Crown",
  occipital: "Occipital",
  nape: "Nape",
  top: "Top",
  sides: "Sides",
  fringe: "Fringe",
};

export const VIEW_LABEL_DISPLAY: Record<ViewLabel, string> = {
  front: "Front",
  left_profile: "Left profile",
  right_profile: "Right profile",
  back: "Back",
  other: "Other",
};

export function formatPlacementStateLabel(state: "not_placed" | "placed" | "not_visible"): string {
  if (state === "placed") return "Placed";
  if (state === "not_visible") return "Not visible";
  return "Not placed";
}

// ---------------------------------------------------------------------------
// Dirty-state -- the UI's working payload is compared against the last
// SAVED payload (whatever the server most recently confirmed as persisted)
// to decide whether there are unsaved edits. There is no baseline/
// adjustment split for spatial bindings (Stage 5B Decision Lock 14) -- the
// payload itself IS the current authored state at every point.
// ---------------------------------------------------------------------------

export function isSpatialPayloadDirty(saved: TechnicalVisualMapSpatialPayload, working: TechnicalVisualMapSpatialPayload): boolean {
  return JSON.stringify(saved) !== JSON.stringify(working);
}

// ---------------------------------------------------------------------------
// Zone click-to-place -- requirement #11/#12: a click on the image only ever
// places an anchor when a zone is explicitly the active selection; it never
// infers which zone was intended. Returns null (no operation) when there is
// no active zone, or when the target zone is not actually eligible to
// receive a NEW placement (already placed -- dragging is a separate
// gesture, not a click).
// ---------------------------------------------------------------------------

export function buildZonePlacementOperation(activeZone: HeadZone | null, point: NormalizedPoint): SpatialBindingEditOperation | null {
  if (!activeZone) return null;
  return { op: "set_zone_anchor", zone: activeZone, x: point.x, y: point.y };
}

export function buildZoneDragOperation(zone: HeadZone, point: NormalizedPoint): SpatialBindingEditOperation {
  return { op: "set_zone_anchor", zone, x: point.x, y: point.y };
}

// ---------------------------------------------------------------------------
// Perimeter point list helpers -- pure array transforms, used by the
// perimeter-drawing overlay before an operation is dispatched.
// ---------------------------------------------------------------------------

export function appendPerimeterPoint(points: NormalizedPoint[], point: NormalizedPoint): NormalizedPoint[] {
  return [...points, point];
}

export function replacePerimeterPointAt(points: NormalizedPoint[], index: number, point: NormalizedPoint): NormalizedPoint[] {
  return points.map((existing, i) => (i === index ? point : existing));
}

// ---------------------------------------------------------------------------
// Zones in canonical, deterministic order -- for rendering the six-zone
// panel/overlay always in the same sequence, matching HEAD_ZONES exactly.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Edit session -- the full local-DRAFT-editing-then-explicit-save state
// machine (requirement #19/#20), as a pure, fully testable value + pure
// transitions. No API PATCH is ever implied by a local edit -- every gesture
// (place/drag/not_visible/reset) updates `workingPayload` instantly and
// locally via the same pure applySpatialBindingEditOperation the repository
// itself uses, appending to `pendingOperations`; only an explicit Save ever
// sends anything to the server.
//
// A save NEVER discards concurrent local edits: `beginSave` snapshots and
// clears the CURRENT pending queue, so any operation added by the
// professional while the request is in flight starts accumulating fresh
// into a new, still-pending queue. `completeSaveSuccess` only advances
// `savedPayload` to the server's own confirmed result -- it never touches
// `workingPayload` or whatever has accumulated in `pendingOperations` since
// the snapshot, so a newer unsaved edit is never erased by an unrelated
// save's success. `completeSaveFailure` restores the failed batch to the
// FRONT of the queue, so nothing already typed/placed is ever lost, and
// retrying Save resends the complete, correct batch.
// ---------------------------------------------------------------------------

export interface SpatialBindingEditSession {
  savedPayload: TechnicalVisualMapSpatialPayload;
  workingPayload: TechnicalVisualMapSpatialPayload;
  pendingOperations: SpatialBindingEditOperation[];
}

export function createEditSession(payload: TechnicalVisualMapSpatialPayload): SpatialBindingEditSession {
  return { savedPayload: payload, workingPayload: payload, pendingOperations: [] };
}

export function applyLocalEdit(session: SpatialBindingEditSession, operation: SpatialBindingEditOperation): SpatialBindingEditSession {
  const workingPayload = applySpatialBindingEditOperation(session.workingPayload, operation);

  // An operation that could never independently pass the server's own
  // per-operation validation (isSpatialBindingEditOperation) is still
  // applied to workingPayload above, so the professional sees instant local
  // feedback -- e.g. the FIRST perimeter point placed, before the required
  // minimum of two exists yet. It is deliberately never queued for the
  // network: Stage 5B's PATCH validates every operation in a submitted
  // batch independently, so an intermediate, momentarily-invalid
  // `set_perimeter` (one point) sitting earlier in pendingOperations would
  // otherwise fail an entire, later Save that is by then perfectly valid --
  // a real bug this exact scenario caught live during Stage 5C validation.
  if (!isSpatialBindingEditOperation(operation)) {
    return { ...session, workingPayload };
  }

  return { ...session, workingPayload, pendingOperations: [...session.pendingOperations, operation] };
}

export function isEditSessionDirty(session: SpatialBindingEditSession): boolean {
  return session.pendingOperations.length > 0;
}

export interface BeginSaveResult {
  toSend: SpatialBindingEditOperation[];
  nextSession: SpatialBindingEditSession;
}

// Returns `null` when there is nothing pending -- callers should not issue a
// save request in that case.
export function beginSave(session: SpatialBindingEditSession): BeginSaveResult | null {
  if (session.pendingOperations.length === 0) return null;
  return { toSend: session.pendingOperations, nextSession: { ...session, pendingOperations: [] } };
}

export function completeSaveSuccess(
  session: SpatialBindingEditSession,
  persistedPayload: TechnicalVisualMapSpatialPayload,
): SpatialBindingEditSession {
  return { ...session, savedPayload: persistedPayload };
}

export function completeSaveFailure(
  session: SpatialBindingEditSession,
  failedOperations: SpatialBindingEditOperation[],
): SpatialBindingEditSession {
  return { ...session, pendingOperations: [...failedOperations, ...session.pendingOperations] };
}

export function zonesInCanonicalOrder(payload: TechnicalVisualMapSpatialPayload) {
  return HEAD_ZONES.map((zone) => payload.zones.find((entry) => entry.zone === zone)).filter(
    (entry): entry is NonNullable<typeof entry> => entry !== undefined,
  );
}
