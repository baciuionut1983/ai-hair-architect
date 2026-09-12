import type { MultipartObjectStorage, MultipartUploadPart, ObjectMetadata } from "@/lib/object-storage";
import { buildImageAssetObjectKey } from "@/lib/object-storage";
import {
  createLearningEvidence,
  findLearningEvidenceForOwner,
  type ProfessionalLearningEvidenceRecord,
} from "@/lib/professional-learning-evidence-repository";
import { DEFAULT_LEARNING_EVIDENCE_RIGHTS_CLASSIFICATION, resolveLearningEvidenceTitle, resolveLearningEvidenceVertical } from "@/lib/learning-evidence-request-shared";
import {
  createUploadSession,
  findUploadSessionForOwner,
  isTerminalUploadSessionStatus,
  transitionUploadSessionStatus,
  type UploadSessionRecord,
} from "@/lib/professional-learning-upload-session-repository";
import {
  computeMultipartUploadPlan,
  isValidUploadSessionContentType,
  isValidUploadSessionFileName,
  PART_UPLOAD_URL_EXPIRES_IN_SECONDS,
  type MultipartUploadPlan,
} from "@/lib/professional-learning-upload-session-validators";
import { registerCompletedMultipartVideoAsset } from "@/lib/video-asset-storage";

// AI Hair Architect, Professional Skill Engine Stage 8.5L3.1 -- LARGE
// MEDIA INGESTION, the orchestration layer. Combines
// professional-learning-upload-session-repository.ts (pure DB) with an
// injected MultipartObjectStorage (real S3 in production, a hand-built
// fake in tests -- this repo's own "no mocking library, fake matching
// real shape" convention) to implement the full
// initiate -> part-URL -> complete -> finalize -> abort lifecycle.
//
// THE APPLICATION NEVER SEES THE VIDEO BYTES. Every function below only
// ever exchanges small JSON payloads (session metadata, presigned URLs,
// ETags) with the caller -- the browser uploads every part directly to
// S3 via the presigned URL this service hands back (Part 31's own
// absolute rule).
//
// FINALIZATION IS RETRY-SAFE WITHOUT A DISTRIBUTED TRANSACTION (Part 13/
// 14): completeVideoUploadSession checks for the ALREADY-ASSEMBLED S3
// object via head() BEFORE ever calling completeMultipartUpload again --
// once a multipart upload is completed, its own uploadId becomes invalid
// at the provider, so a naive unconditional retry would itself fail. A
// VideoAsset is only ever created once per session (session.videoAssetId
// is checked and persisted incrementally); ProfessionalLearningEvidence
// creation reuses this exact session's id as its own submissionId (Stage
// 8.5L3's own idempotency idiom), so it is safe to call again on every
// retry and always resolves to the same evidence row.

export type VideoUploadSessionErrorCode =
  | "INVALID_FILE_NAME"
  | "INVALID_MIMETYPE"
  | "EMPTY_FILE"
  | "FILE_TOO_LARGE"
  | "INVALID_SESSION_ID"
  | "SESSION_NOT_FOUND"
  | "SESSION_EXPIRED"
  | "SESSION_TERMINAL"
  | "SESSION_ALREADY_COMPLETING"
  | "PART_NUMBER_OUT_OF_RANGE"
  | "INCOMPLETE_PARTS_LIST"
  | "SIZE_MISMATCH"
  | "PROVIDER_CREATE_FAILED"
  | "PROVIDER_COMPLETE_FAILED"
  | "PROVIDER_VERIFY_FAILED"
  | "PROVIDER_ABORT_FAILED";

export class UploadSessionValidationError extends Error {
  readonly httpStatus = 400;
  constructor(readonly code: VideoUploadSessionErrorCode, message: string) {
    super(message);
    this.name = "UploadSessionValidationError";
  }
}

export class UploadSessionStateError extends Error {
  constructor(
    readonly code: VideoUploadSessionErrorCode,
    readonly httpStatus: 404 | 409 | 410,
    message: string,
  ) {
    super(message);
    this.name = "UploadSessionStateError";
  }
}

