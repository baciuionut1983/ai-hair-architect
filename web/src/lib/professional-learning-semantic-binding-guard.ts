import type { ProfessionalLearningExtractedField, ProfessionalLearningExtraction, ProfessionalLearningExtractionFieldName } from "@/lib/professional-learning-draft-validators";

// AI Hair Architect, Professional Skill Engine Stage 8.5L4.R2.2 --
// GENERAL PROFESSIONAL SEMANTIC BINDING FOUNDATION. Generalizes R2.1's
// elevation-only guard (professional-learning-elevation-semantic-guard.ts,
// retired by this stage -- its exact term lists survive unchanged as the
// "elevation" entry in SEMANTIC_FIELD_MARKER_RULES below, so nothing
// about elevation protection gets weaker, only more broadly applicable).
//
// THE CORE DISTINCTION THIS FILE EXISTS TO ENFORCE (Part 1/2/7):
//   SOURCE SUPPORT  -- does the evidence support that SOMETHING was
//                      genuinely observed? (unchanged: OBSERVED/INFERRED
//                      grounding, professional-learning-draft-extraction-
//                      validator.ts)
//   SEMANTIC SUPPORT -- does the evidence support that the OBSERVATION
//                      means what the chosen FIELD NAME claims it means?
//                      (this file, new)
// A claim can have full source support and zero semantic support at the
// same time -- the model can correctly SEE something while incorrectly
// NAMING its professional meaning. Only claims with BOTH survive as
// reviewable known professional knowledge under a specific field.
//
// NOT A RULE FARM (Part 2): there is exactly ONE evaluation function
// (isClaimSemanticallyBound) and ONE small, declarative configuration
// table (SEMANTIC_FIELD_MARKER_RULES) -- never one hand-written function
// per field. A field with no configured rule is simply not subject to
// this guard at all (it passes through exactly as extracted) -- this
// guard is scoped to the small set of GEOMETRY/DIRECTION/STRUCTURE
// concepts genuinely at risk of being confused with one another from
// visual evidence (the same fields this stage's own task names in its
// cross-field misbinding tests), not all 32 schema fields. Narrative/
// descriptive fields (techniqueCandidate, professionalRationale,
// verificationCriteria, prerequisites, incompatibilities, targetEffect,
// domain, discipline, ...) carry much lower field-confusion risk and are
// deliberately left unguarded rather than padding this table for its own
// sake.
//
// LEXICAL MATCHING IS A NARROW, REPLACEABLE FALLBACK, NOT THE DEFINITION
// OF SEMANTICS (Part 11/12): the term lists below are English-only,
// because the extractor's own prompts and this application's real model
// outputs have so far always been produced in English regardless of the
// evidence's source language -- they are NOT a claim that professional
// meaning IS lexical, or that it only exists in English. A future,
// stronger determination mechanism (real multilingual classification, an
// explicit diagram-annotation-binding proof, or a dedicated professional-
// confirmation step) can replace `isClaimSemanticallyBound`'s
// implementation without touching anything else in this file, the
// service pipeline, or the persisted shape -- the function's signature
// (field name + claim text in, boolean out) is the actual, durable
// contract; today's lexical heuristic is one implementation of it, not
// the architecture itself.
//
// SCOPE (Part 35/One-Length regression): applies ONLY to IMAGE/DIAGRAM
// evidence, exactly like R2.1. TEXT/VOICE_TRANSCRIPT evidence already has
// a strictly stronger, more precise protection -- real token-overlap
// grounding against the evidence's OWN text (professional-learning-
// draft-extraction-validator.ts, unchanged since L4.R1). Running this
// generic, coarser, family-vocabulary heuristic against text evidence
// too would be a regression, not an improvement: e.g. One-Length's real,
// professionally-stated "0 degrees (natural fall)" names no literal
// "hair"/"strand" word and would be wrongly caught by the same rule that
// correctly catches a vague image caption. This IS this stage's minimal,
// honest instantiation of Part 10's "evidence capability" reasoning --
// only a coarse image-vs-text capability distinction, not a full
// per-evidence-type capability matrix (diagram vs. photo vs. video
// capability differences remain a named future gap, see this stage's own
// final report).
//
// PROFESSIONAL_INPUT is exempt (Part 8/9/29/30): a real professional
// statement is already independently grounded against the professional's
// own separate note text (the extractor's own authority protection,
// unchanged since L4.R1/R2) -- a categorically stronger safeguard than
// this heuristic, which exists specifically for the PROVIDER's own
// unaided visual reading. UNKNOWN entries are trivially exempt.

interface SemanticFieldMarkerRule {
  // Every group must contribute at least one match (AND across groups,
  // OR within a group) -- e.g. elevation requires a hair/strand word AND
  // a lift/angle-relationship phrase; sectioning requires only one group
  // (a section/part/divide word) since its own confusion risk is
  // one-dimensional (Part 24: sectioning must not be inferred from
  // guide-only evidence, and vice versa -- each field's own rule already
  // encodes what IT specifically requires, so neither accidentally
  // satisfies the other).
  readonly requiredTermGroups: readonly (readonly string[])[];
}

