import { Prisma } from "@prisma/client";

import { isDatabaseConfigured, prisma } from "@/lib/prisma";
import {
  isTerminalUploadSessionStatus,
  UPLOAD_SESSION_EXPIRY_HOURS,
  type UploadSessionMediaKind,
  type UploadSessionPurpose,
  type UploadSessionStatus,
} from "@/lib/professional-learning-upload-session-validators";

// AI Hair Architect, Professional Skill Engine Stage 8.5L3.1 -- LARGE
// MEDIA UPLOAD SESSION, the durable repository layer. Pure DB CRUD +
// fail-closed ownership scoping only -- no S3/provider calls anywhere in
// this file (see professional-learning-video-multipart-upload-service.ts
// for the orchestration layer that combines this with a real
// MultipartObjectStorage).
//
// OWNERSHIP IS FAIL-CLOSED (mirrors professional-learning-evidence-
// repository.ts's own Stage 8.5L2 Part 5 discipline exactly): every
// read/write below is scoped by ownerUserId in the WHERE clause itself.
//
// CONCURRENCY-SAFE STATE MACHINE: transitionUploadSessionStatus's WHERE
// clause requires the CURRENT status to exactly match the caller's
// expected `from` value -- two concurrent completion attempts (Stage
// 8.5L3.1 Part 14: "test repeated completion requests") can never both
// "win" the same transition; the loser's WHERE simply matches zero rows
// and the function returns null, which the orchestration layer treats as
// "someone else already moved this session, re-read its real state."

export const PROFESSIONAL_LEARNING_UPLOAD_SESSION_PERSISTENCE_ERROR_CODE = "PROFESSIONAL_LEARNING_UPLOAD_SESSION_PERSISTENCE_UNAVAILABLE";

export class UploadSessionPersistenceError extends Error {
  readonly code = PROFESSIONAL_LEARNING_UPLOAD_SESSION_PERSISTENCE_ERROR_CODE;
  readonly httpStatus = 503;

  constructor() {
    super("Upload session data is temporarily unavailable.");
    this.name = "UploadSessionPersistenceError";
  }
}

export function isUploadSessionPersistenceError(error: unknown): error is UploadSessionPersistenceError {
  return error instanceof UploadSessionPersistenceError;
}

export function uploadSessionPersistenceUnavailableResponse(): Response {
  return Response.json(
    { error: PROFESSIONAL_LEARNING_UPLOAD_SESSION_PERSISTENCE_ERROR_CODE, message: "Upload session data is temporarily unavailable." },
    { status: 503, headers: { "Cache-Control": "no-store" } },
  );
}

export interface UploadSessionRecord {
  readonly id: string;
  readonly ownerUserId: string;
  readonly clientId: string;
  readonly purpose: UploadSessionPurpose;
  readonly mediaKind: UploadSessionMediaKind;
  readonly fileName: string;
  readonly contentType: string;
  readonly expectedSizeBytes: number;
  readonly expectedChecksumSha256: string | null;
  readonly storageBucketAlias: string;
  readonly storageKey: string;
  readonly providerUploadId: string | null;
  readonly partSizeBytes: number;
  readonly status: UploadSessionStatus;
  readonly videoAssetId: string | null;
  readonly evidenceId: string | null;
  readonly errorCode: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly expiresAt: string;
  readonly completedAt: string | null;
  readonly abortedAt: string | null;
  readonly failedAt: string | null;
}

async function runUploadSessionQuery<T>(operation: () => Promise<T>): Promise<T> {
  if (!isDatabaseConfigured()) throw new UploadSessionPersistenceError();
  try {
    return await operation();
  } catch (error) {
    if (error instanceof UploadSessionPersistenceError) throw error;
    throw new UploadSessionPersistenceError();
  }
}

export interface CreateUploadSessionInput {
  readonly clientId: string;
  readonly fileName: string;
  readonly contentType: string;
  readonly expectedSizeBytes: number;
  readonly expectedChecksumSha256?: string | null;
  readonly storageBucketAlias: string;
  readonly storageKey: string;
  readonly providerUploadId: string;
  readonly partSizeBytes: number;
}