export class UploadSessionProviderError extends Error {
  readonly httpStatus = 502;
  constructor(readonly code: VideoUploadSessionErrorCode, message: string) {
    super(message);
    this.name = "UploadSessionProviderError";
  }
}

const SESSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function assertValidSessionId(sessionId: string): void {
  if (!SESSION_ID_PATTERN.test(sessionId)) {
    throw new UploadSessionValidationError("INVALID_SESSION_ID", "sessionId must be a valid UUID.");
  }
}

export interface VideoMultipartStorageDependencies {
  readonly storage: MultipartObjectStorage & { head(input: { bucketAlias: string; key: string }): Promise<ObjectMetadata> };
}

export interface InitiateVideoUploadSessionInput {
  readonly clientId: string;
  readonly fileName: string;
  readonly contentType: string;
  readonly expectedSizeBytes: number;
  readonly expectedChecksumSha256?: string;
}

export interface InitiateVideoUploadSessionResult {
  readonly session: UploadSessionRecord;
  readonly plan: MultipartUploadPlan;
}

export async function initiateVideoUploadSession(
  ownerUserId: string,
  sessionId: string,
  input: InitiateVideoUploadSessionInput,
  deps: VideoMultipartStorageDependencies,
): Promise<InitiateVideoUploadSessionResult> {
  assertValidSessionId(sessionId);

  // Idempotency (Stage 8.5L3.1 Part 14): a retried initiate request never
  // creates a second real S3 multipart upload.
  const existing = await findUploadSessionForOwner(ownerUserId, sessionId);
  if (existing) {
    const existingPlan = computeMultipartUploadPlan(existing.expectedSizeBytes);
    if (typeof existingPlan === "string") {
      throw new UploadSessionValidationError(existingPlan, "The existing session's declared size is no longer valid.");
    }
    return { session: existing, plan: existingPlan };
  }

  if (!isValidUploadSessionFileName(input.fileName)) {
    throw new UploadSessionValidationError("INVALID_FILE_NAME", "A valid file name is required.");
  }
  if (!isValidUploadSessionContentType(input.contentType)) {
    throw new UploadSessionValidationError("INVALID_MIMETYPE", `Unsupported video format: ${input.contentType}`);
  }

  const plan = computeMultipartUploadPlan(input.expectedSizeBytes);
  if (typeof plan === "string") {
    throw new UploadSessionValidationError(
      plan,
      plan === "EMPTY_FILE" ? "The declared file size is invalid." : "The declared file size exceeds the current large-upload limit.",
    );
  }

  // Server-generated, collision-safe, PRIVATE per-owner storage key --
  // reuses the exact same key-building authority every other asset in
  // this app already does (Stage 8.5L3.1 Part 6: "server-generated,
  // never derived from the client's own filename"). The session's own
  // UUID stands in for "assetId" -- both are equally collision-safe,
  // server-controlled identifiers.
  const relativeKey = buildImageAssetObjectKey(ownerUserId, sessionId);
  let created;
  try {
    created = await deps.storage.createMultipartUpload({ key: relativeKey, contentType: input.contentType });
  } catch {
    throw new UploadSessionProviderError("PROVIDER_CREATE_FAILED", "Could not start the upload with the storage provider.");
  }

  const session = await createUploadSession(ownerUserId, sessionId, {
    clientId: input.clientId,
    fileName: input.fileName,
    contentType: input.contentType,
    expectedSizeBytes: input.expectedSizeBytes,
    expectedChecksumSha256: input.expectedChecksumSha256 ?? null,
    storageBucketAlias: created.bucketAlias,
    storageKey: created.key,
    providerUploadId: created.uploadId,
    partSizeBytes: plan.partSizeBytes,
  });

  return { session, plan };
}

async function loadActiveSession(ownerUserId: string, sessionId: string): Promise<UploadSessionRecord> {
  const session = await findUploadSessionForOwner(ownerUserId, sessionId);
  if (!session) throw new UploadSessionStateError("SESSION_NOT_FOUND", 404, "Upload session not found.");
  return session;
}

