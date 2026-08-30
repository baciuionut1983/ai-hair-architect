import type { BadgeVariant } from "@/components/ui";
import { humanizeEnumValue } from "@/lib/humanize-enum-value";
import type { PhotoPreviewGenerationRecord, PhotoPreviewGenerationStatus } from "@/lib/photo-preview-generation-repository";
import type { SealedPhotoPreviewTarget } from "@/lib/photo-preview-contracts";

import { HEAD_ZONE_LABELS, ZONE_LENGTH_INTENT_LABELS, ZONE_WEIGHT_INTENT_LABELS } from "./technical-visual-map-logic";
import { VIEW_LABEL_DISPLAY } from "./spatial-binding-logic";

// Real AI Photo Preview, Stage 3 -- pure logic for the professional review
// UI. No React, no DOM, no fetch -- mirrors spatial-binding-logic.ts's own
// plain-function style exactly, so every rule here is testable without a
// component-render harness (this codebase's own established convention: see
// vitest.config.ts's `include`, which only ever picks up `*.test.ts`).

export type PhotoPreviewLoadStatus = "ready" | "error";

export function resolvePhotoPreviewLoadStatus(response: { ok: boolean; status: number }): PhotoPreviewLoadStatus {
  return response.ok ? "ready" : "error";
}

// ---------------------------------------------------------------------------
// Status presentation (task §8) -- human-readable labels only; the raw enum
// value is never shown as primary UX.
// ---------------------------------------------------------------------------

export const PHOTO_PREVIEW_STATUS_LABELS: Record<PhotoPreviewGenerationStatus, string> = {
  REQUESTED: "Preparing preview...",
  PROCESSING: "Generating AI Photo Preview...",
  COMPLETED: "Preview ready",
  FAILED: "Generation failed",
};

export function getPhotoPreviewStatusLabel(status: PhotoPreviewGenerationStatus): string {
  return PHOTO_PREVIEW_STATUS_LABELS[status] ?? status;
}

export function getPhotoPreviewStatusBadgeVariant(status: PhotoPreviewGenerationStatus): BadgeVariant {
  switch (status) {
    case "COMPLETED":
      return "success";
    case "FAILED":
      return "danger";
    case "PROCESSING":
    case "REQUESTED":
      return "warning";
    default:
      return "neutral";
  }
}

// A generation is "in flight" from the professional's point of view whenever
// it is not yet in a terminal state -- used both to gate the "Generate
// another variation" action (task §21: never let a new paid attempt start
// while one is still outstanding) and to decide whether the light polling
// loop (task §11) should be watching this row at all.
export function isPhotoPreviewGenerationInFlight(status: PhotoPreviewGenerationStatus): boolean {
  return status === "REQUESTED" || status === "PROCESSING";
}

export function findInFlightPhotoPreviewGenerationIds(history: readonly PhotoPreviewGenerationRecord[]): string[] {
  return history.filter((entry) => isPhotoPreviewGenerationInFlight(entry.status)).map((entry) => entry.id);
}

// task §18 -- the variation action only ever becomes available once at least
// one generation already exists for this exact spatial binding scope (the
// list endpoint is already scoped that way server-side -- see
// listPhotoPreviewGenerationsForBinding).
export function canRequestPhotoPreviewVariation(history: readonly PhotoPreviewGenerationRecord[]): boolean {
  return history.length > 0;
}

// ---------------------------------------------------------------------------
// Safe error mapping (task §20) -- a single table shared by the two distinct
// vocabularies this feature ever surfaces: the PERSISTED row's own
// `errorCode` (a PhotoPreviewApplicationErrorCode, always prefixed
// PHOTO_PREVIEW_...) and the immediate POST response's `executionOutcome.code`
// (a PhotoPreviewExecutionResultCode, never prefixed). Normalizing away the
// optional prefix lets both share one table without duplicating every
// message. Never a raw provider body, stack trace, or config/key detail.
// ---------------------------------------------------------------------------

const PHOTO_PREVIEW_SAFE_FAILURE_MESSAGES: Record<string, string> = {
  PROCESSING_DISABLED: "Photo Preview is not available right now.",
  PROVIDER_CONFIGURATION_INVALID: "Photo Preview is not configured correctly right now.",
  CONFIGURATION_ERROR: "Photo Preview is not configured correctly right now.",
  GENERATION_NOT_FOUND: "This Photo Preview generation could not be found.",
  CLAIM_CONFLICT: "This preview is already being generated. Please wait a moment.",
  MAX_ATTEMPTS_EXCEEDED: "This preview could not be completed after multiple attempts.",
  SOURCE_UNAVAILABLE: "The source photo is unavailable right now.",
  PROVIDER_REFUSED: "The AI provider could not generate this preview.",
  PROVIDER_RATE_LIMITED: "The AI provider is temporarily busy. Please try again shortly.",
  PROVIDER_TIMEOUT: "Generation timed out. Please try again.",
  PROVIDER_ERROR: "The AI provider could not complete this preview.",
  PROVIDER_INVALID_RESPONSE: "The AI provider returned an unexpected result.",
  STORAGE_FAILED: "The preview was generated but could not be saved.",
  PERSISTENCE_FAILURE: "Generation could not be completed. Please try again.",
  INTERNAL_EXECUTION_FAILURE: "Generation could not be completed. Please try again.",
};

