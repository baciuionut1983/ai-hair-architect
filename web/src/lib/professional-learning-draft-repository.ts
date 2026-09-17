import { isDatabaseConfigured, prisma } from "@/lib/prisma";
import {
  isLegalDraftStatusTransition,
  type ProfessionalLearningComparisonOutcome,
  type ProfessionalLearningDiscernmentCategory,
  type ProfessionalLearningDraftStatus,
  type ProfessionalLearningExtraction,
} from "@/lib/professional-learning-draft-validators";
import type { DraftConflictDetail } from "@/lib/professional-learning-draft-comparison";
import type { ReferenceDependencyRelationship } from "@/lib/professional-learning-reference-dependency";
import type { ReviewedComparisonResult } from "@/lib/professional-learning-reviewed-comparison";
import type { ProfessionalLearningTemporalEvidence } from "@/lib/professional-learning-video-temporal-evidence";

// AI Hair Architect, Professional Skill Engine Stage 8.5L4 -- PROFESSIONAL
// LEARNING DRAFT, the durable repository layer. Mirrors this repo's own
// established conventions exactly: professional-learning-evidence-repository.ts's
// fail-closed owner-scoping, and professional-learning-upload-session-repository.ts's
// atomic `updateMany({ status: { in: [...from] } })` legal-transition
// pattern.
//
// OWNERSHIP IS FAIL-CLOSED: every read/write below is scoped by
// ownerUserId in the WHERE clause itself -- a row belonging to a
// different user is indistinguishable from a row that does not exist.
//
// NO HARD DELETE anywhere in this file -- every lifecycle change is a
// status transition; a superseded/rejected draft's row and its
// extraction/provenance are never removed (Part 15's "no destructive
// rewrite of history").
//
// IDEMPOTENCY (Part 32): createDraft relies on the schema's own
// @@unique([sourceEvidenceId, extractorVersion]) constraint. A P2002
// conflict is recovered by looking up the existing row OUTSIDE the
// failed write -- the exact same fix this codebase already applied once
// for ProfessionalLearningEvidence's own submissionId idempotency (a
// retry lookup run on an aborted transaction previously caused Postgres
// 25P02); this repository never repeats that mistake.

export const PROFESSIONAL_LEARNING_DRAFT_PERSISTENCE_ERROR_CODE = "PROFESSIONAL_LEARNING_DRAFT_PERSISTENCE_UNAVAILABLE";

export class ProfessionalLearningDraftPersistenceError extends Error {
  readonly code = PROFESSIONAL_LEARNING_DRAFT_PERSISTENCE_ERROR_CODE;
  readonly httpStatus = 503;

  constructor() {
    super("Professional learning draft data is temporarily unavailable.");
    this.name = "ProfessionalLearningDraftPersistenceError";
  }
}

export function isProfessionalLearningDraftPersistenceError(error: unknown): error is ProfessionalLearningDraftPersistenceError {
  return error instanceof ProfessionalLearningDraftPersistenceError;
}

export function professionalLearningDraftPersistenceUnavailableResponse(): Response {
  return Response.json(
    { error: PROFESSIONAL_LEARNING_DRAFT_PERSISTENCE_ERROR_CODE, message: "Professional learning draft data is temporarily unavailable." },
    { status: 503, headers: { "Cache-Control": "no-store" } },
  );
}

export class ProfessionalLearningDraftStateError extends Error {
  readonly code = "PROFESSIONAL_LEARNING_DRAFT_ILLEGAL_STATE_TRANSITION";
  readonly httpStatus = 409;

  constructor(
    readonly fromStatus: string,
    message: string,
  ) {
    super(message);
    this.name = "ProfessionalLearningDraftStateError";
  }
}

