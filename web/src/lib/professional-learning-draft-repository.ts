import { Prisma } from "@prisma/client";
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
import { isSameProceduralReviewDecision, isValidProceduralReviewState, type ProceduralClaimReviewEntry, type ProceduralReviewState } from "@/lib/professional-learning-procedural-review-validators";
import { isExpectedProceduralReviewRevision } from "@/lib/professional-learning-procedural-read";

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
  // Stage 8.5T1.4.b.1 -- additive, nullable. LAYER 3 (see professional-
  // learning-procedural-review-validators.ts's own header for the full
  // three-layer authority argument). Null for every draft that has
  // never received a procedural review -- never backfilled.
  readonly proceduralReview: ProceduralReviewState | null;
  readonly proceduralReviewRevision: number;
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
    if (
      error instanceof ProfessionalLearningDraftPersistenceError ||
      error instanceof ProfessionalLearningDraftStateError ||
      error instanceof ProfessionalLearningProceduralReviewStateError
    ) {
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
  proceduralReview: unknown;
  proceduralReviewRevision: number;
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
    // Stage 8.5T1.4.b.1 -- defensive read-side validation, mirroring
    // temporalEvidence's own established discipline: a null column is
    // never validated at all; a non-null value is only ever trusted if
    // it still matches the exact expected shape.
    proceduralReview: row.proceduralReview !== null && row.proceduralReview !== undefined && isValidProceduralReviewState(row.proceduralReview) ? row.proceduralReview : null,
    proceduralReviewRevision: row.proceduralReviewRevision,
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

// Stage 8.5T1.2.R1 -- EXPLICIT REANALYSIS, atomic claim/complete/revert.
// This is the ONLY safe way to reuse the SAME (sourceEvidenceId,
// extractorVersion) row for a fresh extraction attempt: the schema's own
// @@unique constraint above makes a second CREATE for that pair
// impossible without a migration, so an explicit professional
// reanalysis reuses the existing row via an in-place, atomically-claimed
// UPDATE instead of a second row.
//
// A row already past professional review (APPROVED/REJECTED/SUPERSEDED)
// is NEVER eligible -- claimDraftForReanalysis's own WHERE clause below
// only ever matches DRAFT/READY_FOR_REVIEW (or a STALE REANALYZING claim,
// see REANALYSIS_STALE_AFTER_MS), so approved/professionally-validated
// history can never be silently rewritten by this path.
//
// CONCURRENCY: the claim is a single atomic `updateMany` -- exactly one
// concurrent caller can ever win it (mirrors transitionDraftStatus's own
// `status: fromStatus` CAS discipline above, and image-analysis-job-
// repository.ts's own claim-before-provider-call precedent). A second
// concurrent/retried/double-clicked request finds count === 0 and must
// fail closed -- it never triggers a second provider call.
const REANALYSIS_STALE_AFTER_MS = 15 * 60 * 1000;

export async function claimDraftForReanalysis(ownerUserId: string, id: string, now: Date = new Date()): Promise<boolean> {
  return runDraftQuery(async () => {
    const staleBefore = new Date(now.getTime() - REANALYSIS_STALE_AFTER_MS);
    const claimed = await prisma.professionalLearningDraft.updateMany({
      where: {
        id,
        ownerUserId,
        OR: [{ status: { in: ["DRAFT", "READY_FOR_REVIEW"] } }, { status: "REANALYZING", updatedAt: { lt: staleBefore } }],
      },
      data: { status: "REANALYZING" },
    });
    return claimed.count === 1;
  });
}

export interface CompleteReanalysisInput {
  readonly discernmentCategory: ProfessionalLearningDiscernmentCategory;
  readonly comparisonOutcome: ProfessionalLearningComparisonOutcome;
  readonly comparedSkillId: string | null;
  readonly extraction: ProfessionalLearningExtraction;
  readonly temporalEvidence?: ProfessionalLearningTemporalEvidence | null;
  readonly conflictDetail: DraftConflictDetail | null;
}

// The caller must already hold the claim (status === "REANALYZING") --
// only ever called immediately after claimDraftForReanalysis returned
// true, from the same request. A count !== 1 here would mean something
// else changed the row's status between the claim and this call, which
// this code never does -- a genuine persistence-layer inconsistency.
export async function completeReanalysis(ownerUserId: string, id: string, input: CompleteReanalysisInput): Promise<ProfessionalLearningDraftRecord> {
  return runDraftQuery(async () => {
    const result = await prisma.professionalLearningDraft.updateMany({
      where: { id, ownerUserId, status: "REANALYZING" },
      data: {
        status: "DRAFT",
        discernmentCategory: input.discernmentCategory,
        comparisonOutcome: input.comparisonOutcome,
        comparedSkillId: input.comparedSkillId,
        extraction: input.extraction as object,
        // Prisma requires the explicit Prisma.JsonNull sentinel (not a
        // plain `null`) to SET a nullable Json column to SQL NULL on an
        // update -- `undefined` would instead leave any STALE prior
        // value untouched, which is wrong here: a reanalysis that
        // produces no temporal evidence/conflict this time must clear
        // whatever the PRIOR attempt left behind, never leave it stale.
        temporalEvidence: input.temporalEvidence ? (input.temporalEvidence as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
        conflictDetail: input.conflictDetail ? (input.conflictDetail as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
      },
    });
    if (result.count !== 1) throw new ProfessionalLearningDraftPersistenceError();
    const row = await prisma.professionalLearningDraft.findFirst({ where: { id, ownerUserId } });
    if (!row) throw new ProfessionalLearningDraftPersistenceError();
    return toRecord(row);
  });
}

// Best-effort: releases a claim after a failed reanalysis attempt so the
// draft is never left permanently stuck in REANALYZING just because this
// one attempt failed (fail-honest -- see professional-learning-draft-
// service.ts's own catch block). The prior, still-valid scalar/temporal
// content is left completely untouched -- only `status` reverts.
export async function revertFailedReanalysis(ownerUserId: string, id: string): Promise<void> {
  return runDraftQuery(async () => {
    await prisma.professionalLearningDraft.updateMany({
      where: { id, ownerUserId, status: "REANALYZING" },
      data: { status: "DRAFT" },
    });
  });
}

// Stage 8.5T1.4.b.1 -- PROFESSIONAL PROCEDURAL REVIEW persistence.
//
// APPROVED-ONLY GATE (the T1.4.b architecture audit's own central
// finding): claimDraftForReanalysis above can ONLY ever claim a draft
// whose status is DRAFT/READY_FOR_REVIEW -- an APPROVED row is
// structurally, permanently unreachable by that function. By requiring
// status === "APPROVED" here too, a draft that has ever received a
// procedural review cannot normally have its AI interpretation reanalyzed.
// The explicit review revision below protects Layer 3 changes between sessions.
//
// R1: client-observed revision is the CAS authority. Stale retries always
// conflict. Identical content at the current revision is a no-op. State changes
// atomically match owner, APPROVED lifecycle and expected revision and increment once.
export class ProfessionalLearningProceduralReviewStateError extends Error {
  readonly httpStatus: number;
  constructor(
    readonly code: "DRAFT_NOT_FOUND" | "DRAFT_NOT_APPROVED" | "CONCURRENT_MODIFICATION",
    message: string,
    httpStatus = 409,
  ) {
    super(message);
    this.name = "ProfessionalLearningProceduralReviewStateError";
    this.httpStatus = code === "DRAFT_NOT_FOUND" ? 404 : httpStatus;
  }
}

export interface RecordProceduralClaimReviewInput {
  readonly claimId: string;
  readonly entry: ProceduralClaimReviewEntry;
  readonly expectedProceduralReviewRevision: number;
}

export async function recordProceduralClaimReview(ownerUserId: string, draftId: string, input: RecordProceduralClaimReviewInput): Promise<ProfessionalLearningDraftRecord> {
  return runDraftQuery(async () => {
    if (!isExpectedProceduralReviewRevision(input.expectedProceduralReviewRevision)) {
      throw new ProfessionalLearningProceduralReviewStateError("CONCURRENT_MODIFICATION", "Invalid procedural review revision; refetch the draft.");
    }
    const current = await prisma.professionalLearningDraft.findFirst({ where: { id: draftId, ownerUserId } });
    if (!current) throw new ProfessionalLearningProceduralReviewStateError("DRAFT_NOT_FOUND", "Draft not found.");
    if (current.status !== "APPROVED") {
      throw new ProfessionalLearningProceduralReviewStateError(
        "DRAFT_NOT_APPROVED",
        `Procedural review requires an APPROVED draft; current status is ${current.status}.`,
      );
    }

    const existingState: ProceduralReviewState = current.proceduralReview !== null && isValidProceduralReviewState(current.proceduralReview) ? current.proceduralReview : { claims: {} };
    // Never hide intervening authority changes behind an identical stale retry.
    if (current.proceduralReviewRevision !== input.expectedProceduralReviewRevision) {
      throw new ProfessionalLearningProceduralReviewStateError("CONCURRENT_MODIFICATION", "Procedural review changed; refetch the draft before submitting again.");
    }
    const existingEntry = Object.hasOwn(existingState.claims, input.claimId) ? existingState.claims[input.claimId] : undefined;
    if (existingEntry && isSameProceduralReviewDecision(existingEntry, input.entry)) return toRecord(current);
    const nextState: ProceduralReviewState = { claims: { ...existingState.claims, [input.claimId]: input.entry } };

    const result = await prisma.professionalLearningDraft.updateMany({
      where: { id: draftId, ownerUserId, status: "APPROVED", proceduralReviewRevision: input.expectedProceduralReviewRevision },
      data: { proceduralReview: nextState as unknown as Prisma.InputJsonValue, proceduralReviewRevision: { increment: 1 } },
    });

    if (result.count === 0) {
      throw new ProfessionalLearningProceduralReviewStateError("CONCURRENT_MODIFICATION", "This draft's procedural review changed concurrently; reload and try again.");
    }

    const row = await prisma.professionalLearningDraft.findFirst({ where: { id: draftId, ownerUserId } });
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
