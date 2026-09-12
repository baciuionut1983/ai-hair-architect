import { ALLOWED_LEARNING_VIDEO_MIME_TYPES } from "@/lib/learning-evidence-video-upload";

// AI Hair Architect, Professional Skill Engine Stage 8.5L3.1 -- LARGE
// MEDIA UPLOAD SESSION, pure domain validators. No I/O, no database, no
// provider call -- mirrors this repo's own established "validators file,
// separate from repository file" convention.
//
// PURPOSE LOCK (mid-stage product correction): exactly one real value,
// "PROFESSIONAL_LEARNING" -- Teach the AI is an ingestion gateway for the
// Professional Brain, never a generic media library/client gallery/
// Academy/Marketplace/social/cloud-drive surface. Mirrors
// professional-learning-evidence-validators.ts's own
// PROFESSIONAL_LEARNING_EVIDENCE_VISIBILITY_SCOPES "closed array of one,
// room to grow" pattern exactly.
export const UPLOAD_SESSION_PURPOSES = ["PROFESSIONAL_LEARNING"] as const;
export type UploadSessionPurpose = (typeof UPLOAD_SESSION_PURPOSES)[number];

export function isUploadSessionPurpose(value: unknown): value is UploadSessionPurpose {
  return typeof value === "string" && (UPLOAD_SESSION_PURPOSES as readonly string[]).includes(value);
}

// Only VIDEO exists today -- this session model exists specifically
// because video is the one media kind whose bytes must never be proxied
// through application memory at GB scale (Stage 8.5L3.1's own reason for
// existing). A future stage may add a value here for another large-media
// kind; nothing about the session shape itself is video-specific beyond
// this one field's current single real value.
export const UPLOAD_SESSION_MEDIA_KINDS = ["VIDEO"] as const;
export type UploadSessionMediaKind = (typeof UPLOAD_SESSION_MEDIA_KINDS)[number];

export function isUploadSessionMediaKind(value: unknown): value is UploadSessionMediaKind {
  return typeof value === "string" && (UPLOAD_SESSION_MEDIA_KINDS as readonly string[]).includes(value);
}

// INITIATED -> UPLOADING -> COMPLETING -> COMPLETED is the happy path;
// ABORTED/EXPIRED/FAILED are the three terminal failure/cancellation
// states, each reachable from any non-terminal state (Stage 8.5L3.1 Part
// 4: "use minimal state machine, do not over-model").
export const UPLOAD_SESSION_STATUSES = ["INITIATED", "UPLOADING", "COMPLETING", "COMPLETED", "ABORTED", "EXPIRED", "FAILED"] as const;
export type UploadSessionStatus = (typeof UPLOAD_SESSION_STATUSES)[number];

export function isUploadSessionStatus(value: unknown): value is UploadSessionStatus {
  return typeof value === "string" && (UPLOAD_SESSION_STATUSES as readonly string[]).includes(value);
}

const TERMINAL_STATUSES: ReadonlySet<UploadSessionStatus> = new Set(["COMPLETED", "ABORTED", "EXPIRED", "FAILED"]);

