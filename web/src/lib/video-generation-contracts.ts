import { createHash } from "crypto";

import { isRecord } from "@/lib/technical-visual-map-validators";
import { isViewLabel, type ViewLabel } from "@/lib/technical-visual-map-spatial-validators";

// Real AI Video Demonstration, Stage 1 -- the sealed generation request's
// typed, versioned contract. Types-only + pure functions, mirroring
// photo-preview-contracts.ts's own convention exactly: no I/O, no database,
// no provider SDK import.
//
// Deliberately much SIMPLER than SealedPhotoPreviewRequest (Video Stage 0
// Decision Lock, section E/§10 of this stage's own task): Video V1 is
// Result Visualization only -- it never asks a provider to CHANGE anything
// (no zone-level intent, no spatial coordinates, no per-zone preserve
// constraints), it only asks for a natural, photorealistic ANIMATION of an
// image that is already correct. There is nothing here for a provider to
// hallucinate professional technique from, because no technique
// information is included at all.

export const VIDEO_DEMONSTRATION_SCHEMA_VERSION = "1.0.0";

// ---------------------------------------------------------------------------
// Source image snapshot -- the Photo Preview's own generated image, frozen
// at video-request-creation time. Mirrors SealedPhotoPreviewSourceImage's
// own shape, minus fields (orientation, storageVersionId) Video has no use
// for -- the source here is always an already-normalized "ai_generated"
// ImageAsset, never a raw upload needing EXIF handling.
// ---------------------------------------------------------------------------

export interface SealedVideoDemonstrationSourceImage {
  assetId: string;
  mimeType: string;
  contentSha256: string | null;
}

export function isSealedVideoDemonstrationSourceImage(value: unknown): value is SealedVideoDemonstrationSourceImage {
  if (!isRecord(value)) return false;
  return (
    typeof value.assetId === "string" &&
    value.assetId.length > 0 &&
    typeof value.mimeType === "string" &&
    value.mimeType.length > 0 &&
    (value.contentSha256 === null || typeof value.contentSha256 === "string")
  );
}

// ---------------------------------------------------------------------------
// Preserve contract -- provider-independent invariants this generation
// REQUESTS the provider honor (never a guarantee -- same honesty discipline
// as Photo Preview's own PHOTO_PREVIEW_PRESERVE_INVARIANTS). A deliberately
// SEPARATE, smaller list from Photo Preview's: "modify_hair_only" has no
// meaning here (Video never modifies anything), but every identity/scene
// preservation concern still applies equally to an animated result.
// ---------------------------------------------------------------------------

export const VIDEO_DEMONSTRATION_PRESERVE_INVARIANTS = [
  "preserve_identity",
  "preserve_facial_geometry",
  "preserve_skin_tone",
  "preserve_expression",
  "preserve_hairstyle_exactly_as_shown",
  "preserve_clothing",
  "preserve_jewelry_and_accessories",
  "preserve_background",
  "preserve_overall_photographic_realism",
] as const;
export type VideoDemonstrationPreserveInvariant = (typeof VIDEO_DEMONSTRATION_PRESERVE_INVARIANTS)[number];

export function isVideoDemonstrationPreserveInvariant(value: unknown): value is VideoDemonstrationPreserveInvariant {
  return typeof value === "string" && (VIDEO_DEMONSTRATION_PRESERVE_INVARIANTS as readonly string[]).includes(value);
}

export function buildVideoDemonstrationPreserveInvariants(): VideoDemonstrationPreserveInvariant[] {
  return [...VIDEO_DEMONSTRATION_PRESERVE_INVARIANTS];
}

// ---------------------------------------------------------------------------
// Target summary -- audit/display context only (task §2's own "provide
// enough context to understand what generated a preview" precedent), NEVER
// fed to the provider as an instruction to execute technique from. Only the
// structural technique name is carried, for a short human-readable label --
// deliberately NOT the full zone-level intent Photo Preview carries,
// because Video has no mechanism to honor per-zone geometry (Video Stage 0
// Decision Lock, section 10: current data is insufficient for technique
// fidelity, and this contract must not pretend otherwise by including it).
// ---------------------------------------------------------------------------

export interface SealedVideoDemonstrationTargetSummary {
  structuralTechnique: string;
}

export function isSealedVideoDemonstrationTargetSummary(value: unknown): value is SealedVideoDemonstrationTargetSummary {
  return isRecord(value) && typeof value.structuralTechnique === "string" && value.structuralTechnique.length > 0;
}

// ---------------------------------------------------------------------------
// The full sealed request
// ---------------------------------------------------------------------------

export interface SealedVideoDemonstrationRequest {
  schemaVersion: string;
  sourceImage: SealedVideoDemonstrationSourceImage;
  viewLabel: ViewLabel;
  targetSummary: SealedVideoDemonstrationTargetSummary;
  preserveContract: { invariants: VideoDemonstrationPreserveInvariant[] };
}

export function isSealedVideoDemonstrationRequest(value: unknown): value is SealedVideoDemonstrationRequest {
  if (!isRecord(value)) return false;
  if (typeof value.schemaVersion !== "string" || value.schemaVersion.length === 0) return false;
  if (!isSealedVideoDemonstrationSourceImage(value.sourceImage)) return false;
  if (!isViewLabel(value.viewLabel)) return false;
  if (!isSealedVideoDemonstrationTargetSummary(value.targetSummary)) return false;
  if (!isRecord(value.preserveContract)) return false;
  const invariants = value.preserveContract.invariants;
  return Array.isArray(invariants) && invariants.every(isVideoDemonstrationPreserveInvariant);
}

// ---------------------------------------------------------------------------
// Assembly -- pure, given already-fetched/validated confirmed pieces. The
// repository layer is the only caller.
// ---------------------------------------------------------------------------

export interface BuildSealedVideoDemonstrationRequestInput {
  sourceImage: SealedVideoDemonstrationSourceImage;
  viewLabel: ViewLabel;
  targetSummary: SealedVideoDemonstrationTargetSummary;
}

export function buildSealedVideoDemonstrationRequest(input: BuildSealedVideoDemonstrationRequestInput): SealedVideoDemonstrationRequest {
  return {
    schemaVersion: VIDEO_DEMONSTRATION_SCHEMA_VERSION,
    sourceImage: input.sourceImage,
    viewLabel: input.viewLabel,
    targetSummary: input.targetSummary,
    preserveContract: { invariants: buildVideoDemonstrationPreserveInvariants() },
  };
}

// ---------------------------------------------------------------------------
// Idempotency fingerprint -- deterministic, given the exact frozen scope +
// provider/model + an explicit variation index. Mirrors
// computePhotoPreviewRequestFingerprint exactly: the DEFAULT "Generate"
// action always uses variationIndex 0, so two default submits for the same
// (owner, client, photoPreviewGenerationId, provider, model) scope always
// collide on the same fingerprint.
// ---------------------------------------------------------------------------

export function computeVideoDemonstrationRequestFingerprint(input: {
  ownerUserId: string;
  clientId: string;
  photoPreviewGenerationId: string;
  provider: string;
  model: string;
  variationIndex: number;
}): string {
  const canonical = [
    input.ownerUserId,
    input.clientId,
    input.photoPreviewGenerationId,
    input.provider,
    input.model,
    String(input.variationIndex),
  ].join("|");
  return createHash("sha256").update(canonical).digest("hex");
}
