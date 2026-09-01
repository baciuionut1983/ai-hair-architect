import type { BadgeVariant } from "@/components/ui";
import type { VideoDemonstrationStatusView } from "@/lib/video-demonstration-status-view";

// Video UI, Result Visualization -- pure logic for the Video section. No
// React, no DOM, no fetch -- mirrors photo-preview-logic.ts's own
// plain-function style exactly, so every rule here is testable without a
// component-render harness.
//
// Only `VideoDemonstrationStatusView` is ever imported from the server-only
// video-demonstration-status-view.ts module, and only as a TYPE (`import
// type`) -- fully erased at compile time, never bundled into client code.
// The real, runtime mapping functions in that file (toVideoDemonstrationStatusView,
// toSafeVideoDemonstrationFailureMessage) stay strictly server-side; this
// file never re-implements them, because Stage 3's own API contract
// already returns a PRE-MAPPED failureMessage on every generation --
// unlike Photo Preview (whose API still returns a raw errorCode the client
// maps itself), Video's own client never needs its own
// errorCode-to-message table at all.

export type VideoDemonstrationUiStatus = VideoDemonstrationStatusView["status"];

// task §5/§6 -- user-friendly terminology, indeterminate only, never a
// fabricated percentage. Internal status names are never shown as primary
// UX (the raw REQUESTED/PROCESSING/COMPLETED/FAILED strings only ever
// drive logic/badges below, never rendered as reader-facing copy directly).
export const VIDEO_DEMONSTRATION_STATUS_LABELS: Record<VideoDemonstrationUiStatus, string> = {
  REQUESTED: "Preparing your video...",
  PROCESSING: "Generating your result video...",
  COMPLETED: "Video ready",
  FAILED: "Video could not be generated",
};

export function getVideoDemonstrationStatusLabel(status: VideoDemonstrationUiStatus): string {
  return VIDEO_DEMONSTRATION_STATUS_LABELS[status] ?? status;
}

export function getVideoDemonstrationStatusBadgeVariant(status: VideoDemonstrationUiStatus): BadgeVariant {
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

export function isVideoDemonstrationInFlight(status: VideoDemonstrationUiStatus): boolean {
  return status === "REQUESTED" || status === "PROCESSING";
}

// task §11 -- Video is the visualization of an EXISTING, already-confirmed
// Photo Preview result, never a new AI recommendation of its own. Product
// principle (this task's own header): "RESULT VISUALIZATION", not a
// technical/procedural demonstration -- provider/model names are
// deliberately never surfaced (Stage 3's own status contract does not
// expose them, by design; this file never re-derives or fetches them
// separately either).

// Safe messages for the create/execute HTTP call itself (network/auth/
// dependency-chain errors) -- mirrors mapPhotoPreviewApiError's own style.
// Distinct from generation.failureMessage (task §14/§8's own safe,
// server-mapped field for a TERMINAL FAILED generation) -- this table only
// covers the surrounding HTTP request failing outright (before/outside any
// generation record even being reachable).
export function mapVideoDemonstrationApiError(status: number, code?: string): string {
  if (status === 401) return "Please sign in again.";
  if (status === 404) return "This item is no longer available.";
  if (status === 422 && code && code.startsWith("VIDEO_DEMONSTRATION_GENERATION_")) {
    return "The source result this video would be based on has changed since this page loaded. Please refresh and try again.";
  }
  if (status === 422) return "This request could not be completed with the current data. Please review and try again.";
  if (status === 503) return "Video generation is not available right now. Please try again later.";
  if (status === 0) return "Could not reach the server. Please check your connection and try again.";
  return "Something went wrong. Please try again.";
}

export function formatVideoDemonstrationTimestamp(iso: string): string {
  return new Date(iso).toLocaleString();
}

export function videoAssetContentUrl(assetId: string): string {
  return `/api/v1/video-assets/${assetId}/content`;
}

// task §9 -- reload/return: reconstructs which generation (if any) is the
// one to show for this Photo Preview, from the list the backend already
// returns newest-first. No client-side authority beyond "pick the first
// (newest) entry" -- the backend's own list ordering is never re-sorted.
export function resolveLatestVideoDemonstration(history: readonly VideoDemonstrationStatusView[]): VideoDemonstrationStatusView | null {
  return history.length > 0 ? history[0] : null;
}
