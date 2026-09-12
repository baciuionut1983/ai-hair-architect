import { isProfessionalLearningDiscernmentCategory, isValidExtraction, type ProfessionalLearningExtraction } from "@/lib/professional-learning-draft-validators";
import type { ProfessionalLearningExtractorOutput } from "@/lib/professional-learning-extractor";

// AI Hair Architect, Professional Skill Engine Stage 8.5L4 -- STRICT
// VALIDATION (Part 21). Every extractor output (mock today, a real/paid
// provider later) passes through here BEFORE anything is persisted. This
// validator is provider-agnostic -- it never assumes the mock extractor's
// own honesty, and would reject the exact same malformed shapes from a
// future real provider.
//
// FAIL CLOSED: a hard rejection (throws ProfessionalLearningExtractionValidationError)
// for shapes that are unambiguously invalid regardless of provider
// (invented enum values, an UNKNOWN field smuggling a value, an
// internally-inconsistent hint, an OBSERVED claim with zero textual
// grounding in the evidence it claims to observe). A softer downgrade
// (comparisonSkillIdHint/relatedSkillIdHints entries that simply don't
// resolve to a real registry skillId) is handled one layer up, in
// professional-learning-draft-comparison.ts, which already treats an
// unresolvable hint identically to "no hint" -- Part 21 explicitly
// allows "reject OR downgrade," and a hint that just doesn't match
// anything yet is the ordinary POSSIBLE_NEW_SKILL case, not a hostile
// fabrication.

export class ProfessionalLearningExtractionValidationError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "ProfessionalLearningExtractionValidationError";
    this.code = code;
  }
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9°]+/)
    .filter((token) => token.length > 2);
}

// A minimal, honest "is this OBSERVED claim actually grounded in the
// evidence text" check (Part 21: "claim OBSERVED without observable
// support"). Not a semantic understanding of the text -- a real
// multimodal provider will eventually replace this with an actual
// grounding proof (e.g. a frame/timestamp reference); for now, a string
// OBSERVED value must share real vocabulary with the evidence it claims
// to observe, or it is rejected as fabricated.
function isTextuallyGrounded(value: string, sourceText: string): boolean {
  const valueTokens = tokenize(value);
  if (valueTokens.length === 0) return true; // nothing concrete enough to check
  const sourceTokens = new Set(tokenize(sourceText));
  const overlapping = valueTokens.filter((token) => sourceTokens.has(token));
  return overlapping.length > 0;
}

export interface ValidateExtractorOutputInput {
  readonly output: ProfessionalLearningExtractorOutput;
  readonly evidenceOriginalText: string | null;
}

// Returns the SAME output object when valid (never mutates it) -- throws
// otherwise. The caller (professional-learning-draft-service.ts) never
// persists an output that has not passed through here.
export function validateExtractorOutput(input: ValidateExtractorOutputInput): ProfessionalLearningExtractorOutput {
  const { output, evidenceOriginalText } = input;

  if (!isProfessionalLearningDiscernmentCategory(output.discernment.category)) {
    throw new ProfessionalLearningExtractionValidationError("INVALID_DISCERNMENT_CATEGORY", `Extractor returned an unrecognized discernment category: ${String(output.discernment.category)}.`);
  }

  if (!isValidExtraction(output.extraction)) {
    throw new ProfessionalLearningExtractionValidationError("INVALID_EXTRACTION_SHAPE", "Extractor returned a structurally invalid extraction payload (unknown field name, invalid provenance source, or an UNKNOWN field carrying a concrete value).");
  }

  // Internal-consistency check: comparisonSkillIdHint must equal the
  // first related hint whenever both are present -- a mismatch here
  // means the extractor's own output contradicts itself, not a
  // legitimate "no match yet" case.
  if (output.comparisonSkillIdHint !== null && output.relatedSkillIdHints.length > 0 && output.relatedSkillIdHints[0] !== output.comparisonSkillIdHint) {
    throw new ProfessionalLearningExtractionValidationError("INCONSISTENT_SKILL_HINTS", "comparisonSkillIdHint does not match relatedSkillIdHints[0] -- internally inconsistent extractor output.");
  }
  if (output.comparisonSkillIdHint === null && output.relatedSkillIdHints.length > 0) {
    throw new ProfessionalLearningExtractionValidationError("INCONSISTENT_SKILL_HINTS", "relatedSkillIdHints is non-empty but comparisonSkillIdHint is null -- internally inconsistent extractor output.");
  }

  assertObservedFieldsAreGrounded(output.extraction, evidenceOriginalText);

  return output;
}

function assertObservedFieldsAreGrounded(extraction: ProfessionalLearningExtraction, evidenceOriginalText: string | null): void {
  for (const [field, entry] of Object.entries(extraction)) {
    if (!entry || entry.source !== "OBSERVED") continue;
    if (typeof entry.value !== "string") continue;
    const sourceText = evidenceOriginalText ?? "";
    if (!isTextuallyGrounded(entry.value, sourceText)) {
      throw new ProfessionalLearningExtractionValidationError(
        "UNGROUNDED_OBSERVATION",
        `Field "${field}" claims OBSERVED but its value shares no vocabulary with the evidence's own text -- an OBSERVED claim must be grounded in what was actually provided, never fabricated.`,
      );
    }
  }
}