async function expireIfPastDeadline(ownerUserId: string, session: UploadSessionRecord): Promise<UploadSessionRecord> {
  if (isTerminalUploadSessionStatus(session.status)) return session;
  if (new Date(session.expiresAt).getTime() > Date.now()) return session;
  const transitioned = await transitionUploadSessionStatus(ownerUserId, session.id, { from: [session.status], to: "EXPIRED" });
  return transitioned ?? session;
}

export interface RequestUploadPartUrlResult {
  readonly url: string;
  readonly partNumber: number;
  readonly expiresInSeconds: number;
}

export async function requestUploadPartUrl(
  ownerUserId: string,
  sessionId: string,
  partNumber: number,
  deps: VideoMultipartStorageDependencies,
): Promise<RequestUploadPartUrlResult> {
  assertValidSessionId(sessionId);
  let session = await loadActiveSession(ownerUserId, sessionId);
  session = await expireIfPastDeadline(ownerUserId, session);

  if (isTerminalUploadSessionStatus(session.status)) {
    throw new UploadSessionStateError(session.status === "EXPIRED" ? "SESSION_EXPIRED" : "SESSION_TERMINAL", session.status === "EXPIRED" ? 410 : 409, `Session is ${session.status}.`);
  }
  if (session.status === "COMPLETING") {
    throw new UploadSessionStateError("SESSION_ALREADY_COMPLETING", 409, "Session completion is already in progress.");
  }

  const plan = computeMultipartUploadPlan(session.expectedSizeBytes);
  if (typeof plan === "string" || !Number.isInteger(partNumber) || partNumber < 1 || partNumber > plan.partCount) {
    throw new UploadSessionValidationError("PART_NUMBER_OUT_OF_RANGE", `partNumber must be between 1 and ${typeof plan === "string" ? 0 : plan.partCount}.`);
  }

  if (session.status === "INITIATED") {
    await transitionUploadSessionStatus(ownerUserId, sessionId, { from: ["INITIATED"], to: "UPLOADING" });
  }

  let url: string;
  try {
    url = await deps.storage.presignUploadPart(
      { key: session.storageKey, uploadId: session.providerUploadId ?? "", partNumber },
      PART_UPLOAD_URL_EXPIRES_IN_SECONDS,
    );
  } catch {
    throw new UploadSessionProviderError("PROVIDER_CREATE_FAILED", "Could not authorize this part upload with the storage provider.");
  }

  return { url, partNumber, expiresInSeconds: PART_UPLOAD_URL_EXPIRES_IN_SECONDS };
}

// Resume support (Stage 8.5L3.1 Part 9): the provider itself is the
// authority on which parts already genuinely arrived -- a client that
// lost its in-memory progress (a page refresh) calls this to learn
// exactly which part numbers it can skip re-uploading.
export async function listUploadedParts(
  ownerUserId: string,
  sessionId: string,
  deps: VideoMultipartStorageDependencies,
): Promise<readonly MultipartUploadPart[]> {
  assertValidSessionId(sessionId);
  const session = await loadActiveSession(ownerUserId, sessionId);
  if (!session.providerUploadId || isTerminalUploadSessionStatus(session.status)) return [];
  return deps.storage.listParts({ key: session.storageKey, uploadId: session.providerUploadId });
}

export interface CompleteVideoUploadSessionInput {
  readonly parts: readonly { partNumber: number; etag: string }[];
  readonly title?: string;
  readonly vertical?: string;
}

export interface CompleteVideoUploadSessionResult {
  readonly evidence: ProfessionalLearningEvidenceRecord;
}

function isCompletePartsList(parts: readonly { partNumber: number; etag: string }[], expectedCount: number): boolean {
  if (parts.length !== expectedCount) return false;
  const seen = new Set<number>();
  for (const part of parts) {
    if (!Number.isInteger(part.partNumber) || part.partNumber < 1 || part.partNumber > expectedCount) return false;
    if (typeof part.etag !== "string" || part.etag.length === 0) return false;
    if (seen.has(part.partNumber)) return false;
    seen.add(part.partNumber);
  }
  return true;
}

