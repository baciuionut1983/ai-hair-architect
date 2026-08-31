import type { VideoDemonstrationGenerationRecord } from "@/lib/video-generation-repository";

// Real AI Video Demonstration, Stage 3 (task §8) -- the ONE stable,
// minimal, frontend-safe projection of a VideoDemonstrationGenerationRecord.
// Every route that ever shows a generation to a caller (GET status, POST
// create, POST execute, GET list) builds its response through this
// function -- never the raw internal record, which carries
// providerOperationId, the full sealedRequest, raw errorMetadata, internal
// claim timestamps, and the internal (Veo-shaped) errorCode vocabulary,
// none of which a caller is ever entitled to see (task §8's own explicit
// "NU expune" list).
//
// Pure, no I/O -- takes an already-loaded record and returns a plain,
// JSON-serializable view.

export interface VideoDemonstrationStatusView {
  id: string;
  photoPreviewGenerationId: string;
  clientId: string;
  status: "REQUESTED" | "PROCESSING" | "COMPLETED" | "FAILED";
  variationIndex: number;
  createdAt: string;
  processingStartedAt: string | null;
  completedAt: string | null;
  failedAt: string | null;
  // Present ONLY when status === "FAILED" -- a safe, user-facing sentence,
  // never the raw internal errorCode or provider error text.
  failureMessage: string | null;
  // Present ONLY when status === "COMPLETED" -- the one pointer a caller
  // needs to fetch the actual result; never a signed/temporary provider
  // URL (task §8), and never the VideoAsset's own storage internals.
  resultAsset: { assetId: string } | null;
  // Mechanical fact ("would a retry attempt -- creating a fresh variation
  // -- be a legitimate next action"), never a promise it will succeed; the
  // server always re-validates the full authority chain at creation time
  // regardless (task §11: "serverul decide").
  retryEligible: boolean;
}

// task §10 -- internal (Veo-shaped) errorCode -> safe, user-facing
// message. Every code this codebase can ever persist to
// VideoDemonstrationGeneration.errorCode MUST have an entry here (a
// pure-function test locks this down) -- an unmapped code falls through
// to the generic default, never leaking the raw internal string.
const SAFE_FAILURE_MESSAGES: Readonly<Record<string, string>> = {
  VIDEO_DEMONSTRATION_PROVIDER_REFUSED: "This video could not be generated from the source image. Try a different photo preview.",
  VIDEO_DEMONSTRATION_STORAGE_FAILED: "The video was generated but could not be saved. Please try again.",
  VIDEO_DEMONSTRATION_SOURCE_UNAVAILABLE: "The source preview is no longer available.",
  VIDEO_DEMONSTRATION_CONFIGURATION_ERROR: "Video generation is not available right now. Please try again later.",
  VIDEO_DEMONSTRATION_OPERATION_NOT_FOUND: "This video generation could not be completed. Please try again.",
  VIDEO_DEMONSTRATION_PROVIDER_RATE_LIMITED: "The video service is temporarily busy. Please try again shortly.",
  VIDEO_DEMONSTRATION_PROVIDER_TIMEOUT: "Video generation timed out. Please try again.",
  VIDEO_DEMONSTRATION_PROVIDER_INVALID_RESPONSE: "This video generation could not be completed. Please try again.",
  VIDEO_DEMONSTRATION_PROVIDER_ERROR: "The video service is temporarily unavailable. Please try again.",
  VIDEO_DEMONSTRATION_PROCESSING_TIMEOUT: "This video is taking longer than expected and could not be completed. Please try again.",
};
const DEFAULT_SAFE_FAILURE_MESSAGE = "This video could not be generated. Please try again.";

export function toSafeVideoDemonstrationFailureMessage(errorCode: string | null): string | null {
  if (!errorCode) return null;
  return SAFE_FAILURE_MESSAGES[errorCode] ?? DEFAULT_SAFE_FAILURE_MESSAGE;
}

export function toVideoDemonstrationStatusView(record: VideoDemonstrationGenerationRecord): VideoDemonstrationStatusView {
  return {
    id: record.id,
    photoPreviewGenerationId: record.photoPreviewGenerationId,
    clientId: record.clientId,
    status: record.status,
    variationIndex: record.variationIndex,
    createdAt: record.requestedAt,
    processingStartedAt: record.startedAt,
    completedAt: record.completedAt,
    failedAt: record.failedAt,
    failureMessage: record.status === "FAILED" ? toSafeVideoDemonstrationFailureMessage(record.errorCode) : null,
    resultAsset: record.status === "COMPLETED" && record.generatedVideoAssetId ? { assetId: record.generatedVideoAssetId } : null,
    retryEligible: record.status === "FAILED",
  };
}
