import { HEAD_ZONES, isHeadZone, isRecord, type HeadZone } from "@/lib/technical-visual-map-validators";

// Technical Visual Map, Stage 5B -- runtime validators + pure helpers for the
// image-bound SPATIAL geometry domain. Mirrors technical-visual-map-
// validators.ts's own conventions exactly (small exported allowlist arrays,
// `is*` type guards, reuse of an existing enum rather than a second copy).
// This file is types-only + pure functions -- no I/O, no database, no AI.
//
// Zones are the EXACT existing HeadZone vocabulary (crown/occipital/nape/
// top/sides/fringe), imported directly -- never a second, competing zone
// enum. Perimeter is a separate boundary construct, never a HeadZone.

// ---------------------------------------------------------------------------
// Placement state -- the minimal closed model locked at the Stage 5 Decision
// Lock (Lock 8): "not_placed" (the professional hasn't addressed this
// element yet) and "not_visible" (a fact about the photo, not the
// professional's certainty) are deliberately kept distinct from each other,
// but there is no separate "unknown" -- it would be behaviorally identical
// to "not_placed" everywhere today.
// ---------------------------------------------------------------------------

export const ZONE_PLACEMENT_STATES = ["not_placed", "placed", "not_visible"] as const;
export type ZonePlacementState = (typeof ZONE_PLACEMENT_STATES)[number];