const SEMANTIC_FIELD_MARKER_RULES: Partial<Record<ProfessionalLearningExtractionFieldName, SemanticFieldMarkerRule>> = {
  // Unchanged from R2.1's own elevation guard -- see that stage's report
  // for the original replay proof.
  elevation: {
    requiredTermGroups: [
      ["hair", "strand", "section", "subsection", "tress"],
      ["lift", "lifted", "raise", "raised", "elevat", "held at", "angle from", "away from the head", "away from the scalp", "relative to the head", "degrees from"],
    ],
  },
  cuttingAngle: {
    requiredTermGroups: [
      ["cut", "cutting", "shear", "scissor", "blade"],
      ["cutting angle", "angle of the cut", "angle of the blade", "blade angle", "degrees to the hair", "angled relative to the hair"],
    ],
  },
  fingerAngle: {
    requiredTermGroups: [
      ["finger", "fingers"],
      ["finger angle", "angle of the fingers", "fingers positioned at", "fingers held at", "finger orientation"],
    ],
  },
  toolOrientation: {
    requiredTermGroups: [
      ["scissors", "shears", "clipper", "razor", "comb", "tool"],
      ["tool orientation", "held horizontally", "held vertically", "held diagonally", "orientation of the tool", "angled tool"],
    ],
  },
  distribution: {
    // A single OR-group of distribution-specific phrases -- "natural
    // fall" is itself a precise, standalone professional term for a real
    // distribution state (hair falling straight down relative to the
    // head/parting with no redirection), not a generic word that needs a
    // second co-occurring term to mean something.
    requiredTermGroups: [["distribut", "combed toward", "combed in the direction", "direction of distribution", "natural fall", "relative to the parting", "relative to the base"]],
  },
  overdirection: {
    // Overdirection is fundamentally "redirected away from where it
    // would naturally fall" -- phrasing may name the destination
    // ("directed toward/forward to the face") just as validly as the
    // origin ("moved away from its base"); both directions of phrasing
    // describe the same real professional concept.
    requiredTermGroups: [
      [
        "overdirect",
        "over-direct",
        "directed away from",
        "pulled away from",
        "moved away from its natural",
        "moved away from its base",
        "directed toward",
        "directed forward",
        "redirected",
      ],
    ],
  },
  sectioning: {
    requiredTermGroups: [["section", "sectioning", "parting", "subdivide", "division of the head", "zone"]],
  },
  guideType: {
    requiredTermGroups: [["guide"], ["continuation", "authority", "reference strand", "previous strand", "established length", "control strand"]],
  },
  guideSource: {
    requiredTermGroups: [["guide"], ["continuation", "authority", "reference strand", "previous strand", "established length", "control strand"]],
  },
};

function claimText(value: unknown, note: string | undefined): string {
  const valueText = typeof value === "string" ? value : "";
  return `${valueText} ${note ?? ""}`.toLowerCase();
}

// THE ONE general evaluation function (Part 2) -- looks up the field's
// own configured rule and checks it against the claim's own text. A
// field with no configured rule is always considered bound (nothing to
// guard).
export function isClaimSemanticallyBound(field: ProfessionalLearningExtractionFieldName, value: unknown, note?: string): boolean {
  const rule = SEMANTIC_FIELD_MARKER_RULES[field];
  if (!rule) return true;

  const text = claimText(value, note);
  return rule.requiredTermGroups.every((group) => group.some((term) => text.includes(term)));
}

export function isFieldSubjectToSemanticBindingGuard(field: ProfessionalLearningExtractionFieldName): boolean {
  return field in SEMANTIC_FIELD_MARKER_RULES;
}

function rawObservationText(entry: ProfessionalLearningExtractedField): string | undefined {
  const parts = [typeof entry.value === "string" ? entry.value : null, entry.note ?? null].filter((part): part is string => Boolean(part && part.length > 0));
  return parts.length > 0 ? parts.join(" -- ") : undefined;
}

// Applied once, server-side, after strict validation and before UNKNOWN
// completion (Part 4/6's own pipeline placement). Iterates only the
// fields that actually have a configured rule -- every other field in
// the extraction is returned untouched, by construction. A downgraded
// claim's original text is preserved as `rawObservation` (Part 13:
// "Observation First" -- fixes R2.1's own gap, where a downgrade
// silently discarded the original observation instead of preserving it
// for professional review).
export function applySemanticBindingGuard(extraction: ProfessionalLearningExtraction, isImageEvidence: boolean): ProfessionalLearningExtraction {
  if (!isImageEvidence) return extraction;

  let changed = false;
  const next: Record<string, ProfessionalLearningExtractedField> = { ...extraction };

  for (const field of Object.keys(SEMANTIC_FIELD_MARKER_RULES) as ProfessionalLearningExtractionFieldName[]) {
    const entry = extraction[field];
    if (!entry) continue;
    if (entry.source === "PROFESSIONAL_INPUT" || entry.source === "UNKNOWN") continue;
    if (isClaimSemanticallyBound(field, entry.value, entry.note)) continue;

    const observation = rawObservationText(entry);
    next[field] = { value: null, source: "UNKNOWN", ...(observation ? { rawObservation: observation } : {}) };
    changed = true;
  }

  return changed ? (next as ProfessionalLearningExtraction) : extraction;
}