const DEFAULT_PHOTO_PREVIEW_FAILURE_MESSAGE = "Generation could not be completed. Please try again.";

function stripPhotoPreviewCodePrefix(code: string): string {
  return code.startsWith("PHOTO_PREVIEW_") ? code.slice("PHOTO_PREVIEW_".length) : code;
}

// Used for BOTH a persisted FAILED row's `errorCode` and an immediate
// execution outcome's `code` -- `null`/`undefined` (e.g. a generation that
// never reached a terminal failure) safely falls back to the generic message
// rather than throwing or rendering "undefined".
export function mapPhotoPreviewFailureCodeToMessage(code: string | null | undefined): string {
  if (!code) return DEFAULT_PHOTO_PREVIEW_FAILURE_MESSAGE;
  return PHOTO_PREVIEW_SAFE_FAILURE_MESSAGES[stripPhotoPreviewCodePrefix(code)] ?? DEFAULT_PHOTO_PREVIEW_FAILURE_MESSAGE;
}

// Safe messages for the create/generate HTTP call itself (network/auth/
// dependency-chain errors) -- mirrors mapSpatialBindingApiError's own style.
export function mapPhotoPreviewApiError(status: number, code?: string): string {
  if (status === 401) return "Please sign in again.";
  if (status === 404) return "This item is no longer available.";
  if (status === 422 && code && code.startsWith("PHOTO_PREVIEW_GENERATION_")) {
    return "The confirmed professional plan for this preview has changed since this page loaded. Please refresh and check the current confirmed plan before generating again.";
  }
  if (status === 422) return "This request could not be completed with the current data. Please review and try again.";
  if (status === 503) return "Photo Preview is temporarily unavailable. Please try again shortly.";
  return "Something went wrong. Please try again.";
}

// ---------------------------------------------------------------------------
// Generation details (task §23) -- source image, view, approved look/target,
// generated timestamp, without letting technical IDs dominate the UI.
// ---------------------------------------------------------------------------

// Accepts a plain `string` (not the narrower ViewLabel union) so it works
// equally for a PhotoPreviewGenerationRecord's own typed viewLabel and for a
// TechnicalVisualMapSpatialBindingRecord's -- the latter is typed as a plain
// string at the repository boundary (same reason spatial-binding-current.tsx
// itself indexes VIEW_LABEL_DISPLAY with a cast rather than assuming the
// narrower type). An unrecognized value safely falls back to itself.
export function getPhotoPreviewViewLabel(viewLabel: string): string {
  return VIEW_LABEL_DISPLAY[viewLabel as keyof typeof VIEW_LABEL_DISPLAY] ?? viewLabel;
}

// A short, human, one-line summary of the confirmed target this exact
// generation was sealed against -- reuses the SAME zone/technique label
// dictionaries the Technical Visual Map section already renders with, so the
// wording a professional sees here always matches what they already
// confirmed above. Zones with no real length/weight claim are omitted
// entirely, exactly like TechnicalVisualMapZoneSummary's own "never invent
// intent" rule.
export function summarizePhotoPreviewTarget(target: SealedPhotoPreviewTarget): string {
  const technique = humanizeEnumValue(target.globalIntent.structuralTechnique);
  const zoneParts = target.zones
    .filter((zone) => zone.lengthIntent !== "unspecified" || zone.weightIntent !== "unspecified")
    .map((zone) => {
      const details = [
        zone.lengthIntent !== "unspecified" ? ZONE_LENGTH_INTENT_LABELS[zone.lengthIntent] : null,
        zone.weightIntent !== "unspecified" ? ZONE_WEIGHT_INTENT_LABELS[zone.weightIntent] : null,
      ].filter((entry): entry is string => entry !== null);
      return `${HEAD_ZONE_LABELS[zone.zone]} (${details.join(", ")})`;
    });

  return zoneParts.length > 0 ? `${technique} -- ${zoneParts.join("; ")}` : technique;
}

export function formatPhotoPreviewTimestamp(iso: string): string {
  return new Date(iso).toLocaleString();
}

export function getPhotoPreviewVariationLabel(generation: Pick<PhotoPreviewGenerationRecord, "variationIndex">): string | null {
  return generation.variationIndex > 0 ? `Variation ${generation.variationIndex}` : null;
}
