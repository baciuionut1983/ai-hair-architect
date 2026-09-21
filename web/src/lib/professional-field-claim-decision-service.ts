import { Prisma, type ProfessionalFieldClaimDecision, type ProfessionalLearningDraft } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isStructuredProfessionalField, validateProfessionalFieldValue, STRUCTURED_FIELD_SPECIFICATIONS, type StructuredProfessionalField } from "@/lib/structured-professional-field-claims";
import { deriveProfessionalFieldReviewCandidates, OBSERVATION_DIGEST_VERSION, PROFESSIONAL_FIELD_DECISIONS, validateProfessionalFieldDecisionRequest, type ProfessionalFieldStaleReason } from "@/lib/professional-field-review-candidates";
import { getProfessionalFieldSpecification, matchesSpecificationGolden, pinProfessionalFieldSpecification } from "@/lib/professional-field-specification-governance";
import { isProfessionalLearningEvidenceType, isValidEvidenceAssetPointerCombination } from "@/lib/professional-learning-evidence-validators";

type Failure = "DRAFT_NOT_FOUND" | "INVALID_DECISION_REQUEST" | "REVISION_CONFLICT" | ProfessionalFieldStaleReason;
export class ProfessionalFieldClaimDecisionError extends Error {
  readonly httpStatus: 400 | 404 | 409;
  constructor(readonly code: Failure) {
    super(code);
    this.name = "ProfessionalFieldClaimDecisionError";
    this.httpStatus = code === "DRAFT_NOT_FOUND" ? 404 : code === "INVALID_DECISION_REQUEST" ? 400 : 409;
  }
}
function fail(code: Failure): never { throw new ProfessionalFieldClaimDecisionError(code); }
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}
function identity(ownerUserId: string, draftId: unknown, field: unknown): asserts field is StructuredProfessionalField {
  if (!ownerUserId || typeof draftId !== "string" || !draftId.trim() || !isStructuredProfessionalField(field)) fail("INVALID_DECISION_REQUEST");
}
async function ownedDraft(tx: Prisma.TransactionClient, ownerUserId: string, draftId: string) {
  const draft = await tx.professionalLearningDraft.findFirst({ where: { id: draftId, ownerUserId } });
  if (!draft) fail("DRAFT_NOT_FOUND");
  return draft;
}

// Narrow DB-only b.1 gate. T1.5 storage proof and projection remain untouched.
async function lifecycle(tx: Prisma.TransactionClient, draft: ProfessionalLearningDraft): Promise<ProfessionalFieldStaleReason | null> {
  if (draft.supersededByDraftId !== null || draft.status === "SUPERSEDED") return "DRAFT_SUPERSEDED";
  if (draft.status !== "APPROVED") return "DRAFT_NOT_APPROVED";
  const ownerUserId = draft.ownerUserId;
  const evidence = await tx.professionalLearningEvidence.findFirst({ where: { id: draft.sourceEvidenceId, ownerUserId } });
  if (!evidence) return "EVIDENCE_NOT_ACTIVE";
  if (evidence.sourceMediaDeletedAt !== null || evidence.status === "DELETED_SOURCE") return "EVIDENCE_SOURCE_DELETED";
  if (evidence.status !== "ACTIVE" || evidence.revokedAt !== null || evidence.visibilityScope !== "PRIVATE_LEARNING_EVIDENCE"
    || !isProfessionalLearningEvidenceType(evidence.evidenceType) || !isValidEvidenceAssetPointerCombination(evidence.evidenceType, evidence)) return "EVIDENCE_NOT_ACTIVE";
  const clientAlive = async (clientId: string) => Boolean(await tx.client.findFirst({ where: { id: clientId, ownerUserId, deletedAt: null }, select: { id: true } }));
  const imageAlive = async (id: string, clientId?: string) => {
    const image = await tx.imageAsset.findFirst({ where: { id, ownerUserId, ...(clientId ? { clientId } : {}), deletedAt: null, objectDeletedAt: null }, select: { clientId: true } });
    return image !== null && await clientAlive(image.clientId);
  };
  if (evidence.imageAssetId && !await imageAlive(evidence.imageAssetId)) return "EVIDENCE_SOURCE_DELETED";
  if (evidence.videoAssetId) {
    const video = await tx.videoAsset.findFirst({ where: { id: evidence.videoAssetId, ownerUserId, deletedAt: null }, select: { clientId: true } });
    if (!video || !await clientAlive(video.clientId)) return "EVIDENCE_SOURCE_DELETED";
  }
  if (evidence.captureSetId) {
    const set = await tx.captureSet.findFirst({ where: { id: evidence.captureSetId, ownerUserId }, select: { clientId: true, images: { where: { ownerUserId }, select: { imageAssetId: true } } } });
    if (!set || !await clientAlive(set.clientId) || set.images.length === 0) return "EVIDENCE_SOURCE_DELETED";
    for (const image of set.images) if (!await imageAlive(image.imageAssetId, set.clientId)) return "EVIDENCE_SOURCE_DELETED";
  }
  return null;
}

