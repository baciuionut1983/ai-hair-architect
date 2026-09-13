import { findLearningEvidenceForOwner } from "@/lib/professional-learning-evidence-repository";
import { checkRelevanceGate } from "@/lib/professional-learning-relevance-gate";
import type { ProfessionalLearningExtractor } from "@/lib/professional-learning-extractor";
import { validateExtractorOutput } from "@/lib/professional-learning-draft-extraction-validator";
import { compareExtractionAgainstRegistry } from "@/lib/professional-learning-draft-comparison";
import { completeApplicableFieldsWithUnknown } from "@/lib/professional-learning-draft-field-completion";
import { applyElevationSemanticGuard } from "@/lib/professional-learning-elevation-semantic-guard";
import { resolveLearningEvidenceImageMedia } from "@/lib/professional-learning-image-media-resolver";
import type { ProfessionalLearningExtractorImageMedia } from "@/lib/professional-learning-extractor";
import {
  createCorrectionDraft,
  createDraft,
  findDraftBySourceEvidenceAndExtractorVersion,
  findDraftForOwner,
  type ProfessionalLearningDraftRecord,
} from "@/lib/professional-learning-draft-repository";
import type { ProfessionalSkillDefinitionRecord } from "@/lib/professional-skill-registry-repository";
import type { ProfessionalLearningExtraction, ProfessionalLearningExtractedField } from "@/lib/professional-learning-draft-validators";

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
  | { readonly kind: "skipped"; readonly reason: string };

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
}

export async function processEvidenceIntoDraft(input: ProcessEvidenceIntoDraftInput): Promise<ProcessEvidenceOutcome> {
  const evidence = await findLearningEvidenceForOwner(input.ownerUserId, input.evidenceId);
  if (!evidence) {
    throw new ProfessionalLearningDraftServiceError("EVIDENCE_NOT_FOUND", 404, "Learning evidence not found.");
  }

  const existing = await findDraftBySourceEvidenceAndExtractorVersion(input.ownerUserId, input.evidenceId, input.extractor.extractorVersion);
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

  const isImageEvidence = evidence.evidenceType === "IMAGE" || evidence.evidenceType === "DIAGRAM";
  // Stage 8.5L4.R2 (Part 8) -- reuses the already-existing, flexible
  // sourceMetadata JSON field, never a new column. Absent/non-string
  // values are treated identically to "no note."
  const professionalNote = typeof evidence.sourceMetadata?.professionalNote === "string" ? evidence.sourceMetadata.professionalNote : null;

  const rawOutput = await input.extractor.extract({
    evidence: { evidenceId: evidence.id, evidenceType: evidence.evidenceType, vertical: evidence.vertical, originalText: evidence.originalText, ...(isImageEvidence ? { professionalNote } : {}) },
    evidenceReferences: { imageAssetId: evidence.imageAssetId, captureSetId: evidence.captureSetId, videoAssetId: evidence.videoAssetId },
    ...(imageMedia ? { imageMedia } : {}),
    relevantRegistry: input.registry,
    ...(input.domainHint ? { domainHint: input.domainHint } : {}),
  });

  const output = validateExtractorOutput({
    output: rawOutput,
    evidenceOriginalText: evidence.originalText,
    // See ValidateExtractorOutputInput's own doc comment: IMAGE/DIAGRAM
    // evidence structurally never has originalText, so a genuine visual
    // OBSERVED claim can never be text-grounded -- this never weakens the
    // check for TEXT/VOICE_TRANSCRIPT evidence, where it stays false.
    skipObservedGrounding: isImageEvidence,
  });

  // Stage 8.5L4.R2.1 -- PROFESSIONAL VISUAL SEMANTIC CLASSIFICATION GUARD
  // (Part 8): runs BEFORE UNKNOWN completion, exactly matching the
  // OBSERVATION -> INTERPRETATION -> VALIDATION -> STRUCTURED CLAIM
  // ordering (Part 6). Scoped to image-shaped evidence only -- TEXT
  // evidence's elevation claims remain governed solely by the existing,
  // stronger text-grounding check (unchanged since L4.R1).
  const semanticallyGuardedExtraction = applyElevationSemanticGuard(output.extraction, isImageEvidence);

  // Stage 8.5L4.R1.1 -- EXPLICIT UNKNOWN NORMALIZATION (Part 4): applied
  // here, after validation and semantic guarding, and before comparison/
  // persistence, so it is authoritative and provider-agnostic regardless
  // of which extractor produced `output` (mock or real). Never overwrites
  // an already-present field; only completes a genuinely applicable
  // field the extractor (or the semantic guard above) was silent about.
  const extraction = completeApplicableFieldsWithUnknown(semanticallyGuardedExtraction, output.discernment.category);

  const comparison = compareExtractionAgainstRegistry(output.discernment.category, output.relatedSkillIdHints, input.registry, evidence.id);

  const draft = await createDraft(input.ownerUserId, input.draftId, {
    sourceEvidenceId: evidence.id,
    extractorVersion: input.extractor.extractorVersion,
    discernmentCategory: output.discernment.category,
    comparisonOutcome: comparison.outcome,
    comparedSkillId: comparison.comparedSkillId,
    extraction,
    conflictDetail: comparison.conflictDetail,
    createdByUserId: input.ownerUserId,
  });

  return { kind: "created", draft };
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
    },
    createdByUserId: input.correctedByUserId,
  });
}
