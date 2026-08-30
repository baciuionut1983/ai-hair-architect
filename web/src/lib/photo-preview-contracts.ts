import { createHash } from "crypto";

import {
  isPreserveConstraintArray,
  isRecord,
  isTechnicalVisualMapGlobalIntent,
  isZoneIntentArray,
  isZoneRelationshipArray,
  type PreserveConstraintEntry,
  type TechnicalVisualMapGlobalIntent,
  type ZoneIntentEntry,
  type ZoneRelationshipEntry,
} from "@/lib/technical-visual-map-validators";
import {
  isTechnicalVisualMapSpatialPayload,
  isViewLabel,
  type TechnicalVisualMapSpatialPayload,
  type ViewLabel,
} from "@/lib/technical-visual-map-spatial-validators";

// Real AI Photo Preview, Stage 1 -- the sealed generation request's typed,
// versioned contract. Types-only + pure functions, exactly like
// technical-visual-map-validators.ts / technical-visual-map-spatial-
// validators.ts's own convention: no I/O, no database, no AI, no provider
// SDK import. The one exception is `createHash`, used only for a
// deterministic, side-effect-free fingerprint computation -- not I/O.
//
// This is the ONLY shape the domain/repository layer ever freezes into
// `PhotoPreviewGeneration.sealedRequest`. It intentionally does NOT store a
// giant raw copy of every source row (AI Photo Preview Stage 1 task, §6) --
// only the minimum structured information required to reproduce/audit what
// was actually sent to a provider adapter later. It also intentionally
// contains NO free-form prose, NO provider-specific instruction text, and
// NO browser-supplied content of any kind -- every field here is derived
// exclusively from already-CONFIRMED, already-structured professional data
// (the TechnicalVisualMap's own effective payload, its spatial binding's
// own payload, and the AnalysisProposal's own frozen contraindications).

export const PHOTO_PREVIEW_GENERATION_SCHEMA_VERSION = "1.0.0";

// ---------------------------------------------------------------------------
// Source image identity snapshot -- mirrors
// TechnicalVisualMapSpatialBinding's own frozenWidth/frozenHeight/
// frozenOrientation/frozenContentSha256/frozenStorageVersionId precedent
// exactly (Decision Lock 15/16 there): copied once, at generation-request
// creation time, never re-read live from ImageAsset afterward. This is what
// keeps a PhotoPreviewGeneration auditable forever even if the live
// ImageAsset row is later mutated, or a newer spatial binding version is
// created for the same image.
// ---------------------------------------------------------------------------

export interface SealedPhotoPreviewSourceImage {
  assetId: string;
  width: number;
  height: number;
  orientation: number;
  contentSha256: string | null;
  storageVersionId: string | null;
}

export function isSealedPhotoPreviewSourceImage(value: unknown): value is SealedPhotoPreviewSourceImage {
  if (!isRecord(value)) return false;
  return (
    typeof value.assetId === "string" &&
    value.assetId.length > 0 &&
    typeof value.width === "number" &&
    Number.isFinite(value.width) &&
    value.width > 0 &&
    typeof value.height === "number" &&
    Number.isFinite(value.height) &&
    value.height > 0 &&
    typeof value.orientation === "number" &&
    Number.isFinite(value.orientation) &&
    (value.contentSha256 === null || typeof value.contentSha256 === "string") &&
    (value.storageVersionId === null || typeof value.storageVersionId === "string")
  );
}

// ---------------------------------------------------------------------------
// Provider-independent generation target -- frozen VERBATIM from the
// confirmed TechnicalVisualMap's own EFFECTIVE payload (baseline +
// professionalAdjustments already resolved by
// resolveEffectiveMapForRecord). Never re-derived from a live/possibly-
// superseded map later. Reuses the existing zone-intent/relationship types
// directly rather than inventing a second, competing shape (AI Photo
// Preview Stage 1 task, §8/§9: provider-independent intent must come ONLY
// from confirmed structured professional data).
// ---------------------------------------------------------------------------

export interface SealedPhotoPreviewTarget {
  globalIntent: TechnicalVisualMapGlobalIntent;
  zones: ZoneIntentEntry[];
  relationships: ZoneRelationshipEntry[];
}

export function isSealedPhotoPreviewTarget(value: unknown): value is SealedPhotoPreviewTarget {
  if (!isRecord(value)) return false;
  return (
    isTechnicalVisualMapGlobalIntent(value.globalIntent) &&
    isZoneIntentArray(value.zones) &&
    isZoneRelationshipArray(value.relationships)
  );
}

// ---------------------------------------------------------------------------
// Preserve contract -- provider-independent invariants this generation
// REQUESTS the provider honor. These are REQUESTED invariants, never a
// guarantee (AI Photo Preview Stage 0 audit, §11: "be honest about
// limitations" -- nothing in this pipeline can mathematically enforce any
// of these; a provider adapter can only prompt for them). The fixed list
// below is a hardcoded product invariant (task §7/§10-A), never derived
// from any user input, so it can never be widened or narrowed by a
// caller-supplied value. `mapPreserveConstraints` and `contraindications`
// are ADDITIVE, confirmed-structured-data context on top of it.
// ---------------------------------------------------------------------------

export const PHOTO_PREVIEW_PRESERVE_INVARIANTS = [
  "modify_hair_only",
  "preserve_face_identity",
  "preserve_facial_geometry",
  "preserve_skin_tone",
  "preserve_eyes",
  "preserve_nose",
  "preserve_lips",
  "preserve_ears_except_unavoidable_hair_occlusion",
  "preserve_expression",
  "preserve_body",
  "preserve_clothing",
  "preserve_jewelry_and_accessories_unless_hair_interaction_requires_otherwise",
  "preserve_background",
  "preserve_overall_photographic_realism",
] as const;
export type PhotoPreviewPreserveInvariant = (typeof PHOTO_PREVIEW_PRESERVE_INVARIANTS)[number];

