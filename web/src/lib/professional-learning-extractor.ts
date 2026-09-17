import type { ProfessionalSkillDefinitionRecord } from "@/lib/professional-skill-registry-repository";

import type { ProfessionalLearningDiscernmentResult, ProfessionalLearningExtraction } from "@/lib/professional-learning-draft-validators";

// AI Hair Architect, Professional Skill Engine Stage 8.5L4 -- AI ADAPTER
// BOUNDARY (Part 20). A provider-independent interface for future
// multimodal extraction -- the SAME shape a mock/deterministic
// implementation (this stage) and a future real, paid, multimodal
// provider implementation (a later, explicitly-authorized R1) both
// satisfy.
//
// THE PROVIDER NEVER WRITES DIRECTLY TO THE DATABASE. THE PROVIDER NEVER
// CREATES OR UPDATES A ProfessionalSkillDefinition ROW. The provider
// returns an UNTRUSTED proposal; professional-learning-draft-service.ts
// is the only caller, and it always runs the result through
// professional-learning-draft-extraction-validator.ts before anything is
// persisted. This mirrors the exact same "provider returns an untrusted
// payload, the server independently validates it" discipline this
// codebase already uses for every AI-backed proposal (ProfessionalReasoningProposal,
// AnalysisProposal, TechnicalDemonstrationPlan).

export interface ProfessionalLearningExtractorEvidenceMetadata {
  readonly evidenceId: string;
  readonly evidenceType: string;
  readonly vertical: string;
  readonly originalText: string | null;
  // Stage 8.5L4.R2 (Part 8) -- an optional professional caption/note
  // supplied ALONGSIDE image/diagram evidence, kept explicitly SEPARATE
  // from the visual content itself. Read from
  // ProfessionalLearningEvidence.sourceMetadata.professionalNote (an
  // already-existing, flexible JSON field -- no schema change). A
  // real extractor must never relabel this text's own assertions as
  // OBSERVED (that would credit the image with something only the
  // professional's words established), and must never relabel its own
  // reading of the IMAGE as PROFESSIONAL_INPUT merely because a note
  // happens to be attached.
  readonly professionalNote?: string | null;
}

// Stage 8.5L4.R2 -- resolved, ownership-checked, in-memory-only image
// bytes for IMAGE/DIAGRAM evidence. The SERVICE layer
// (professional-learning-draft-service.ts) is the only place this is
// ever populated -- it reads the bytes via the existing, unmodified
// loadValidatedImageBuffer (image-analysis-processing-service.ts, the
// same ownership-scoped, bounded-size, real-byte-validated read every
// other image-consuming feature already uses), strictly AFTER the
// relevance gate has confirmed the evidence is ACTIVE (never REVOKED/
// DELETED_SOURCE) and owned by the caller. This object is transient: it
// exists only for the duration of one extract() call, is never logged,
// never persisted, and never duplicated into the resulting draft (Part
// 12/6 -- the draft only ever stores the evidence's own soft-pointer
// reference, exactly as it always has).
export interface ProfessionalLearningExtractorImageMedia {
  readonly buffer: Buffer;
  readonly mimeType: string;
}

// Stage 8.5L5.R1 -- resolved, ownership-checked, in-memory-only video
// bytes for VIDEO evidence. Same transience/privacy discipline as
// ProfessionalLearningExtractorImageMedia above: exists only for the
// duration of one extract() call, never logged, never persisted, never
// duplicated into the resulting draft.
export interface ProfessionalLearningExtractorVideoMedia {
  readonly buffer: Buffer;
  readonly mimeType: string;
}

