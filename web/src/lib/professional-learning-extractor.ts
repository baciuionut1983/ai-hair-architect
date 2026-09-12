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
}

export interface ProfessionalLearningExtractorInput {
  readonly evidence: ProfessionalLearningExtractorEvidenceMetadata;
  // Only already-authorized evidence references may ever be passed --
  // never a raw asset URL/bytes (Part 6: "Do NOT duplicate source media.
  // Do NOT copy large source content into the draft. Store
  // references/provenance.").
  readonly evidenceReferences: Readonly<Record<string, string | null>>;
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
}

export interface ProfessionalLearningExtractor {
  readonly extractorVersion: string;
  extract(input: ProfessionalLearningExtractorInput): Promise<ProfessionalLearningExtractorOutput>;
}