function current(draft: ProfessionalLearningDraft, field: StructuredProfessionalField) {
  const derived = deriveProfessionalFieldReviewCandidates(draft, [field]);
  const candidate = derived.ok ? derived.candidates[0] : undefined;
  // field has passed the runtime guard at both exported boundaries.
  const specification = getProfessionalFieldSpecification(field);
  const pin = pinProfessionalFieldSpecification(specification);
  const outcome = derived.ok ? derived.outcomes[0] : undefined;
  const reason = outcome && outcome.status !== "CANDIDATE" ? outcome.status : "INVALID_OBSERVATION";
  return { candidate, pin, specification, reason, approved: matchesSpecificationGolden(pin) };
}
function decisionStaleReason(latest: ProfessionalFieldClaimDecision, field: StructuredProfessionalField, state: ReturnType<typeof current>): ProfessionalFieldStaleReason | null {
  const { candidate, pin, approved } = state;
  if (!approved || latest.specificationVersion !== pin.specificationVersion || latest.specificationDigest !== pin.specificationDigest) return "SPEC_VERSION_CHANGED";
  if (latest.professionalValue !== null && !validateProfessionalFieldValue(field, latest.professionalValue)) return "VALUE_NOT_IN_CURRENT_SPEC";
  if (!candidate || latest.observationDigestVersion !== OBSERVATION_DIGEST_VERSION || latest.observationDigest !== candidate.observationDigest) return "OBSERVATION_DIGEST_MISMATCH";
  return null;
}
async function transaction<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  try {
    return await prisma.$transaction(work, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2002", "P2034"].includes(error.code)) fail("REVISION_CONFLICT");
    throw error;
  }
}

export type ProfessionalFieldClaimDecisionWriteResult = {
  readonly outcome: "CREATED" | "UNCHANGED";
  readonly httpStatus: 201 | 200;
  readonly decision: ProfessionalFieldClaimDecision;
};

// ownerUserId is authenticated session authority, never part of the request.
// Strict unknown input prevents future routes from forwarding client authority.
export async function submitProfessionalFieldClaimDecision(ownerUserId: string, request: unknown): Promise<ProfessionalFieldClaimDecisionWriteResult> {
  if (!record(request) || Object.keys(request).some(key => !["draftId", "field", "expectedRevision", "observationDigest", "specificationVersion", "specificationDigest", "decision", "correctedValue", "note"].includes(key))) fail("INVALID_DECISION_REQUEST");
  const { draftId, field, expectedRevision } = request;
  identity(ownerUserId, draftId, field);
  if (!Number.isSafeInteger(expectedRevision) || (expectedRevision as number) < 0 || (expectedRevision as number) >= 2147483647) fail("INVALID_DECISION_REQUEST");
  return transaction(async tx => {
    const draft = await ownedDraft(tx, ownerUserId, draftId as string);
    const reason = await lifecycle(tx, draft);
    if (reason) fail(reason);
    const { candidate, pin, approved } = current(draft, field);
    if (!approved || request.specificationVersion !== pin.specificationVersion || request.specificationDigest !== pin.specificationDigest) fail("SPEC_VERSION_CHANGED");
    if (!candidate || request.observationDigest !== candidate.observationDigest) fail("OBSERVATION_DIGEST_MISMATCH");
    const latest = await tx.professionalFieldClaimDecision.findFirst({ where: { ownerUserId, draftId: draft.id, field }, orderBy: { revision: "desc" } });
    // R1: revision comparison MUST precede even an identical-current no-op.
    if (expectedRevision !== (latest?.revision ?? 0)) fail("REVISION_CONFLICT");
    const validation = validateProfessionalFieldDecisionRequest(candidate, {
      candidateId: candidate.id, field, draftId: draft.id, sourceEvidenceId: draft.sourceEvidenceId, extractorVersion: draft.extractorVersion,
      specificationVersion: pin.specificationVersion, observationDigest: candidate.observationDigest, decision: request.decision,
      ...(Object.hasOwn(request, "correctedValue") ? { correctedValue: request.correctedValue } : {}),
      ...(Object.hasOwn(request, "note") ? { note: request.note } : {}),
    });
    if (!validation.ok) fail("INVALID_DECISION_REQUEST");
    const validated = validation.request;
    const semantic = {
      decision: validated.decision,
      professionalValue: validated.decision === "CONFIRMED" ? candidate.normalizedValue : validated.decision === "CORRECTED" ? validated.correctedValue : null,
      candidateResolution: candidate.resolution, observationDigest: candidate.observationDigest, observationDigestVersion: OBSERVATION_DIGEST_VERSION,
      specificationVersion: pin.specificationVersion, specificationDigest: pin.specificationDigest,
      note: validated.note ?? null, reviewedByUserId: ownerUserId,
    };
    if (latest && Object.entries(semantic).every(([key, value]) => latest[key as keyof typeof semantic] === value)) return { outcome: "UNCHANGED", httpStatus: 200, decision: latest };
    const decision = await tx.professionalFieldClaimDecision.create({ data: { ownerUserId, draftId: draft.id, field, revision: (latest?.revision ?? 0) + 1, ...semantic } });
    return { outcome: "CREATED", httpStatus: 201, decision };
  });
}

