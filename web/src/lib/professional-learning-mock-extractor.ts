import type {
  ProfessionalLearningExtractedField,
  ProfessionalLearningExtractionFieldName,
} from "@/lib/professional-learning-draft-validators";
import type {
  ProfessionalLearningExtractor,
  ProfessionalLearningExtractorInput,
  ProfessionalLearningExtractorOutput,
} from "@/lib/professional-learning-extractor";

// AI Hair Architect, Professional Skill Engine Stage 8.5L4 -- MOCK/
// DETERMINISTIC EXTRACTOR (Part 30). ZERO Gemini/OpenAI/Claude/Vision/
// Veo/online-research calls anywhere in this file -- deliberately a
// simple, transparent, keyword/phrase-based placeholder that satisfies
// the SAME ProfessionalLearningExtractor interface a future real,
// multimodal, paid provider implementation will satisfy. This lets the
// data model, provenance handling, comparison logic, conflict detection,
// and review boundary all be proven end-to-end BEFORE any real AI
// extraction is authorized (a later, explicit L4.R1).
//
// This file only ever runs on TEXT-shaped evidence (evidence.originalText)
// -- image/video/diagram discernment is a real multimodal capability this
// mock deliberately does not attempt to fake; such evidence types short-
// circuit to INSUFFICIENT_EVIDENCE with an honest note, never a guessed
// analysis.
//
// The MOCK_SKILL_NAME_ALIASES table below is intentionally hand-authored
// and approximate (a real extractor would recognize a technique from
// pixels/audio, not a fixed alias list) -- it only ever produces an
// untrusted HINT. professional-learning-draft-comparison.ts independently
// re-verifies every hint against the real, live skill registry before any
// comparison outcome is decided; a stale or wrong alias here can suggest
// a hint, never silently become a fact.

export const MOCK_EXTRACTOR_VERSION = "mock-deterministic-v1";

const MOCK_SKILL_NAME_ALIASES: readonly { readonly pattern: RegExp; readonly skillId: string }[] = [
  { pattern: /\bone[- ]length\b/i, skillId: "skill-cutting-one-length-perimeter" },
  { pattern: /\bslice[- ]and[- ]slide\b/i, skillId: "skill-cutting-slice-and-slide-refinement" },
  { pattern: /\bgraduated cutting\b|\bgraduation\b/i, skillId: "skill-cutting-graduated" },
];

// Ordered so the FIRST match in the text is treated as the primary
// technique candidate; any further distinct matches are "other mentioned
// skills" -- exactly what a conflict check (Part 13) needs to compare the
// primary candidate's own declared incompatibilities against.
function findMentionedSkillIds(text: string): string[] {
  const matches: { skillId: string; index: number }[] = [];
  for (const alias of MOCK_SKILL_NAME_ALIASES) {
    const match = alias.pattern.exec(text);
    if (match) matches.push({ skillId: alias.skillId, index: match.index });
  }
  matches.sort((a, b) => a.index - b.index);
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const m of matches) {
    if (!seen.has(m.skillId)) {
      seen.add(m.skillId);
      ordered.push(m.skillId);
    }
  }
  return ordered;
}

// A minimal, honest list of "this text describes a real professional
// procedure" markers -- present so "make the haircut softer" (no
// geometry, no technique, no observable procedure) is correctly
// recognized as carrying zero procedural content, rather than the mock
// extractor inventing structure that was never there (this stage's
// absolute rule: the AI must not fill missing information merely to
// produce a complete-looking draft).
const PROCEDURAL_MARKERS: readonly RegExp[] = [
  /\bposterior\b/i,
  /\bhorizontal parting/i,
  /\bnatural fall\b/i,
  /\bno elevation\b/i,
  /\b\d+\s*(degree|°)/i,
  /\bstrand by strand\b/i,
  /\bprevious cut strand\b/i,
  /\bguide\b/i,
  /\bsymmetry\b/i,
  /\bcontinuous line\b/i,
  /\brecheck\b/i,
  /\bsection/i,
  /\bfinger/i,
  /\bshear/i,
  /\bcomb\b/i,
  /\bangle\b/i,
  /\boverdirect/i,
  /\belevat/i,
];

// A named end-result/look, not a procedure -- Part 26's own explicit
// anti-template test ("Butterfly haircut" must never auto-create a
// ProfessionalSkillDefinition). Recognized ONLY when the text is short,
// contains none of the procedural markers above, and contains no
// instruction-style verb ("make it softer" is a vague REQUEST, not a
// named look, even though it happens to also mention "haircut") -- a
// real description of how to achieve a look still counts as procedural
// content and is never misclassified this way.
const LOOK_NAME_TRAILING_NOUN_PATTERN = /\b[\w-]+(\s[\w-]+){0,2}\s+(haircut|hairstyle|hair style|look)s?\b/i;
const INSTRUCTION_VERB_PATTERN = /\b(make|use|apply|do|create|add|keep|soft|need|want|give|please|try|change|adjust)\w*\b/i;

function looksLikeNamedLookReference(text: string): boolean {
  if (INSTRUCTION_VERB_PATTERN.test(text)) return false;
  if (!LOOK_NAME_TRAILING_NOUN_PATTERN.test(text)) return false;
  return text.split(/\s+/).filter(Boolean).length <= 6;
}

function extractField(value: unknown, source: ProfessionalLearningExtractedField["source"], confidence?: number): ProfessionalLearningExtractedField {
  return confidence === undefined ? { value, source } : { value, source, confidence };
}