export function isPhotoPreviewPreserveInvariant(value: unknown): value is PhotoPreviewPreserveInvariant {
  return typeof value === "string" && (PHOTO_PREVIEW_PRESERVE_INVARIANTS as readonly string[]).includes(value);
}

// The one, single, canonical set -- every sealed request carries the exact
// same invariant list. Exposed as a function (not a shared mutable array
// reference) so nothing downstream can accidentally mutate the constant.
export function buildPhotoPreviewPreserveInvariants(): PhotoPreviewPreserveInvariant[] {
  return [...PHOTO_PREVIEW_PRESERVE_INVARIANTS];
}

export interface SealedPhotoPreviewPreserveContract {
  invariants: PhotoPreviewPreserveInvariant[];
  mapPreserveConstraints: PreserveConstraintEntry[];
  // Frozen from the confirmed AnalysisProposal's own TechnicalCutPlan.
  // contraindications -- carried as DATA/context for a future provider
  // adapter or professional reviewer, never as an instruction (task §13:
  // every string entering the sealed request is audited; this one is
  // system/engine-authored, not professional free text, but is still never
  // concatenated as an instruction by anything in this module).
  contraindications: string[];
}

export function isSealedPhotoPreviewPreserveContract(value: unknown): value is SealedPhotoPreviewPreserveContract {
  if (!isRecord(value)) return false;
  return (
    Array.isArray(value.invariants) &&
    value.invariants.every(isPhotoPreviewPreserveInvariant) &&
    isPreserveConstraintArray(value.mapPreserveConstraints) &&
    Array.isArray(value.contraindications) &&
    value.contraindications.every((entry) => typeof entry === "string")
  );
}

// ---------------------------------------------------------------------------
// The full sealed request
// ---------------------------------------------------------------------------

export interface SealedPhotoPreviewRequest {
  schemaVersion: string;
  sourceImage: SealedPhotoPreviewSourceImage;
  viewLabel: ViewLabel;
  target: SealedPhotoPreviewTarget;
  // Frozen VERBATIM from the confirmed spatial binding's own payload --
  // never regenerated, never inferred (task §9). Reuses the existing
  // TechnicalVisualMapSpatialPayload type directly (six zone entries with
  // honest not_placed/not_visible/placed semantics + the perimeter) rather
  // than a second, competing spatial shape.
  spatial: TechnicalVisualMapSpatialPayload;
  preserveContract: SealedPhotoPreviewPreserveContract;
}

export function isSealedPhotoPreviewRequest(value: unknown): value is SealedPhotoPreviewRequest {
  if (!isRecord(value)) return false;
  return (
    typeof value.schemaVersion === "string" &&
    value.schemaVersion.length > 0 &&
    isSealedPhotoPreviewSourceImage(value.sourceImage) &&
    isViewLabel(value.viewLabel) &&
    isSealedPhotoPreviewTarget(value.target) &&
    isTechnicalVisualMapSpatialPayload(value.spatial) &&
    isSealedPhotoPreviewPreserveContract(value.preserveContract)
  );
}

// ---------------------------------------------------------------------------
// Assembly -- pure, given already-fetched/validated confirmed pieces. The
// repository layer is the only caller; it is solely responsible for
// fetching real, owned, confirmed rows BEFORE calling this. This function
// never touches the database and never decides eligibility -- it only
// shapes already-authoritative data into the frozen contract above.
// ---------------------------------------------------------------------------

export interface BuildSealedPhotoPreviewRequestInput {
  sourceImage: SealedPhotoPreviewSourceImage;
  viewLabel: ViewLabel;
  target: SealedPhotoPreviewTarget;
  spatial: TechnicalVisualMapSpatialPayload;
  mapPreserveConstraints: PreserveConstraintEntry[];
  contraindications: string[];
}

export function buildSealedPhotoPreviewRequest(input: BuildSealedPhotoPreviewRequestInput): SealedPhotoPreviewRequest {
  return {
    schemaVersion: PHOTO_PREVIEW_GENERATION_SCHEMA_VERSION,
    sourceImage: input.sourceImage,
    viewLabel: input.viewLabel,
    target: input.target,
    spatial: input.spatial,
    preserveContract: {
      invariants: buildPhotoPreviewPreserveInvariants(),
      mapPreserveConstraints: input.mapPreserveConstraints,
      contraindications: input.contraindications,
    },
  };
}

// ---------------------------------------------------------------------------
// Idempotency fingerprint -- deterministic, given the exact frozen scope +
// provider/model + an explicit variation index (task §18/§19). The DEFAULT
// "Generate" action always uses variationIndex 0, so two default submits
// for the exact same (owner, client, spatialBinding, spatialVersion,
// provider, model) scope always collide on the SAME fingerprint; an
// explicit "Generate another variation" action increments variationIndex,
// producing a genuinely different fingerprint and therefore a genuinely new
// row. This is a pure computation -- the repository layer is solely
// responsible for enforcing it as a real, DB-level unique constraint
// (never an application-only check -- task §20).
// ---------------------------------------------------------------------------

export function computePhotoPreviewRequestFingerprint(input: {
  ownerUserId: string;
  clientId: string;
  spatialBindingId: string;
  spatialVersion: number;
  provider: string;
  model: string;
  variationIndex: number;
}): string {
  const canonical = [
    input.ownerUserId,
    input.clientId,
    input.spatialBindingId,
    String(input.spatialVersion),
    input.provider,
    input.model,
    String(input.variationIndex),
  ].join("|");
  return createHash("sha256").update(canonical).digest("hex");
}