export interface ProfessionalFieldClaimDecisionState {
  readonly latest: ProfessionalFieldClaimDecision | null;
  readonly staleReason: ProfessionalFieldStaleReason | null;
  readonly history: readonly ProfessionalFieldClaimDecision[];
}
export async function readProfessionalFieldClaimDecisions(ownerUserId: string, draftId: string, field: unknown): Promise<ProfessionalFieldClaimDecisionState> {
  identity(ownerUserId, draftId, field);
  return transaction(async tx => {
    const draft = await ownedDraft(tx, ownerUserId, draftId);
    const history = await tx.professionalFieldClaimDecision.findMany({ where: { ownerUserId, draftId, field }, orderBy: { revision: "asc" } });
    const latest = history.at(-1) ?? null;
    let staleReason = await lifecycle(tx, draft);
    if (latest && !staleReason) {
      staleReason = decisionStaleReason(latest, field, current(draft, field));
    }
    // Never search historical revisions for a substitute current decision.
    return { latest, staleReason, history };
  });
}

export const PROFESSIONAL_FIELD_DECISION_FIELDS = Object.freeze(Object.keys(STRUCTURED_FIELD_SPECIFICATIONS));

// Explicit allowlist shared by GET and POST: no row/owner/reviewer IDs or row digests.
export function toProfessionalFieldDecisionDto(row: ProfessionalFieldClaimDecision) {
  return { field: row.field, revision: row.revision, decision: row.decision,
    professionalValue: row.professionalValue, note: row.note, createdAt: row.createdAt.toISOString() };
}

// Server-only aggregate adapter for b.2. No I/O outside this single snapshot;
// historical rows never substitute for the newest row, even when it is stale.
export async function readProfessionalFieldDecisionReview(ownerUserId: string, draftId: string) {
  return transaction(async tx => {
    const draft = await ownedDraft(tx, ownerUserId, draftId);
    const blockedBy = await lifecycle(tx, draft);
    const fields = [];
    for (const field of PROFESSIONAL_FIELD_DECISION_FIELDS) {
      identity(ownerUserId, draftId, field);
      const state = current(draft, field);
      const { candidate, pin, specification, approved } = state;
      const rows = await tx.professionalFieldClaimDecision.findMany({ where: { ownerUserId, draftId, field }, orderBy: { revision: "desc" }, take: 11 });
      const latest = rows[0] ?? null;
      const staleReason = latest ? blockedBy ?? decisionStaleReason(latest, field, state) : null;
      const blockedReason = blockedBy ?? (!approved ? "SPEC_VERSION_CHANGED" : !candidate ? state.reason : null);
      // Probe the existing validator, including whether ANY governed correction
      // is valid. No independent decision matrix or canonical vocabulary.
      const allowedDecisions = candidate ? PROFESSIONAL_FIELD_DECISIONS.filter(decision => {
        const base = { candidateId: candidate.id, field, draftId, sourceEvidenceId: draft.sourceEvidenceId,
          extractorVersion: draft.extractorVersion, specificationVersion: pin.specificationVersion,
          observationDigest: candidate.observationDigest, decision };
        return decision === "CORRECTED"
          ? specification.allowedValues.some(correctedValue => validateProfessionalFieldDecisionRequest(candidate, { ...base, correctedValue }).ok)
          : validateProfessionalFieldDecisionRequest(candidate, base).ok;
      }) : [];
      fields.push({ field,
        review: candidate ? { reviewable: true as const, candidate: {
          resolution: candidate.resolution, normalizedValue: candidate.normalizedValue, observation: candidate.original,
          provenance: { sourceEvidenceId: draft.sourceEvidenceId, extractorVersion: draft.extractorVersion },
          pins: { observationDigest: candidate.observationDigest, observationDigestVersion: OBSERVATION_DIGEST_VERSION,
            specificationVersion: pin.specificationVersion, specificationDigest: pin.specificationDigest },
        } } : { reviewable: false as const, reason: state.reason },
        specification: { version: pin.specificationVersion, digest: pin.specificationDigest, allowedValues: specification.allowedValues },
        latestRevision: latest?.revision ?? 0, authority: !latest ? "NONE" as const : staleReason ? "STALE" as const : "CURRENT" as const,
        latest: latest ? toProfessionalFieldDecisionDto(latest) : null, staleReason,
        actions: { canSubmit: blockedReason === null, ...(blockedReason ? { blockedReason } : {}), allowedDecisions },
        history: rows.slice(0, 10).map(toProfessionalFieldDecisionDto), historyTruncated: rows.length > 10,
      });
    }
    return { draftId, lifecycle: { open: blockedBy === null, blockedBy }, fields };
  });
}