function setField(
  extraction: Partial<Record<ProfessionalLearningExtractionFieldName, ProfessionalLearningExtractedField>>,
  field: ProfessionalLearningExtractionFieldName,
  value: unknown,
  source: ProfessionalLearningExtractedField["source"],
  confidence?: number,
): void {
  extraction[field] = extractField(value, source, confidence);
}

export const mockProfessionalLearningExtractor: ProfessionalLearningExtractor = {
  extractorVersion: MOCK_EXTRACTOR_VERSION,

  async extract(input: ProfessionalLearningExtractorInput): Promise<ProfessionalLearningExtractorOutput> {
    const text = input.evidence.originalText?.trim() ?? "";

    if (input.evidence.evidenceType !== "TEXT" && input.evidence.evidenceType !== "VOICE_TRANSCRIPT") {
      return {
        discernment: { category: "INSUFFICIENT_EVIDENCE", reason: "Mock extractor only analyzes text-shaped evidence in this stage; image/video/diagram discernment is a real multimodal capability not yet authorized (Part 30)." },
        extraction: {},
        comparisonSkillIdHint: null,
        relatedSkillIdHints: [],
      };
    }

    if (text.length === 0) {
      return {
        discernment: { category: "INSUFFICIENT_EVIDENCE", reason: "Evidence contains no text content to discern." },
        extraction: {},
        comparisonSkillIdHint: null,
        relatedSkillIdHints: [],
      };
    }

    const mentionedSkillIds = findMentionedSkillIds(text);
    const hasProceduralContent = PROCEDURAL_MARKERS.some((marker) => marker.test(text));

    if (mentionedSkillIds.length === 0 && !hasProceduralContent) {
      if (looksLikeNamedLookReference(text)) {
        const extraction: Partial<Record<ProfessionalLearningExtractionFieldName, ProfessionalLearningExtractedField>> = {};
        setField(extraction, "targetEffect", text, "OBSERVED");
        return {
          discernment: { category: "RESULT_REFERENCE", reason: "Text names a hairstyle/look/result, not an observable professional procedure -- a look is not automatically a reusable transformation (Part 10/26)." },
          extraction,
          comparisonSkillIdHint: null,
          relatedSkillIdHints: [],
        };
      }
      return {
        discernment: { category: "INSUFFICIENT_EVIDENCE", reason: "Text contains no recognizable technique name and no observable procedural markers (no geometry, no sectioning, no tool, no guide)." },
        extraction: {},
        comparisonSkillIdHint: null,
        relatedSkillIdHints: [],
      };
    }

    const extraction: Partial<Record<ProfessionalLearningExtractionFieldName, ProfessionalLearningExtractedField>> = {};

    const primarySkillId = mentionedSkillIds[0] ?? null;
    if (primarySkillId) {
      setField(extraction, "techniqueCandidate", primarySkillId, "PROFESSIONAL_INPUT", 0.8);
    }
    if (/\bposterior\b/i.test(text)) setField(extraction, "positioning", "posterior starting area", "OBSERVED", 0.7);
    if (/\bhorizontal parting/i.test(text)) setField(extraction, "sectioning", "horizontal partings", "OBSERVED", 0.7);
    if (/\bno elevation\b/i.test(text) || /\bnatural fall\b/i.test(text)) {
      setField(extraction, "elevation", "0 degrees (natural fall)", "OBSERVED", 0.7);
    } else {
      const degreeMatch = /(\d+)\s*(?:degree|°)/i.exec(text);
      if (degreeMatch) setField(extraction, "elevation", `${degreeMatch[1]} degrees`, "OBSERVED", 0.7);
    }
    if (/\bstrand by strand\b/i.test(text)) setField(extraction, "progression", "strand by strand", "OBSERVED", 0.7);
    if (/\bprevious cut strand\b/i.test(text) || /\bguide\b/i.test(text)) {
      setField(extraction, "guideType", "previous cut strand as continuation guide", "OBSERVED", 0.6);
    }
    if (/\bsymmetry\b/i.test(text) || /\bcontinuous line\b/i.test(text)) {
      setField(extraction, "crossCheck", "symmetry / continuous line verification", "OBSERVED", 0.6);
    }
    if (/\brecheck\b/i.test(text)) {
      setField(extraction, "verificationCriteria", "dry natural-fall recheck", "OBSERVED", 0.6);
    }
    if (/\bfinishing method\b/i.test(text) || /\bnormal (?:approach|method)\b/i.test(text)) {
      setField(extraction, "professionalRationale", text, "PROFESSIONAL_INPUT", 0.5);
    }
    // Overdirection is deliberately left absent/UNKNOWN whenever the text
    // gives no basis for it -- this stage's absolute rule: do not fill
    // missing information merely to produce a complete-looking draft.
    if (!("overdirection" in extraction) && hasProceduralContent) {
      setField(extraction, "overdirection", null, "UNKNOWN");
    }

    const category = mentionedSkillIds.length > 1 ? "PROFESSIONAL_RULE" : "PROFESSIONAL_TECHNIQUE";

    return {
      discernment: {
        category,
        reason: mentionedSkillIds.length > 1
          ? "Text describes a rule relating two named techniques -- requires comparison against both for conflicts."
          : "Text describes an observable professional cutting procedure.",
      },
      extraction,
      comparisonSkillIdHint: primarySkillId,
      relatedSkillIdHints: mentionedSkillIds,
    };
  },
};

export { findMentionedSkillIds as mockExtractorFindMentionedSkillIds };