export interface ProfessionalLearningExtractorInput {
  readonly evidence: ProfessionalLearningExtractorEvidenceMetadata;
  // Only already-authorized evidence references may ever be passed --
  // an asset ID/pointer, never a URL (Part 6: "Do NOT duplicate source
  // media. Do NOT copy large source content into the draft. Store
  // references/provenance.").
  readonly evidenceReferences: Readonly<Record<string, string | null>>;
  // Present only for IMAGE/DIAGRAM evidence whose referenced ImageAsset
  // was successfully, ownership-checked, resolved -- see type header.
  // Absent for TEXT/VOICE_TRANSCRIPT evidence, and absent (with the
  // extractor expected to answer INSUFFICIENT_EVIDENCE) if resolution
  // was not possible.
  readonly imageMedia?: ProfessionalLearningExtractorImageMedia;
  // Present only for VIDEO evidence whose referenced VideoAsset was
  // successfully, ownership-checked, resolved (Stage 8.5L5.R1).
  readonly videoMedia?: ProfessionalLearningExtractorVideoMedia;
  // A bounded, already-fetched slice of the existing skill registry the
  // extractor may use as context (e.g. to recognize a technique name it
  // already knows) -- the extractor itself never queries the database.
  readonly relevantRegistry: readonly ProfessionalSkillDefinitionRecord[];
  readonly domainHint?: string;
}

export interface ProfessionalLearningExtractorOutput {
  readonly discernment: ProfessionalLearningDiscernmentResult;
  // Absent (or empty) whenever discernment concludes there is nothing to
  // structurally extract (IRRELEVANT / INSUFFICIENT_EVIDENCE) -- Part 7:
  // "Do NOT require every field," extended here to "do not require
  // extraction at all when discernment already says there is none."
  readonly extraction: ProfessionalLearningExtraction;
  // A candidate existing skillId this evidence appears to relate to, if
  // any -- an untrusted HINT the comparison step independently verifies
  // against the real registry, never taken on faith. Equal to
  // `relatedSkillIdHints[0]` whenever that array is non-empty.
  readonly comparisonSkillIdHint: string | null;
  // Every distinct skillId the extractor believes this evidence mentions,
  // in order of first mention -- lets the comparison step detect a rule
  // relating TWO named techniques (Part 13's conflict example: "Slice-
  // and-Slide ... on pure One-Length") without the comparator itself
  // re-parsing free text. Always includes `comparisonSkillIdHint` as its
  // first element when non-empty.
  readonly relatedSkillIdHints: readonly string[];
  // Stage 8.5L5.R1 -- present ONLY for VIDEO evidence. Raw, time-ranged
  // observations in the provider's own literal words (Part 2 of the
  // real-video system instruction: never professional vocabulary here).
  // Untrusted, exactly like `extraction` -- the caller is responsible for
  // running these through professional-learning-video-segmentation.ts/
  // professional-learning-video-temporal-reasoning.ts before treating
  // them as anything more than a raw claim.
  readonly temporalObservations?: readonly { readonly timeStartSeconds: number; readonly timeEndSeconds: number; readonly observation: string }[];
  // Coarse, provider-proposed action groupings (Part 3) -- `kind` is
  // open, provider-chosen text, never validated against a closed
  // vocabulary here (Stage 8.5L5's own "kind is always caller-supplied,
  // this module never classifies it" discipline extends to the provider
  // itself: the provider MAY propose a kind, but nothing downstream
  // treats that proposal as authoritative classification).
  readonly actionCandidates?: readonly { readonly timeStartSeconds: number; readonly timeEndSeconds: number; readonly kind: string }[];
  // Provider-reported apparent video cuts/edits (Part 28) -- always
  // treated as a hint for professional-learning-video-temporal-
  // reasoning.ts's declared-continuity-break mechanism, never as proof.
  readonly notableEditsOrCuts?: readonly { readonly beforeTimeSeconds: number; readonly afterTimeSeconds: number }[];
  // Stage 8.5T1.3.R1 -- present ONLY for VIDEO evidence, and ONLY when the
  // provider's own file-processing pipeline reported it. This is a
  // TRANSCODING-LEVEL fact about the uploaded bytes (analogous to an
  // object store's head() reporting size) -- NEVER the model's own
  // semantic reading of the video, and NEVER a value this app or its
  // caller supplied. Absent whenever the provider did not report it;
  // never estimated or guessed by this interface's implementers.
  readonly sourceVideoDurationSeconds?: number;
}

export interface ProfessionalLearningExtractor {
  readonly extractorVersion: string;
  extract(input: ProfessionalLearningExtractorInput): Promise<ProfessionalLearningExtractorOutput>;
}