// `id` is the caller's own idempotency key (see this stage's own model
// header comment) -- a P2002 replay for the SAME owner returns the
// already-persisted row rather than throwing, so a retried "initiate"
// request never creates a second real S3 multipart upload.
export async function createUploadSession(ownerUserId: string, id: string, input: CreateUploadSessionInput): Promise<UploadSessionRecord> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + UPLOAD_SESSION_EXPIRY_HOURS * 60 * 60 * 1000);

  return runUploadSessionQuery(async () => {
    try {
      const row = await prisma.professionalLearningUploadSession.create({
        data: {
          id,
          ownerUserId,
          clientId: input.clientId,
          fileName: input.fileName,
          contentType: input.contentType,
          expectedSizeBytes: input.expectedSizeBytes,
          expectedChecksumSha256: input.expectedChecksumSha256 ?? null,
          storageBucketAlias: input.storageBucketAlias,
          storageKey: input.storageKey,
          providerUploadId: input.providerUploadId,
          partSizeBytes: input.partSizeBytes,
          expiresAt,
        },
      });
      return toRecord(row);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const existing = await prisma.professionalLearningUploadSession.findFirst({ where: { id, ownerUserId } });
        if (existing) return toRecord(existing);
      }
      throw error;
    }
  });
}

export async function findUploadSessionForOwner(ownerUserId: string, id: string): Promise<UploadSessionRecord | null> {
  return runUploadSessionQuery(async () => {
    const row = await prisma.professionalLearningUploadSession.findFirst({ where: { id, ownerUserId } });
    return row ? toRecord(row) : null;
  });
}

export interface TransitionUploadSessionInput {
  readonly from: readonly UploadSessionStatus[];
  readonly to: UploadSessionStatus;
  readonly data?: Record<string, unknown>;
}

// Returns the updated row, or null if the transition did not apply
// (wrong owner, wrong current status, or the row does not exist) --
// never throws for that case, since "someone already transitioned this"
// is an expected, recoverable outcome, not a persistence failure.
export async function transitionUploadSessionStatus(
  ownerUserId: string,
  id: string,
  input: TransitionUploadSessionInput,
): Promise<UploadSessionRecord | null> {
  return runUploadSessionQuery(async () => {
    const result = await prisma.professionalLearningUploadSession.updateMany({
      where: { id, ownerUserId, status: { in: [...input.from] } },
      data: { status: input.to, ...(input.data ?? {}) },
    });
    if (result.count === 0) return null;
    const row = await prisma.professionalLearningUploadSession.findFirst({ where: { id, ownerUserId } });
    return row ? toRecord(row) : null;
  });
}

// Owner-scoped listing of non-terminal sessions past their expiry --
// Stage 8.5L3.1 Part 10's own "decision logic only, no scheduler
// integration in this stage": this identifies WHICH sessions are eligible
// for expiry, it does not run as any kind of job itself.
export async function findExpiredNonTerminalUploadSessionIds(ownerUserId: string, now: Date): Promise<readonly string[]> {
  return runUploadSessionQuery(async () => {
    const rows = await prisma.professionalLearningUploadSession.findMany({
      where: { ownerUserId, status: { in: ["INITIATED", "UPLOADING", "COMPLETING", "FAILED"] }, expiresAt: { lte: now } },
      select: { id: true },
    });
    return rows.map((row) => row.id);
  });
}

function toRecord(row: {
  id: string;
  ownerUserId: string;
  clientId: string;
  purpose: string;
  mediaKind: string;
  fileName: string;
  contentType: string;
  expectedSizeBytes: number;
  expectedChecksumSha256: string | null;
  storageBucketAlias: string;
  storageKey: string;
  providerUploadId: string | null;
  partSizeBytes: number;
  status: string;
  videoAssetId: string | null;
  evidenceId: string | null;
  errorCode: string | null;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date;
  completedAt: Date | null;
  abortedAt: Date | null;
  failedAt: Date | null;
}): UploadSessionRecord {
  return {
    id: row.id,
    ownerUserId: row.ownerUserId,
    clientId: row.clientId,
    purpose: row.purpose as UploadSessionPurpose,
    mediaKind: row.mediaKind as UploadSessionMediaKind,
    fileName: row.fileName,
    contentType: row.contentType,
    expectedSizeBytes: row.expectedSizeBytes,
    expectedChecksumSha256: row.expectedChecksumSha256,
    storageBucketAlias: row.storageBucketAlias,
    storageKey: row.storageKey,
    providerUploadId: row.providerUploadId,
    partSizeBytes: row.partSizeBytes,
    status: row.status as UploadSessionStatus,
    videoAssetId: row.videoAssetId,
    evidenceId: row.evidenceId,
    errorCode: row.errorCode,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    abortedAt: row.abortedAt ? row.abortedAt.toISOString() : null,
    failedAt: row.failedAt ? row.failedAt.toISOString() : null,
  };
}

export { isTerminalUploadSessionStatus };