export function isTerminalUploadSessionStatus(status: UploadSessionStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

// Legal forward transitions only -- a terminal status never transitions
// again (a completed/aborted/expired/failed session is a permanent
// historical record, never resurrected). COMPLETING -> FAILED covers
// Part 13's own "storage upload completed but database transaction
// failed" recoverable case; FAILED -> COMPLETING is explicitly allowed so
// a retry of the SAME completion request can resume from there without
// re-uploading bytes.
const LEGAL_TRANSITIONS: Readonly<Record<UploadSessionStatus, ReadonlySet<UploadSessionStatus>>> = {
  INITIATED: new Set(["UPLOADING", "COMPLETING", "ABORTED", "EXPIRED", "FAILED"]),
  UPLOADING: new Set(["COMPLETING", "ABORTED", "EXPIRED", "FAILED"]),
  COMPLETING: new Set(["COMPLETED", "FAILED", "ABORTED"]),
  FAILED: new Set(["COMPLETING", "ABORTED"]),
  COMPLETED: new Set([]),
  ABORTED: new Set([]),
  EXPIRED: new Set([]),
};

export function isLegalUploadSessionTransition(from: UploadSessionStatus, to: UploadSessionStatus): boolean {
  return LEGAL_TRANSITIONS[from].has(to);
}

// Reuses the exact same allowlist the L3 buffered video path already
// validates against (learning-evidence-video-upload.ts) -- one video MIME
// policy, not two.
export function isValidUploadSessionContentType(value: unknown): boolean {
  return typeof value === "string" && ALLOWED_LEARNING_VIDEO_MIME_TYPES.has(value);
}

export const MAX_FILE_NAME_LENGTH = 255;

// Filename is metadata only (Stage 8.5L3.1 Part 6/15) -- never used to
// derive the storage key, never trusted for path/extension logic beyond
// display. Only rejected here for being structurally absent or absurdly
// long; sanitization for storage/display happens at the repository/UI
// layer using the same sanitizeFileName already proven in
// image-upload-validation.ts.
export function isValidUploadSessionFileName(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= MAX_FILE_NAME_LENGTH;
}

// S3's own real, documented multipart constraints (never invented):
// minimum part size 5MB (applies to every part except the last), maximum
// part size 5GB, maximum part count 10,000, maximum object size 5TB.
export const S3_MIN_PART_SIZE_BYTES = 5 * 1024 * 1024;
export const S3_MAX_PART_COUNT = 10_000;

// This application's OWN chosen, deliberately conservative values within
// those real S3 limits (Stage 8.5L3.1 Part 8 -- "document part size,
// maximum part count, maximum supported upload size... rationale"):
//
// MULTIPART_PART_SIZE_BYTES = 16MB: comfortably above S3's 5MB minimum
// (safe margin against off-by-one sizing bugs), a widely-used real-world
// default (larger than the AWS CLI's own 8MB default, chosen here
// specifically to keep part COUNT low for a several-GB file -- fewer,
// larger parts means fewer presigned-URL round trips and fewer
// opportunities for a part to fail), while still small enough that
// re-uploading one failed/retried part is cheap (at most ~16MB of
// wasted transfer, never the whole file).
//
// MAX_MULTIPART_UPLOAD_BYTES = 10GB: a deliberately bounded practical
// ceiling for THIS application, not a claim of S3's own 5TB theoretical
// maximum (Part 8: "do not claim unlimited size") -- large enough to
// cover a genuinely long, high-quality professional demonstration video,
// small enough that 10GB / 16MB = 640 parts stays an order of magnitude
// under S3's own 10,000-part hard limit AND under the 1,000-parts-per-page
// ListPartsCommand response this application's own listParts() call
// deliberately does not paginate (object-storage-s3.ts).
export const MULTIPART_PART_SIZE_BYTES = 16 * 1024 * 1024;
export const MAX_MULTIPART_UPLOAD_BYTES = 10 * 1024 * 1024 * 1024;
export const MAX_MULTIPART_PART_COUNT = Math.ceil(MAX_MULTIPART_UPLOAD_BYTES / MULTIPART_PART_SIZE_BYTES);

export interface MultipartUploadPlan {
  readonly partSizeBytes: number;
  readonly partCount: number;
  readonly lastPartSizeBytes: number;
}

export type MultipartUploadPlanErrorCode = "EMPTY_FILE" | "FILE_TOO_LARGE";

// Fixed-part-size chunking -- deterministic, re-derivable at any time from
// expectedSizeBytes alone (never persisted as a separate part-boundary
// table). Only the LAST part may be smaller than MULTIPART_PART_SIZE_BYTES
// (S3's own real allowance), and it is always > 0 for any accepted
// expectedSizeBytes.
export function computeMultipartUploadPlan(expectedSizeBytes: number): MultipartUploadPlan | MultipartUploadPlanErrorCode {
  if (!Number.isSafeInteger(expectedSizeBytes) || expectedSizeBytes <= 0) return "EMPTY_FILE";
  if (expectedSizeBytes > MAX_MULTIPART_UPLOAD_BYTES) return "FILE_TOO_LARGE";

  const partCount = Math.ceil(expectedSizeBytes / MULTIPART_PART_SIZE_BYTES);
  const lastPartSizeBytes = expectedSizeBytes - MULTIPART_PART_SIZE_BYTES * (partCount - 1);

  return { partSizeBytes: MULTIPART_PART_SIZE_BYTES, partCount, lastPartSizeBytes };
}

// Bounded, short-lived -- long enough that a real, slow upload of the
// largest supported part (16MB) over a poor connection can complete, far
// short of exposing a durable public URL. Each part gets its OWN
// presigned URL, generated just-in-time when the browser is actually
// about to upload that part -- never one giant batch of hours-long-lived
// URLs handed out upfront.
export const PART_UPLOAD_URL_EXPIRES_IN_SECONDS = 15 * 60;

// How long an INITIATED/UPLOADING/COMPLETING session may remain
// unfinished before it is considered abandoned (Stage 8.5L3.1 Part 10:
// "cleanup for expired abandoned multipart sessions if architecture
// permits" -- this is the DECISION threshold only; no scheduler runs in
// this stage).
export const UPLOAD_SESSION_EXPIRY_HOURS = 24;