// The AUTHORITATIVE finalization step (Part 11/22): "the client saying
// upload complete is not enough." Idempotent across retries at every
// stage -- see this file's own header comment.
export async function completeVideoUploadSession(
  ownerUserId: string,
  sessionId: string,
  input: CompleteVideoUploadSessionInput,
  deps: VideoMultipartStorageDependencies,
): Promise<CompleteVideoUploadSessionResult> {
  assertValidSessionId(sessionId);
  let session = await loadActiveSession(ownerUserId, sessionId);

  // Idempotent replay (Part 14/20): already fully completed.
  if (session.status === "COMPLETED") {
    if (!session.evidenceId) throw new UploadSessionStateError("SESSION_TERMINAL", 409, "Session is COMPLETED but has no recorded evidence.");
    const evidence = await findLearningEvidenceForOwner(ownerUserId, session.evidenceId);
    if (!evidence) throw new UploadSessionStateError("SESSION_TERMINAL", 409, "Session is COMPLETED but its evidence could not be found.");
    return { evidence };
  }
  if (session.status === "ABORTED") throw new UploadSessionStateError("SESSION_TERMINAL", 409, "Session was aborted.");

  session = await expireIfPastDeadline(ownerUserId, session);
  if (session.status === "EXPIRED") throw new UploadSessionStateError("SESSION_EXPIRED", 410, "Session has expired.");

  const plan = computeMultipartUploadPlan(session.expectedSizeBytes);
  if (typeof plan === "string") throw new UploadSessionStateError("SESSION_TERMINAL", 409, "Session's declared size is no longer valid.");

  if (!isCompletePartsList(input.parts, plan.partCount)) {
    throw new UploadSessionValidationError("INCOMPLETE_PARTS_LIST", `Exactly parts 1..${plan.partCount} must each be reported once.`);
  }

  // Atomic guard: only one caller can move a session into COMPLETING.
  // COMPLETING is included in `from` so a retry of a completion attempt
  // that is still (or again) in COMPLETING can proceed -- this is a
  // no-op transition, not a race, since only ONE logical completion flow
  // is ever driven by the same caller retrying its own prior attempt.
  const enteredCompleting = await transitionUploadSessionStatus(ownerUserId, sessionId, {
    from: ["INITIATED", "UPLOADING", "FAILED", "COMPLETING"],
    to: "COMPLETING",
  });
  if (!enteredCompleting) {
    const fresh = await findUploadSessionForOwner(ownerUserId, sessionId);
    throw new UploadSessionStateError("SESSION_TERMINAL", 409, `Session is ${fresh?.status ?? "unknown"}.`);
  }
  session = enteredCompleting;

  // Check whether the object was ALREADY assembled by a prior attempt
  // before ever calling completeMultipartUpload again -- once completed,
  // the provider's own uploadId is no longer valid, so an unconditional
  // retry would itself fail at the provider.
  let objectMeta: ObjectMetadata | null = null;
  try {
    objectMeta = await deps.storage.head({ bucketAlias: session.storageBucketAlias, key: session.storageKey });
  } catch {
    objectMeta = null;
  }

  let completedRef: { versionId: string | null; etag: string | null } | null = null;
  if (!objectMeta) {
    try {
      completedRef = await deps.storage.completeMultipartUpload({
        key: session.storageKey,
        uploadId: session.providerUploadId ?? "",
        parts: input.parts,
      });
    } catch {
      await transitionUploadSessionStatus(ownerUserId, sessionId, { from: ["COMPLETING"], to: "FAILED", data: { errorCode: "PROVIDER_COMPLETE_FAILED", failedAt: new Date() } });
      throw new UploadSessionProviderError("PROVIDER_COMPLETE_FAILED", "The storage provider rejected the part list -- a part may be missing, out of order, or its checksum may not match what was actually uploaded.");
    }

    try {
      objectMeta = await deps.storage.head({ bucketAlias: session.storageBucketAlias, key: session.storageKey });
    } catch {
      await transitionUploadSessionStatus(ownerUserId, sessionId, { from: ["COMPLETING"], to: "FAILED", data: { errorCode: "PROVIDER_VERIFY_FAILED", failedAt: new Date() } });
      throw new UploadSessionProviderError("PROVIDER_VERIFY_FAILED", "Could not verify the completed object with the storage provider.");
    }
  }

  // Never trust the client-declared size after upload (Part 11).
  if (objectMeta.sizeBytes !== session.expectedSizeBytes) {
    await transitionUploadSessionStatus(ownerUserId, sessionId, { from: ["COMPLETING"], to: "FAILED", data: { errorCode: "SIZE_MISMATCH", failedAt: new Date() } });
    throw new UploadSessionValidationError("SIZE_MISMATCH", `The uploaded object is ${objectMeta.sizeBytes} bytes; ${session.expectedSizeBytes} were declared.`);
  }

  // VideoAsset creation is guarded by session.videoAssetId so a retry
  // after a DB failure never creates a second row (Part 13).
  let videoAssetId = session.videoAssetId;
  if (!videoAssetId) {
    const videoAsset = await registerCompletedMultipartVideoAsset({
      ownerUserId,
      clientId: session.clientId,
      bucketAlias: session.storageBucketAlias,
      key: session.storageKey,
      versionId: completedRef?.versionId ?? null,
      etag: completedRef?.etag ?? null,
      mimeType: objectMeta.contentType ?? session.contentType,
      sizeBytes: objectMeta.sizeBytes,
    });
    videoAssetId = videoAsset.id;
    await transitionUploadSessionStatus(ownerUserId, sessionId, { from: ["COMPLETING"], to: "COMPLETING", data: { videoAssetId } });
  }

  // Reuses this session's own id as the evidence's submissionId (Stage
  // 8.5L3's idempotency idiom) -- safe to call on every retry, always
  // resolves to the same evidence row.
  const evidence = await createLearningEvidence(
    ownerUserId,
    {
      evidenceType: "VIDEO",
      vertical: resolveLearningEvidenceVertical(input.vertical),
      title: resolveLearningEvidenceTitle(input.title),
      videoAssetId,
      provenance: { channel: "upload", purpose: "PROFESSIONAL_LEARNING", transport: "multipart" },
      rightsClassification: DEFAULT_LEARNING_EVIDENCE_RIGHTS_CLASSIFICATION,
    },
    { submissionId: sessionId },
  );

  await transitionUploadSessionStatus(ownerUserId, sessionId, {
    from: ["COMPLETING"],
    to: "COMPLETED",
    data: { evidenceId: evidence.id, completedAt: new Date() },
  });

  return { evidence };
}

export async function abortVideoUploadSession(ownerUserId: string, sessionId: string, deps: VideoMultipartStorageDependencies): Promise<void> {
  assertValidSessionId(sessionId);
  const session = await loadActiveSession(ownerUserId, sessionId);
  if (isTerminalUploadSessionStatus(session.status)) return;

  const transitioned = await transitionUploadSessionStatus(ownerUserId, sessionId, {
    from: ["INITIATED", "UPLOADING", "COMPLETING", "FAILED"],
    to: "ABORTED",
    data: { abortedAt: new Date() },
  });
  if (!transitioned) return;

  if (session.providerUploadId) {
    try {
      await deps.storage.abortMultipartUpload({ key: session.storageKey, uploadId: session.providerUploadId });
    } catch {
      // Best-effort only -- the session itself is already, durably marked
      // ABORTED (Part 10: "mark session aborted" is the primary,
      // authoritative signal). An abandoned provider-side multipart
      // upload with no further parts ever arriving is inert and,
      // depending on the bucket's own lifecycle configuration, may be
      // cleaned up by the provider itself; this application never
      // creates a VideoAsset/evidence for it regardless.
    }
  }
}
