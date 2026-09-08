import { isCaptureSetViewLabel } from "@/lib/capture-set-validators";

// AI Hair Architect, Stage 2.5.i.22 -- TECHNICAL EXECUTION GENERATION
// AUTHORIZATION + IMAGE QUALIFICATION, pure domain validators. No I/O,
// no database, no provider call, no AI -- mirrors this repo's own
// established "validators file, separate from repository file"
// convention (capture-set-validators.ts / capture-set-repository.ts).
//
// ARCHITECTURAL LOCK (Stage 2.5.i.20/i.21a audits, restated here):
// consent for transmitting a client image to an external AI/video
// provider is PER_GENERATION, affirmative only, and NEVER inherited
// from ImageAnalysis's own externalAiConsentGrantedAt, from Capture Set
// existence, or from a different generation request. Image-quality
// qualification is PURPOSE-SPECIFIC -- a snapshot bound to exactly one
// (image, purpose) pair, never a global ImageAsset/CaptureSetImage
// property. This file contains NO consent/quality DECISION logic --
// only the closed vocabularies and the pure READINESS evaluator that
// proves (or refuses to prove) a generation request is safe to hand to
// the Stage 2.5.i.21 Provider Adapter.
//
// WHAT THIS FILE IS NOT (Stage 2.5.i.22's own explicit boundary):
//   - it does NOT create, grant, or infer consent -- consent is always
//     an explicit, caller-supplied affirmative act (see
//     technical-execution-generation-repository.ts);
//   - it does NOT perform image-quality detection of any kind -- only a
//     closed-vocabulary RESULT (QUALIFIED/REJECTED/NOT_EVALUATED) and
//     its evidence source are represented, never computed here;
//   - it does NOT select an image on the caller's behalf -- the Provider
//     Adapter (Stage 2.5.i.21) and this gate both only ever consume an
//     already-selected reference, never choose one;
//   - it does NOT call a provider, build a prompt, or reference Veo/
//     Gemini/any model name anywhere;
//   - it does NOT read or write a database -- see
//     technical-execution-generation-repository.ts for that.

// ---------------------------------------------------------------------------
// Purpose -- only one real value today. Deliberately independent from
// Stage 2.5.i.21's own `generationIntent` vocabulary (adjacent but
// distinct concepts -- see the Prisma schema's own header comment for
// the full reasoning).
// ---------------------------------------------------------------------------

export const TECHNICAL_EXECUTION_GENERATION_PURPOSES = ["TECHNICAL_EXECUTION_VIDEO"] as const;
export type TechnicalExecutionGenerationPurpose = (typeof TECHNICAL_EXECUTION_GENERATION_PURPOSES)[number];

export function isTechnicalExecutionGenerationPurpose(value: unknown): value is TechnicalExecutionGenerationPurpose {
  return typeof value === "string" && (TECHNICAL_EXECUTION_GENERATION_PURPOSES as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Qualification -- purpose-specific, never a global ImageAsset property.
// ---------------------------------------------------------------------------

export const QUALIFICATION_STATUSES = ["NOT_EVALUATED", "QUALIFIED", "REJECTED"] as const;
export type QualificationStatus = (typeof QUALIFICATION_STATUSES)[number];

export function isQualificationStatus(value: unknown): value is QualificationStatus {
  return typeof value === "string" && (QUALIFICATION_STATUSES as readonly string[]).includes(value);
}

export const QUALIFICATION_EVIDENCE_SOURCES = ["MANUAL_USER_CONFIRMATION", "PROFESSIONAL_CONFIRMATION", "AUTOMATED_CHECK", "SYSTEM_METADATA", "HYBRID"] as const;
export type QualificationEvidenceSource = (typeof QUALIFICATION_EVIDENCE_SOURCES)[number];

export function isQualificationEvidenceSource(value: unknown): value is QualificationEvidenceSource {
  return typeof value === "string" && (QUALIFICATION_EVIDENCE_SOURCES as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// The fail-closed readiness gate. Pure -- takes already-resolved plain
// record shapes (the repository's own job is to fetch these fresh),
// never touches Prisma, never calls a provider.
// ---------------------------------------------------------------------------

export interface TechnicalExecutionGenerationReadinessRequest {
  ownerUserId: string;
  clientId: string;
  purpose: string;
  captureSetId: string;
  captureSetImageId: string;
  imageAssetId: string;
  consentGrantedAt: string | null;
  qualificationStatus: string;
  sealedAt: string | null;
}

export interface TechnicalExecutionGenerationReadinessCaptureSet {
  id: string;
  ownerUserId: string;
  clientId: string;
}

export interface TechnicalExecutionGenerationReadinessCaptureSetImage {
  id: string;
  captureSetId: string;
  ownerUserId: string;
  clientId: string;
  imageAssetId: string;
  viewLabel: string;
}

export type TechnicalExecutionGenerationReadinessResult = { status: "READY" } | { status: "BLOCKED"; reason: string };

// Every one of these checks is deliberately independent and explicit --
// no "trust the caller already filtered this" shortcuts. See file header
// for the exact locked semantics each check enforces. Structural
// invariants ("consent bound to this request", "qualification bound to
// selected image+purpose") are guaranteed by construction elsewhere
// (consent/qualification live directly on this one row, never a
// separately-referenceable object that could point at a different
// request) -- documented here, not re-checked redundantly.
export function evaluateTechnicalExecutionGenerationReadiness(
  request: TechnicalExecutionGenerationReadinessRequest,
  captureSet: TechnicalExecutionGenerationReadinessCaptureSet | null,
  captureSetImage: TechnicalExecutionGenerationReadinessCaptureSetImage | null,
): TechnicalExecutionGenerationReadinessResult {
  if (!isTechnicalExecutionGenerationPurpose(request.purpose)) {
    return { status: "BLOCKED", reason: "purpose is not a recognized Technical Execution generation purpose" };
  }

  if (!captureSet) {
    return { status: "BLOCKED", reason: "referenced Capture Set was not found" };
  }
  if (captureSet.id !== request.captureSetId || captureSet.ownerUserId !== request.ownerUserId || captureSet.clientId !== request.clientId) {
    return { status: "BLOCKED", reason: "Capture Set does not belong to the correct owner/client" };
  }

  if (!captureSetImage) {
    return { status: "BLOCKED", reason: "referenced Capture Set image was not found" };
  }
  if (captureSetImage.captureSetId !== request.captureSetId) {
    return { status: "BLOCKED", reason: "selected image does not belong to the selected Capture Set" };
  }
  if (captureSetImage.ownerUserId !== request.ownerUserId || captureSetImage.clientId !== request.clientId) {
    return { status: "BLOCKED", reason: "selected image does not belong to the correct owner/client" };
  }
  if (!isCaptureSetViewLabel(captureSetImage.viewLabel)) {
    return { status: "BLOCKED", reason: "selected image view label is not recognized" };
  }
  if (captureSetImage.imageAssetId !== request.imageAssetId) {
    return { status: "BLOCKED", reason: "frozen ImageAsset reference does not match the current Capture Set image" };
  }

  if (request.consentGrantedAt === null) {
    return { status: "BLOCKED", reason: "consent has not been affirmatively granted for this request" };
  }

  if (!isQualificationStatus(request.qualificationStatus) || request.qualificationStatus !== "QUALIFIED") {
    return { status: "BLOCKED", reason: `image qualification is ${request.qualificationStatus}, not QUALIFIED` };
  }

  if (request.sealedAt === null) {
    return { status: "BLOCKED", reason: "request is not sealed" };
  }

  return { status: "READY" };
}
