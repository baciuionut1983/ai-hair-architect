import { Prisma, type ProfessionalFieldClaimDecision, type ProfessionalLearningDraft } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isStructuredProfessionalField, validateProfessionalFieldValue, type StructuredProfessionalField } from "@/lib/structured-professional-field-claims";
import { deriveProfessionalFieldReviewCandidates, OBSERVATION_DIGEST_VERSION, validateProfessionalFieldDecisionRequest, type ProfessionalFieldStaleReason } from "@/lib/professional-field-review-candidates";
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
  const pin = pinProfessionalFieldSpecification(getProfessionalFieldSpecification(field));
  return { candidate, pin, approved: matchesSpecificationGolden(pin) };
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
      const { candidate, pin, approved } = current(draft, field);
      if (!approved || latest.specificationVersion !== pin.specificationVersion || latest.specificationDigest !== pin.specificationDigest) staleReason = "SPEC_VERSION_CHANGED";
      else if (latest.professionalValue !== null && !validateProfessionalFieldValue(field, latest.professionalValue)) staleReason = "VALUE_NOT_IN_CURRENT_SPEC";
      else if (!candidate || latest.observationDigestVersion !== OBSERVATION_DIGEST_VERSION || latest.observationDigest !== candidate.observationDigest) staleReason = "OBSERVATION_DIGEST_MISMATCH";
    }
    // Never search historical revisions for a substitute current decision.
    return { latest, staleReason, history };
  });
}