export interface ProfessionalLearningDraftRecord {
  readonly id: string;
  readonly ownerUserId: string;
  readonly sourceEvidenceId: string;
  readonly extractorVersion: string;
  readonly status: ProfessionalLearningDraftStatus;
  readonly discernmentCategory: ProfessionalLearningDiscernmentCategory;
  readonly comparisonOutcome: ProfessionalLearningComparisonOutcome;
  readonly comparedSkillId: string | null;
  readonly extraction: ProfessionalLearningExtraction;
  // Stage 8.5T1.2 -- additive, nullable. See professional-learning-video-
  // temporal-evidence.ts for the canonical shape. Null for every draft
  // that has none (every non-VIDEO draft, and every draft created before
  // this stage) -- never backfilled, never inferred after the fact.
  readonly temporalEvidence: ProfessionalLearningTemporalEvidence | null;
  readonly conflictDetail: DraftConflictDetail | null;
  readonly correctsDraftId: string | null;
  readonly supersededByDraftId: string | null;
  readonly correctionNote: Record<string, unknown> | null;
  readonly createdByUserId: string;
  readonly reviewedByUserId: string | null;
  readonly reviewedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

async function runDraftQuery<T>(operation: () => Promise<T>): Promise<T> {
  if (!isDatabaseConfigured()) throw new ProfessionalLearningDraftPersistenceError();

  try {
    return await operation();
  } catch (error) {
    if (error instanceof ProfessionalLearningDraftPersistenceError || error instanceof ProfessionalLearningDraftStateError) {
      throw error;
    }
    throw new ProfessionalLearningDraftPersistenceError();
  }
}

function toRecord(row: {
  id: string;
  ownerUserId: string;
  sourceEvidenceId: string;
  extractorVersion: string;
  status: string;
  discernmentCategory: string;
  comparisonOutcome: string;
  comparedSkillId: string | null;
  extraction: unknown;
  temporalEvidence: unknown;
  conflictDetail: unknown;
  correctsDraftId: string | null;
  supersededByDraftId: string | null;
  correctionNote: unknown;
  createdByUserId: string;
  reviewedByUserId: string | null;
  reviewedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): ProfessionalLearningDraftRecord {
  return {
    id: row.id,
    ownerUserId: row.ownerUserId,
    sourceEvidenceId: row.sourceEvidenceId,
    extractorVersion: row.extractorVersion,
    status: row.status as ProfessionalLearningDraftStatus,
    discernmentCategory: row.discernmentCategory as ProfessionalLearningDiscernmentCategory,
    comparisonOutcome: row.comparisonOutcome as ProfessionalLearningComparisonOutcome,
    comparedSkillId: row.comparedSkillId,
    extraction: (row.extraction ?? {}) as ProfessionalLearningExtraction,
    temporalEvidence: (row.temporalEvidence as ProfessionalLearningTemporalEvidence | null) ?? null,
    conflictDetail: (row.conflictDetail as DraftConflictDetail | null) ?? null,
    correctsDraftId: row.correctsDraftId,
    supersededByDraftId: row.supersededByDraftId,
    correctionNote: (row.correctionNote as Record<string, unknown> | null) ?? null,
    createdByUserId: row.createdByUserId,
    reviewedByUserId: row.reviewedByUserId,
    reviewedAt: row.reviewedAt ? row.reviewedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export interface CreateDraftInput {
  readonly sourceEvidenceId: string;
  readonly extractorVersion: string;
  readonly discernmentCategory: ProfessionalLearningDiscernmentCategory;
  readonly comparisonOutcome: ProfessionalLearningComparisonOutcome;
  readonly comparedSkillId: string | null;
  readonly extraction: ProfessionalLearningExtraction;
  // Stage 8.5T1.2 -- optional so createCorrectionDraft's own call site
  // (which never produces temporal evidence) needs no change. Omitted
  // or null both persist as NULL.
  readonly temporalEvidence?: ProfessionalLearningTemporalEvidence | null;
  readonly conflictDetail: DraftConflictDetail | null;
  readonly createdByUserId: string;
}

// Idempotent by (sourceEvidenceId, extractorVersion) -- see file header.
export async function createDraft(ownerUserId: string, id: string, input: CreateDraftInput): Promise<ProfessionalLearningDraftRecord> {
  return runDraftQuery(async () => {
    try {
      const row = await prisma.professionalLearningDraft.create({
        data: {
          id,
          ownerUserId,
          sourceEvidenceId: input.sourceEvidenceId,
          extractorVersion: input.extractorVersion,
          status: "DRAFT",
          discernmentCategory: input.discernmentCategory,
          comparisonOutcome: input.comparisonOutcome,
          comparedSkillId: input.comparedSkillId,
          extraction: input.extraction as object,
          temporalEvidence: (input.temporalEvidence as object | null) ?? undefined,
          conflictDetail: (input.conflictDetail as object | null) ?? undefined,
          createdByUserId: input.createdByUserId,
        },
      });
      return toRecord(row);
    } catch (error) {
      const isUniqueConflict = typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "P2002";
      if (!isUniqueConflict) throw error;
      // Recovery lookup runs OUTSIDE the failed write, on the plain
      // client -- never on a transaction that has already aborted.
      const existing = await prisma.professionalLearningDraft.findFirst({ where: { sourceEvidenceId: input.sourceEvidenceId, extractorVersion: input.extractorVersion, ownerUserId } });
      if (existing) return toRecord(existing);
      throw error;
    }
  });
}

export async function findDraftForOwner(ownerUserId: string, id: string): Promise<ProfessionalLearningDraftRecord | null> {
  return runDraftQuery(async () => {
    const row = await prisma.professionalLearningDraft.findFirst({ where: { id, ownerUserId } });
    return row ? toRecord(row) : null;
  });
}

export async function findDraftBySourceEvidenceAndExtractorVersion(
  ownerUserId: string,
  sourceEvidenceId: string,
  extractorVersion: string,
): Promise<ProfessionalLearningDraftRecord | null> {
  return runDraftQuery(async () => {
    const row = await prisma.professionalLearningDraft.findFirst({ where: { ownerUserId, sourceEvidenceId, extractorVersion } });
    return row ? toRecord(row) : null;
  });
}

export interface ListDraftsFilter {
  readonly sourceEvidenceId?: string;
  readonly status?: ProfessionalLearningDraftStatus;
}

export async function listDraftsForOwner(ownerUserId: string, filter: ListDraftsFilter = {}): Promise<readonly ProfessionalLearningDraftRecord[]> {
  return runDraftQuery(async () => {
    const rows = await prisma.professionalLearningDraft.findMany({
      where: { ownerUserId, ...(filter.sourceEvidenceId ? { sourceEvidenceId: filter.sourceEvidenceId } : {}), ...(filter.status ? { status: filter.status } : {}) },
      orderBy: { createdAt: "desc" },
    });
    return rows.map(toRecord);
  });
}

// Fail-closed transition -- both the pure isLegalDraftStatusTransition
// check AND the DB's own atomic `status: { in: [from] }` guard must agree
// (same double-gate discipline as every other lifecycle transition in
// this codebase).
export async function transitionDraftStatus(
  ownerUserId: string,
  id: string,
  to: ProfessionalLearningDraftStatus,
  data: Record<string, unknown> = {},
): Promise<ProfessionalLearningDraftRecord> {
  return runDraftQuery(async () => {
    const current = await prisma.professionalLearningDraft.findFirst({ where: { id, ownerUserId } });
    if (!current) throw new ProfessionalLearningDraftStateError("NOT_FOUND", "Draft not found.");
    const fromStatus = current.status as ProfessionalLearningDraftStatus;
    if (!isLegalDraftStatusTransition(fromStatus, to)) {
      throw new ProfessionalLearningDraftStateError(fromStatus, `Cannot transition draft from ${fromStatus} to ${to}.`);
    }

    const result = await prisma.professionalLearningDraft.updateMany({
      where: { id, ownerUserId, status: fromStatus },
      data: { status: to, ...data },
    });
    if (result.count === 0) {
      // Lost a race with another concurrent transition -- report the
      // NOW-current status, never silently succeed on stale assumptions.
      const fresh = await prisma.professionalLearningDraft.findFirst({ where: { id, ownerUserId } });
      throw new ProfessionalLearningDraftStateError(fresh?.status ?? "unknown", `Draft status changed concurrently; expected ${fromStatus}.`);
    }
    const row = await prisma.professionalLearningDraft.findFirst({ where: { id, ownerUserId } });
    if (!row) throw new ProfessionalLearningDraftPersistenceError();
    return toRecord(row);
  });
}

export interface CreateCorrectionDraftInput {
  readonly priorDraftId: string;
  readonly correctionEvidenceId: string;
  readonly extractorVersion: string;
  readonly extraction: ProfessionalLearningExtraction;
  // Stage 8.5L5.R1.1 (Section 21/24): `referenceDependencies` and
  // `reviewedComparison` are purely additive, optional keys -- zero
  // migration, since correctionNote is already a free Json? column. They
  // never replace `previousInterpretation`/`correction` (the existing
  // field-level diff), and `reviewedComparison` is deliberately never
  // written back into this row's own `comparisonOutcome`/`comparedSkillId`
  // columns (which createCorrectionDraft below still hardcodes/copies
  // exactly as before) -- a SEPARATE, ADDITIONAL annotation of what the
  // evidence supports after review, never an overwrite of history.
  readonly correctionNote: {
    readonly previousInterpretation: unknown;
    readonly correction: unknown;
    readonly correctedByUserId: string;
    readonly correctedAt: string;
    readonly referenceDependencies?: readonly ReferenceDependencyRelationship[];
    readonly reviewedComparison?: ReviewedComparisonResult;
  };
  readonly createdByUserId: string;
}

// Professional correction (Part 15): creates a NEW draft that
// `correctsDraftId` the prior one, and atomically transitions the prior
// draft to SUPERSEDED with `supersededByDraftId` pointing forward. Both
// writes happen in one transaction -- either both succeed or neither
// does; the prior draft's own row, extraction, and provenance are never
// rewritten or removed (no destructive rewrite of history).
export async function createCorrectionDraft(ownerUserId: string, newDraftId: string, input: CreateCorrectionDraftInput): Promise<ProfessionalLearningDraftRecord> {
  return runDraftQuery(async () => {
    const prior = await prisma.professionalLearningDraft.findFirst({ where: { id: input.priorDraftId, ownerUserId } });
    if (!prior) throw new ProfessionalLearningDraftStateError("NOT_FOUND", "The draft being corrected was not found.");
    const priorStatus = prior.status as ProfessionalLearningDraftStatus;
    if (!isLegalDraftStatusTransition(priorStatus, "SUPERSEDED")) {
      throw new ProfessionalLearningDraftStateError(priorStatus, `Cannot supersede a draft in status ${priorStatus}.`);
    }

    return prisma.$transaction(async (tx) => {
      const created = await tx.professionalLearningDraft.create({
        data: {
          id: newDraftId,
          ownerUserId,
          sourceEvidenceId: input.correctionEvidenceId,
          extractorVersion: input.extractorVersion,
          status: "DRAFT",
          discernmentCategory: "PROFESSIONAL_CORRECTION",
          comparisonOutcome: "POSSIBLE_CORRECTION",
          comparedSkillId: prior.comparedSkillId,
          extraction: input.extraction as object,
          correctsDraftId: input.priorDraftId,
          correctionNote: input.correctionNote as object,
          createdByUserId: input.createdByUserId,
        },
      });

      const superseded = await tx.professionalLearningDraft.updateMany({
        where: { id: input.priorDraftId, ownerUserId, status: priorStatus },
        data: { status: "SUPERSEDED", supersededByDraftId: newDraftId },
      });
      if (superseded.count === 0) {
        throw new ProfessionalLearningDraftStateError(priorStatus, "The draft being corrected changed status concurrently.");
      }

      return toRecord(created);
    });
  });
}
