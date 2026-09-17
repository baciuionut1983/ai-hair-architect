import { findLearningEvidenceForOwner, type ProfessionalLearningEvidenceRecord } from "@/lib/professional-learning-evidence-repository";
import { checkRelevanceGate } from "@/lib/professional-learning-relevance-gate";
import type { ProfessionalLearningExtractor } from "@/lib/professional-learning-extractor";
import { validateExtractorOutput } from "@/lib/professional-learning-draft-extraction-validator";
import { compareExtractionAgainstRegistry } from "@/lib/professional-learning-draft-comparison";
import { completeApplicableFieldsWithUnknown } from "@/lib/professional-learning-draft-field-completion";
import { applySemanticBindingGuard } from "@/lib/professional-learning-semantic-binding-guard";
import { resolveLearningEvidenceImageMedia } from "@/lib/professional-learning-image-media-resolver";
import { resolveLearningEvidenceVideoMedia } from "@/lib/professional-learning-video-media-resolver";
import { buildProfessionalLearningTemporalEvidence } from "@/lib/professional-learning-video-temporal-evidence";
import type { ProfessionalLearningExtractorImageMedia, ProfessionalLearningExtractorVideoMedia } from "@/lib/professional-learning-extractor";
import {
  claimDraftForReanalysis,
  completeReanalysis,
  createCorrectionDraft,
  createDraft,
  findDraftBySourceEvidenceAndExtractorVersion,
  findDraftForOwner,
  revertFailedReanalysis,
  type ProfessionalLearningDraftRecord,
} from "@/lib/professional-learning-draft-repository";
import type { ProfessionalSkillDefinitionRecord } from "@/lib/professional-skill-registry-repository";
import type {
  ProfessionalLearningComparisonOutcome,
  ProfessionalLearningDiscernmentCategory,
  ProfessionalLearningExtraction,
  ProfessionalLearningExtractedField,
} from "@/lib/professional-learning-draft-validators";
import type { DraftConflictDetail } from "@/lib/professional-learning-draft-comparison";
import type { ProfessionalLearningTemporalEvidence } from "@/lib/professional-learning-video-temporal-evidence";
import { createReferenceDependencyRelationship, type ReferenceDependencyRelationship, type ReferenceDependencyRelationshipType, type ReferenceEntityRef, type ReferenceRoleKind } from "@/lib/professional-learning-reference-dependency";
import { computeReviewedComparison } from "@/lib/professional-learning-reviewed-comparison";

// AI Hair Architect, Professional Skill Engine Stage 8.5L4 -- the
// orchestration layer connecting evidence -> relevance gate -> extractor
// (mock today) -> strict validation -> compare-before-create -> durable
// draft. Mirrors professional-brain-orchestrator.ts's own "thin
// connective layer, no domain logic of its own" discipline: every real
// decision lives in the module it delegates to (the gate, the extractor,
// the validator, the comparator, the repository).
//
// THIS FILE NEVER TOUCHES ProfessionalSkillDefinition (Part 4/12/28): the
// registry it reads is a plain, already-built, read-only snapshot passed
// in by the caller (the same `buildCanonicalCandidateSkillRegistry()`
// every other Professional Brain stage already reads) -- nothing here
// creates, updates, or activates a skill row, regardless of
// comparisonOutcome.

