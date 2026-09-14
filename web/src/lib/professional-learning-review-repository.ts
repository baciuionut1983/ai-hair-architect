import { isDatabaseConfigured, prisma } from "@/lib/prisma";
import {
  isValidApprovalDetail,
  type ProfessionalLearningReviewApprovalDetail,
  type ProfessionalLearningReviewStatus,
} from "@/lib/professional-learning-review-validators";

// AI Hair Architect, Professional Skill Engine Stage 8.5L5.R2 -- PROFESSIONAL
// REVIEW OF BLIND LONG-VIDEO EXTRACTION, the durable repository layer.
// Mirrors professional-learning-draft-repository.ts's own established
// conventions exactly: fail-closed owner-scoping on every read/write,
// idempotent create recovered via a post-P2002 lookup run OUTSIDE the
// failed write (never on an aborted transaction).
//
// OWNERSHIP IS FAIL-CLOSED: every read/write below is scoped by
// ownerUserId in the WHERE clause itself -- a row belonging to a
// different user is indistinguishable from a row that does not exist.
//
// NO UPDATE PATH IN THIS FILE, deliberately: a review row is written once
// and never mutated afterward -- a professional who wants to say
// something different reviews again under a NEW `reviewedExtractionVersion`
// (a genuinely new row), never an edit of a prior professional judgment's
// own record.

export const PROFESSIONAL_LEARNING_REVIEW_PERSISTENCE_ERROR_CODE = "PROFESSIONAL_LEARNING_REVIEW_PERSISTENCE_UNAVAILABLE";

export class ProfessionalLearningReviewPersistenceError extends Error {
  readonly code = PROFESSIONAL_LEARNING_REVIEW_PERSISTENCE_ERROR_CODE;
  readonly httpStatus = 503;

  constructor() {
    super("Professional learning review data is temporarily unavailable.");
    this.name = "ProfessionalLearningReviewPersistenceError";
  }
}

export function isProfessionalLearningReviewPersistenceError(error: unknown): error is ProfessionalLearningReviewPersistenceError {
  return error instanceof ProfessionalLearningReviewPersistenceError;
}

export interface ProfessionalLearningReviewRecord {
  readonly id: string;
  readonly ownerUserId: string;
  readonly sourceEvidenceId: string;
  readonly reviewedExtractionVersion: string;
  readonly approvedResultHash: string;
  readonly status: ProfessionalLearningReviewStatus;
  readonly approvalDetail: ProfessionalLearningReviewApprovalDetail;
  readonly reviewedByUserId: string;
  readonly reviewedAt: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

async function runReviewQuery<T>(operation: () => Promise<T>): Promise<T> {
  if (!isDatabaseConfigured()) throw new ProfessionalLearningReviewPersistenceError();

  try {
    return await operation();
  } catch (error) {
    if (error instanceof ProfessionalLearningReviewPersistenceError) throw error;
    throw new ProfessionalLearningReviewPersistenceError();
  }
}

function toRecord(row: {
  id: string;
  ownerUserId: string;
  sourceEvidenceId: string;
  reviewedExtractionVersion: string;
  approvedResultHash: string;
  status: string;
  approvalDetail: unknown;
  reviewedByUserId: string;
  reviewedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}): ProfessionalLearningReviewRecord {
  const approvalDetail = row.approvalDetail;
  if (!isValidApprovalDetail(approvalDetail)) {
    // Fail-closed: a row whose stored detail no longer matches the
    // validator (e.g. hand-edited in the DB) is never silently trusted.
    throw new ProfessionalLearningReviewPersistenceError();
  }
  return {
    id: row.id,
    ownerUserId: row.ownerUserId,
    sourceEvidenceId: row.sourceEvidenceId,
    reviewedExtractionVersion: row.reviewedExtractionVersion,
    approvedResultHash: row.approvedResultHash,
    status: row.status as ProfessionalLearningReviewStatus,
    approvalDetail,
    reviewedByUserId: row.reviewedByUserId,
    reviewedAt: row.reviewedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export interface CreateReviewInput {
  readonly sourceEvidenceId: string;
  readonly reviewedExtractionVersion: string;
  readonly approvedResultHash: string;
  readonly approvalDetail: ProfessionalLearningReviewApprovalDetail;
  readonly reviewedByUserId: string;
  readonly reviewedAt: string;
}

// Idempotent by (sourceEvidenceId, reviewedExtractionVersion) -- see file
// header. A second call with the SAME version never creates a duplicate
// row; it returns the existing one unchanged.
export async function createReview(ownerUserId: string, id: string, input: CreateReviewInput): Promise<ProfessionalLearningReviewRecord> {
  return runReviewQuery(async () => {
    try {
      const row = await prisma.professionalLearningReview.create({
        data: {
          id,
          ownerUserId,
          sourceEvidenceId: input.sourceEvidenceId,
          reviewedExtractionVersion: input.reviewedExtractionVersion,
          approvedResultHash: input.approvedResultHash,
          status: "PROFESSIONALLY_VALIDATED",
          approvalDetail: input.approvalDetail as object,
          reviewedByUserId: input.reviewedByUserId,
          reviewedAt: new Date(input.reviewedAt),
        },
      });
      return toRecord(row);
    } catch (error) {
      const isUniqueConflict = typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "P2002";
      if (!isUniqueConflict) throw error;
      // Recovery lookup runs OUTSIDE the failed write, on the plain
      // client -- never on a transaction that has already aborted.
      const existing = await prisma.professionalLearningReview.findFirst({
        where: { sourceEvidenceId: input.sourceEvidenceId, reviewedExtractionVersion: input.reviewedExtractionVersion, ownerUserId },
      });
      if (existing) return toRecord(existing);
      throw error;
    }
  });
}

export async function findReviewForOwner(ownerUserId: string, id: string): Promise<ProfessionalLearningReviewRecord | null> {
  return runReviewQuery(async () => {
    const row = await prisma.professionalLearningReview.findFirst({ where: { id, ownerUserId } });
    return row ? toRecord(row) : null;
  });
}

export async function findReviewBySourceEvidenceAndVersion(
  ownerUserId: string,
  sourceEvidenceId: string,
  reviewedExtractionVersion: string,
): Promise<ProfessionalLearningReviewRecord | null> {
  return runReviewQuery(async () => {
    const row = await prisma.professionalLearningReview.findFirst({ where: { ownerUserId, sourceEvidenceId, reviewedExtractionVersion } });
    return row ? toRecord(row) : null;
  });
}

export async function listReviewsForOwner(ownerUserId: string, sourceEvidenceId?: string): Promise<readonly ProfessionalLearningReviewRecord[]> {
  return runReviewQuery(async () => {
    const rows = await prisma.professionalLearningReview.findMany({
      where: { ownerUserId, ...(sourceEvidenceId ? { sourceEvidenceId } : {}) },
      orderBy: { createdAt: "desc" },
    });
    return rows.map(toRecord);
  });
}