export function isZonePlacementState(value: unknown): value is ZonePlacementState {
  return typeof value === "string" && (ZONE_PLACEMENT_STATES as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Geometry source -- V1 only ever produces "professional" (manual
// authoring, Decision Lock 11/18). The union is written forward-compatible
// with a future vision-assisted producer, but nothing in Stage 5B ever
// constructs or accepts anything but "professional" -- no provider/model/
// confidence fields are added now; the shape can gain them later without a
// migration, since geometry lives in JSONB.
// ---------------------------------------------------------------------------

export const GEOMETRY_SOURCES = ["professional", "vision_provider", "imported"] as const;
export type GeometrySource = (typeof GEOMETRY_SOURCES)[number];

export function isGeometrySource(value: unknown): value is GeometrySource {
  return typeof value === "string" && (GEOMETRY_SOURCES as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Normalized coordinates -- image-space, 0..1, finite only. No CSS pixels,
// no percentages, no display-space values ever stored (Decision Lock 5/6).
// ---------------------------------------------------------------------------

export function isNormalizedCoordinate(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

export interface NormalizedPoint {
  x: number;
  y: number;
}

export function isNormalizedPoint(value: unknown): value is NormalizedPoint {
  if (!isRecord(value)) return false;
  return isNormalizedCoordinate(value.x) && isNormalizedCoordinate(value.y);
}

// A polyline needs at least two points to describe a line at all -- the
// smallest honest boundary claim a professional can make. No upper bound is
// imposed here (Stage 5B does not implement a drawing UI that would need one).
export const PERIMETER_MIN_POINTS = 2;

// ---------------------------------------------------------------------------
// Zone entries -- exactly one per HeadZone, discriminated by placement state.
// "placed" requires real coordinates; "not_placed"/"not_visible" must never
// carry authoritative coordinates (Stage 5B requirement #3) -- an extra x/y
// on either of those is rejected as malformed, not silently ignored.
// ---------------------------------------------------------------------------

export interface SpatialZoneNotPlaced {
  zone: HeadZone;
  state: "not_placed";
}

export interface SpatialZoneNotVisible {
  zone: HeadZone;
  state: "not_visible";
}

export interface SpatialZonePlaced {
  zone: HeadZone;
  state: "placed";
  x: number;
  y: number;
  source: GeometrySource;
}

export type SpatialZoneEntry = SpatialZoneNotPlaced | SpatialZoneNotVisible | SpatialZonePlaced;

export function isSpatialZoneEntry(value: unknown): value is SpatialZoneEntry {
  if (!isRecord(value)) return false;
  if (!isHeadZone(value.zone)) return false;
  if (!isZonePlacementState(value.state)) return false;

  if (value.state === "placed") {
    return isNormalizedCoordinate(value.x) && isNormalizedCoordinate(value.y) && isGeometrySource(value.source);
  }

  // not_placed / not_visible must carry NO authoritative coordinates -- a
  // stray x/y/source here would be silently misleading, not a harmless extra.
  return !("x" in value) && !("y" in value) && !("source" in value);
}

// A valid `zones` array is exactly the 6 locked HeadZones, each appearing
// exactly once -- never more, never fewer, never an unknown/free-string zone
// (including "perimeter", which is never a HeadZone -- see HEAD_ZONES).
export function isSpatialZoneArray(value: unknown): value is SpatialZoneEntry[] {
  if (!Array.isArray(value) || value.length !== HEAD_ZONES.length) return false;
  if (!value.every(isSpatialZoneEntry)) return false;
  const zones = value.map((entry) => (entry as SpatialZoneEntry).zone);
  return HEAD_ZONES.every((zone) => zones.filter((z) => z === zone).length === 1);
}

// ---------------------------------------------------------------------------
// Perimeter -- a separate boundary construct, never a HeadZone, never a
// filled polygon/mask (Decision Lock 7/9). Same 3-state model, applied once
// to the whole boundary rather than per-zone.
// ---------------------------------------------------------------------------

export interface SpatialPerimeterNotPlaced {
  state: "not_placed";
}

export interface SpatialPerimeterNotVisible {
  state: "not_visible";
}

export interface SpatialPerimeterPlaced {
  state: "placed";
  points: NormalizedPoint[];
  source: GeometrySource;
}

export type SpatialPerimeter = SpatialPerimeterNotPlaced | SpatialPerimeterNotVisible | SpatialPerimeterPlaced;

export function isSpatialPerimeter(value: unknown): value is SpatialPerimeter {
  if (!isRecord(value)) return false;
  if (!isZonePlacementState(value.state)) return false;

  if (value.state === "placed") {
    if (!Array.isArray(value.points) || value.points.length < PERIMETER_MIN_POINTS) return false;
    if (!value.points.every(isNormalizedPoint)) return false;
    return isGeometrySource(value.source);
  }

  return !("points" in value) && !("source" in value);
}

// ---------------------------------------------------------------------------
// The full payload
// ---------------------------------------------------------------------------

export interface TechnicalVisualMapSpatialPayload {
  zones: SpatialZoneEntry[];
  perimeter: SpatialPerimeter;
}

export function isTechnicalVisualMapSpatialPayload(value: unknown): value is TechnicalVisualMapSpatialPayload {
  if (!isRecord(value)) return false;
  return isSpatialZoneArray(value.zones) && isSpatialPerimeter(value.perimeter);
}

// The honest, manual-authoring starting skeleton -- every zone not_placed,
// perimeter not_placed. No auto coordinates, no inferred visibility, no
// inferred zone placement (requirement #11). Deterministic: the same call
// always produces a deep-equal result, and zones are always emitted in
// HEAD_ZONES's own canonical order.
export function buildInitialSpatialPayload(): TechnicalVisualMapSpatialPayload {
  return {
    zones: HEAD_ZONES.map((zone) => ({ zone, state: "not_placed" as const })),
    perimeter: { state: "not_placed" },
  };
}

// ---------------------------------------------------------------------------
// View label -- professional-declared metadata only (Decision Lock 10).
// Nothing in this pipeline can verify a photo actually shows what its label
// claims -- never inferred from image content.
// ---------------------------------------------------------------------------

export const VIEW_LABELS = ["front", "left_profile", "right_profile", "back", "other"] as const;
export type ViewLabel = (typeof VIEW_LABELS)[number];

export function isViewLabel(value: unknown): value is ViewLabel {
  return typeof value === "string" && (VIEW_LABELS as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Typed DRAFT edit operations -- a closed discriminated union, never a
// generic JSON Patch (requirement #12). Applying one operation to a payload
// is a pure, total function: given a valid payload and a valid operation, it
// always produces a new, valid payload. There is no separate baseline/
// adjustment ledger for spatial bindings (see this module's own header
// comment below) -- an operation transforms the CURRENT DRAFT payload
// in place; the DRAFT payload itself is the single source of truth until
// confirmation freezes it permanently.
// ---------------------------------------------------------------------------

export const SPATIAL_BINDING_EDIT_OPERATIONS = [
  "set_zone_anchor",
  "set_zone_not_visible",
  "reset_zone",
  "set_perimeter",
  "set_perimeter_not_visible",
  "reset_perimeter",
] as const;
export type SpatialBindingEditOperationType = (typeof SPATIAL_BINDING_EDIT_OPERATIONS)[number];

export type SpatialBindingEditOperation =
  | { op: "set_zone_anchor"; zone: HeadZone; x: number; y: number }
  | { op: "set_zone_not_visible"; zone: HeadZone }
  | { op: "reset_zone"; zone: HeadZone }
  | { op: "set_perimeter"; points: NormalizedPoint[] }
  | { op: "set_perimeter_not_visible" }
  | { op: "reset_perimeter" };

export function isSpatialBindingEditOperation(value: unknown): value is SpatialBindingEditOperation {
  if (!isRecord(value)) return false;
  switch (value.op) {
    case "set_zone_anchor":
      return isHeadZone(value.zone) && isNormalizedCoordinate(value.x) && isNormalizedCoordinate(value.y);
    case "set_zone_not_visible":
    case "reset_zone":
      return isHeadZone(value.zone);
    case "set_perimeter":
      return (
        Array.isArray(value.points) && value.points.length >= PERIMETER_MIN_POINTS && value.points.every(isNormalizedPoint)
      );
    case "set_perimeter_not_visible":
    case "reset_perimeter":
      return true;
    default:
      return false;
  }
}

export function isSpatialBindingEditOperationArray(value: unknown): value is SpatialBindingEditOperation[] {
  return Array.isArray(value) && value.every(isSpatialBindingEditOperation);
}

// Pure transform -- assumes `operation` has already passed
// isSpatialBindingEditOperation (the repository validates before calling
// this, exactly mirroring the semantic map's own isMapAdjustmentEntry ->
// resolveEffectiveTechnicalVisualMap ordering). Never mutates its argument.
export function applySpatialBindingEditOperation(
  payload: TechnicalVisualMapSpatialPayload,
  operation: SpatialBindingEditOperation,
): TechnicalVisualMapSpatialPayload {
  switch (operation.op) {
    case "set_zone_anchor":
      return {
        ...payload,
        zones: payload.zones.map((entry) =>
          entry.zone === operation.zone
            ? { zone: operation.zone, state: "placed", x: operation.x, y: operation.y, source: "professional" }
            : entry,
        ),
      };
    case "set_zone_not_visible":
      return {
        ...payload,
        zones: payload.zones.map((entry) => (entry.zone === operation.zone ? { zone: operation.zone, state: "not_visible" } : entry)),
      };
    case "reset_zone":
      return {
        ...payload,
        zones: payload.zones.map((entry) => (entry.zone === operation.zone ? { zone: operation.zone, state: "not_placed" } : entry)),
      };
    case "set_perimeter":
      return { ...payload, perimeter: { state: "placed", points: operation.points, source: "professional" } };
    case "set_perimeter_not_visible":
      return { ...payload, perimeter: { state: "not_visible" } };
    case "reset_perimeter":
      return { ...payload, perimeter: { state: "not_placed" } };
  }
}

// Applies a whole array of already-validated operations in order --
// "last matching operation for a given zone/perimeter wins", exactly like
// every other append-in-order edit contract in this domain.
export function applySpatialBindingEditOperations(
  payload: TechnicalVisualMapSpatialPayload,
  operations: SpatialBindingEditOperation[],
): TechnicalVisualMapSpatialPayload {
  return operations.reduce(applySpatialBindingEditOperation, payload);
}