export class ProfessionalLearningDraftServiceError extends Error {
  readonly code: string;
  readonly httpStatus: number;
  constructor(code: string, httpStatus: number, message: string) {
    super(message);
    this.name = "ProfessionalLearningDraftServiceError";
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

export type ProcessEvidenceOutcome =
  | { readonly kind: "created"; readonly draft: ProfessionalLearningDraftRecord }
  | { readonly kind: "already_processed"; readonly draft: ProfessionalLearningDraftRecord }
  | { readonly kind: "reanalyzed"; readonly draft: ProfessionalLearningDraftRecord }
  | { readonly kind: "skipped"; readonly reason: string };

// Stage 8.5T1.2.R1 -- explicit reanalysis intent (Part "primary product
// semantic"). ANALYZE is the existing, unchanged default: idempotent,
// reuses an existing draft for the same (evidence, extractorVersion)
// pair rather than re-invoking the provider. REANALYZE is a deliberate
// professional action -- it must reach the extractor exactly once, even
// though nothing about the evidence or the extractor's own model
// changed. Never inferred from anything other than an explicit request
// value; the route never defaults to REANALYZE.
export type ProcessEvidenceMode = "ANALYZE" | "REANALYZE";

export interface ProcessEvidenceIntoDraftInput {
  readonly ownerUserId: string;
  readonly evidenceId: string;
  readonly draftId: string;
  readonly extractor: ProfessionalLearningExtractor;
  readonly registry: readonly ProfessionalSkillDefinitionRecord[];
  // Stage 8.5L4.R2 (Part 6) -- an optional, minimal, generic hint (e.g.
  // "HAIR / CUTTING"), never a description of what the evidence
  // supposedly shows. Passed through to the extractor verbatim.
  readonly domainHint?: string;
  // Defaults to "ANALYZE" -- every existing caller that never passes
  // this field keeps its exact current behavior.
  readonly mode?: ProcessEvidenceMode;
}

interface BuiltExtractionResult {
  readonly discernmentCategory: ProfessionalLearningDiscernmentCategory;
  readonly comparisonOutcome: ProfessionalLearningComparisonOutcome;
  readonly comparedSkillId: string | null;
  readonly extraction: ProfessionalLearningExtraction;
  readonly temporalEvidence: ProfessionalLearningTemporalEvidence | null;
  readonly conflictDetail: DraftConflictDetail | null;
}

// The ONE place that resolves media, invokes the extractor, validates,
// guards, completes UNKNOWNs, compares against the registry, and builds
// T1.2 temporal evidence -- shared verbatim between the initial-create
// path and the explicit-reanalysis path below (Part "one extractor, one
// normalization path, one draft persistence model" -- reanalysis is
// never a second, competing implementation of this logic).
async function buildExtractionResult(input: ProcessEvidenceIntoDraftInput, evidence: ProfessionalLearningEvidenceRecord): Promise<BuiltExtractionResult> {
  // Stage 8.5L4.R2 -- PRIVATE IMAGE MEDIA RESOLUTION (Part 9/11): resolved
  // HERE, strictly after the relevance gate has already confirmed the
  // evidence is ACTIVE (never REVOKED/DELETED_SOURCE) and owned by this
  // exact caller -- a revoked or foreign evidence row never reaches media
  // resolution, and therefore never reaches the provider, regardless of
  // evidenceType. Only IMAGE/DIAGRAM evidence (the two types that carry
  // an imageAssetId pointer) attempt resolution; IMAGE_SET/VIDEO
  // multimodal extraction is explicitly out of scope for this stage (Part
  // 43) and TEXT/VOICE_TRANSCRIPT never had a pointer to resolve.
  let imageMedia: ProfessionalLearningExtractorImageMedia | undefined;
  if ((evidence.evidenceType === "IMAGE" || evidence.evidenceType === "DIAGRAM") && evidence.imageAssetId) {
    const resolved = await resolveLearningEvidenceImageMedia(input.ownerUserId, evidence.imageAssetId);
    if (resolved.status === "unavailable") {
      throw new ProfessionalLearningDraftServiceError("IMAGE_MEDIA_UNAVAILABLE", 502, `Could not read the authorized image evidence (${resolved.reason}).`);
    }
    imageMedia = resolved.media;
  }

  // Stage 8.5L5.R1 -- PRIVATE VIDEO MEDIA RESOLUTION, same placement/
  // discipline as the IMAGE branch above: after the relevance gate has
  // already confirmed ACTIVE + owned, before the provider is ever called.
  let videoMedia: ProfessionalLearningExtractorVideoMedia | undefined;
  if (evidence.evidenceType === "VIDEO" && evidence.videoAssetId) {
    const resolved = await resolveLearningEvidenceVideoMedia(input.ownerUserId, evidence.videoAssetId);
    if (resolved.status === "unavailable") {
      throw new ProfessionalLearningDraftServiceError("VIDEO_MEDIA_UNAVAILABLE", 502, `Could not read the authorized video evidence (${resolved.reason}).`);
    }
    videoMedia = resolved.media;
  }

  const isImageEvidence = evidence.evidenceType === "IMAGE" || evidence.evidenceType === "DIAGRAM";
  // Stage 8.5L5.R1 -- VIDEO evidence structurally never has originalText
  // either (same reasoning as IMAGE/DIAGRAM), so it needs the exact same
  // coarser visual grounding/semantic-binding treatment as IMAGE, for the
  // exact same reason: no text to token-overlap-check against. This is
  // computed once, locally, at this call site -- it does NOT rename or
  // widen professional-learning-semantic-binding-guard.ts's own
  // `isImageEvidence` parameter (Section 4/60: preserve R2.2 unmodified).
  const isVisualEvidence = isImageEvidence || evidence.evidenceType === "VIDEO";
  // Stage 8.5L4.R2 (Part 8) -- reuses the already-existing, flexible
  // sourceMetadata JSON field, never a new column. Absent/non-string
  // values are treated identically to "no note."
  const professionalNote = typeof evidence.sourceMetadata?.professionalNote === "string" ? evidence.sourceMetadata.professionalNote : null;

  const rawOutput = await input.extractor.extract({
    evidence: { evidenceId: evidence.id, evidenceType: evidence.evidenceType, vertical: evidence.vertical, originalText: evidence.originalText, ...(isVisualEvidence ? { professionalNote } : {}) },
    evidenceReferences: { imageAssetId: evidence.imageAssetId, captureSetId: evidence.captureSetId, videoAssetId: evidence.videoAssetId },
    ...(imageMedia ? { imageMedia } : {}),
    ...(videoMedia ? { videoMedia } : {}),
    relevantRegistry: input.registry,
    ...(input.domainHint ? { domainHint: input.domainHint } : {}),
  });

  const output = validateExtractorOutput({
    output: rawOutput,
    evidenceOriginalText: evidence.originalText,
    // See ValidateExtractorOutputInput's own doc comment: IMAGE/DIAGRAM/
    // VIDEO evidence structurally never has originalText, so a genuine
    // visual/temporal OBSERVED claim can never be text-grounded -- this
    // never weakens the check for TEXT/VOICE_TRANSCRIPT evidence, where it
    // stays false.
    skipObservedGrounding: isVisualEvidence,
  });

  // Stage 8.5L4.R2.2 -- GENERAL PROFESSIONAL SEMANTIC BINDING GUARD (Part
  // 6/8): runs BEFORE UNKNOWN completion, exactly matching the
  // OBSERVATION -> INTERPRETATION -> VALIDATION -> STRUCTURED CLAIM
  // ordering (Part 6). Scoped to image-shaped evidence only -- TEXT
  // evidence's claims (e.g. One-Length's own "no elevation") remain
  // governed solely by the existing, stronger text-grounding check
  // (unchanged since L4.R1). Generalizes R2.1's elevation-only guard to a
  // small table of GEOMETRY/DIRECTION/STRUCTURE fields genuinely at risk
  // of visual field-choice misclassification.
  const semanticallyGuardedExtraction = applySemanticBindingGuard(output.extraction, isVisualEvidence);

  // Stage 8.5L4.R1.1 -- EXPLICIT UNKNOWN NORMALIZATION (Part 4): applied
  // here, after validation and semantic guarding, and before comparison/
  // persistence, so it is authoritative and provider-agnostic regardless
  // of which extractor produced `output` (mock or real). Never overwrites
  // an already-present field; only completes a genuinely applicable
  // field the extractor (or the semantic guard above) was silent about.
  const extraction = completeApplicableFieldsWithUnknown(semanticallyGuardedExtraction, output.discernment.category);

  const comparison = compareExtractionAgainstRegistry(output.discernment.category, output.relatedSkillIdHints, input.registry, evidence.id);

  // Stage 8.5T1.2 -- STOP DISCARDING TEMPORAL EVIDENCE. `output` already
  // carries temporalObservations/actionCandidates/notableEditsOrCuts for
  // VIDEO evidence (the real Gemini adapter already returns them, under
  // the existing, unmodified prompt/schema) -- until this stage, nothing
  // past this point ever read them. This is a separate, additional
  // evidence layer, never flattened into `extraction` above.
  const temporalEvidence = buildProfessionalLearningTemporalEvidence(output);

  return {
    discernmentCategory: output.discernment.category,
    comparisonOutcome: comparison.outcome,
    comparedSkillId: comparison.comparedSkillId,
    extraction,
    temporalEvidence,
    conflictDetail: comparison.conflictDetail,
  };
}

export async function processEvidenceIntoDraft(input: ProcessEvidenceIntoDraftInput): Promise<ProcessEvidenceOutcome> {
  const evidence = await findLearningEvidenceForOwner(input.ownerUserId, input.evidenceId);
  if (!evidence) {
    throw new ProfessionalLearningDraftServiceError("EVIDENCE_NOT_FOUND", 404, "Learning evidence not found.");
  }

  const mode: ProcessEvidenceMode = input.mode === "REANALYZE" ? "REANALYZE" : "ANALYZE";
  const existing = await findDraftBySourceEvidenceAndExtractorVersion(input.ownerUserId, input.evidenceId, input.extractor.extractorVersion);

  // Stage 8.5T1.2.R1 -- EXPLICIT REANALYSIS. Only taken when the caller
  // deliberately asked for it AND a draft already exists to reanalyze --
  // REANALYZE with no existing draft is indistinguishable from a first
  // analysis and falls through to the unchanged path below. The relevance
  // gate below is still consulted (evidence must still be ACTIVE/non-
  // empty) -- only its ALREADY_PROCESSED signal is deliberately bypassed,
  // which is the ENTIRE point of this mode.
  if (mode === "REANALYZE" && existing) {
    const gate = checkRelevanceGate({ status: evidence.status, evidenceType: evidence.evidenceType, originalText: evidence.originalText }, false);
    if (!gate.proceed) {
      return { kind: "skipped", reason: gate.reason };
    }

    const claimed = await claimDraftForReanalysis(input.ownerUserId, existing.id);
    if (!claimed) {
      const fresh = await findDraftForOwner(input.ownerUserId, existing.id);
      if (fresh?.status === "REANALYZING") {
        throw new ProfessionalLearningDraftServiceError("DRAFT_REANALYSIS_IN_PROGRESS", 409, "A reanalysis of this evidence is already in progress. Try again shortly.");
      }
      // Already past professional review (APPROVED/REJECTED/SUPERSEDED),
      // or the row no longer exists -- either way, never silently
      // rewritten by an in-place reanalysis.
      throw new ProfessionalLearningDraftServiceError("DRAFT_NOT_REANALYZABLE", 409, "This draft has already been professionally reviewed and cannot be reanalyzed in place.");
    }

    try {
      const built = await buildExtractionResult(input, evidence);
      const draft = await completeReanalysis(input.ownerUserId, existing.id, built);
      return { kind: "reanalyzed", draft };
    } catch (error) {
      // Fail-honest (T1.1 Issue #1): a failed reanalysis attempt must
      // never leave the draft stuck, and must never be hidden behind the
      // still-valid prior content -- the caller's own catch block (route
      // handler) reports this error exactly like any other extraction
      // failure; the prior scalar/temporal content is left untouched.
      await revertFailedReanalysis(input.ownerUserId, existing.id).catch(() => undefined);
      throw error;
    }
  }

  const gate = checkRelevanceGate(
    { status: evidence.status, evidenceType: evidence.evidenceType, originalText: evidence.originalText },
    existing !== null,
  );

  if (!gate.proceed) {
    if (gate.reason === "ALREADY_PROCESSED" && existing) {
      return { kind: "already_processed", draft: existing };
    }
    return { kind: "skipped", reason: gate.reason };
  }

  const built = await buildExtractionResult(input, evidence);

  const draft = await createDraft(input.ownerUserId, input.draftId, {
    sourceEvidenceId: evidence.id,
    extractorVersion: input.extractor.extractorVersion,
    ...built,
    createdByUserId: input.ownerUserId,
  });

  return { kind: "created", draft };
}

// Stage 8.5L5.R1.1 -- what a professional's review supplies for ONE
// reference-dependency relationship. Deliberately NO `provenance` or
// `semanticSupport` field: this input shape only ever reaches
// submitProfessionalCorrection, which is itself the professional-
// authority pathway -- provenance is unconditionally forced to
// PROFESSIONAL_INPUT below, exactly mirroring how `correctedFields`
// above already forces PROFESSIONAL_INPUT regardless of caller input.
export interface SubmitCorrectionReferenceDependencyInput {
  readonly sourceEntity: ReferenceEntityRef;
  readonly targetEntity: ReferenceEntityRef;
  readonly relationshipType: ReferenceDependencyRelationshipType;
  readonly referenceRole?: ReferenceRoleKind;
  readonly note?: string;
}

export interface SubmitProfessionalCorrectionInput {
  readonly ownerUserId: string;
  readonly priorDraftId: string;
  readonly correctionEvidenceId: string;
  readonly newDraftId: string;
  // Only the field(s) the professional is correcting -- every other field
  // from the prior draft's own extraction is preserved unchanged
  // alongside the correction (no wholesale rewrite of the interpretation,
  // only the specific correction).
  readonly correctedFields: Readonly<Record<string, { readonly value: unknown; readonly previousValue: unknown }>>;
  readonly correctedByUserId: string;
  // Stage 8.5L5.R1.1 -- optional professional guide/reference relationships
  // (Section 7/11/14). Omitted entirely for a correction that only
  // touches scalar fields, exactly like before this stage.
  readonly referenceDependencies?: readonly SubmitCorrectionReferenceDependencyInput[];
  // Stage 8.5L5.R1.1 (Section 21/29) -- optional; when supplied, triggers
  // a SEPARATE, additional "what does the evidence support now" registry
  // comparison, stored in correctionNote.reviewedComparison only -- never
  // written to this row's own comparisonOutcome/comparedSkillId columns,
  // and never mutating the registry itself (computeReviewedComparison is
  // a pure function; this service never writes to
  // ProfessionalSkillDefinition). Omitted entirely, existing callers
  // (the /learning-drafts/[draftId]/correct route) are completely
  // unaffected.
  readonly registry?: readonly ProfessionalSkillDefinitionRecord[];
}

// Professional correction (Part 15): an explicit, professional-initiated
// action -- NOT something this mock stage's extractor infers from free
// text (a real correction is a deliberate override, distinguishable from
// AI inference by construction, not by guessing at phrasing like "no,
// actually..."). Preserves the prior draft's extraction fields that were
// NOT corrected; every corrected field is stamped source=PROFESSIONAL_INPUT
// with the highest authority this stage recognizes. No destructive
// rewrite: the prior draft transitions to SUPERSEDED, its own row and
// extraction remain exactly as they were.
export async function submitProfessionalCorrection(input: SubmitProfessionalCorrectionInput): Promise<ProfessionalLearningDraftRecord> {
  const prior = await findDraftForOwner(input.ownerUserId, input.priorDraftId);
  if (!prior) {
    throw new ProfessionalLearningDraftServiceError("DRAFT_NOT_FOUND", 404, "The draft being corrected was not found.");
  }

  const correctedFieldNames = Object.keys(input.correctedFields);
  if (correctedFieldNames.length === 0) {
    throw new ProfessionalLearningDraftServiceError("NO_CORRECTED_FIELDS", 400, "At least one corrected field is required.");
  }

  const mergedExtraction: Record<string, ProfessionalLearningExtractedField> = { ...(prior.extraction as Record<string, ProfessionalLearningExtractedField>) };
  for (const fieldName of correctedFieldNames) {
    const correction = input.correctedFields[fieldName];
    mergedExtraction[fieldName] = { value: correction.value, source: "PROFESSIONAL_INPUT", confidence: 1 };
  }

  // Stage 8.5L5.R1.1 (Section 11) -- every relationship reaching this
  // service is unconditionally stamped PROFESSIONAL_INPUT, exactly like
  // corrected scalar fields above; the caller has no way to request any
  // other provenance through this pathway.
  const referenceDependencies: readonly ReferenceDependencyRelationship[] = (input.referenceDependencies ?? []).map((relationship) =>
    createReferenceDependencyRelationship({ ...relationship, provenance: "PROFESSIONAL_INPUT" }),
  );

  // Section 20/21/29 -- a SEPARATE, additional comparison; never
  // overwrites the prior draft's own comparisonOutcome/comparedSkillId,
  // and createCorrectionDraft below still hardcodes this new row's own
  // comparisonOutcome to "POSSIBLE_CORRECTION" exactly as it always has.
  const reviewedComparison = input.registry ? computeReviewedComparison(mergedExtraction as ProfessionalLearningExtraction, prior.comparisonOutcome, referenceDependencies, input.registry) : undefined;

  return createCorrectionDraft(input.ownerUserId, input.newDraftId, {
    priorDraftId: input.priorDraftId,
    correctionEvidenceId: input.correctionEvidenceId,
    extractorVersion: prior.extractorVersion,
    extraction: mergedExtraction as ProfessionalLearningExtraction,
    correctionNote: {
      previousInterpretation: Object.fromEntries(correctedFieldNames.map((name) => [name, input.correctedFields[name].previousValue])),
      correction: Object.fromEntries(correctedFieldNames.map((name) => [name, input.correctedFields[name].value])),
      correctedByUserId: input.correctedByUserId,
      correctedAt: new Date().toISOString(),
      ...(referenceDependencies.length > 0 ? { referenceDependencies } : {}),
      ...(reviewedComparison ? { reviewedComparison } : {}),
    },
    createdByUserId: input.correctedByUserId,
  });
}
