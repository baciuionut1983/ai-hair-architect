import type { ProfessionalSkillDefinitionRecord } from "@/lib/professional-skill-registry-repository";

// AI Hair Architect, Professional Skill Engine Stage 8.5L4.R1 -- DETERMINISTIC,
// POST-EXTRACTION registry name matching (Part 17/19). The real AI model
// is NEVER shown the registry (no skill names, no descriptions, no
// incompatibilities) -- it only ever reports what it independently
// recognized, in its own words, as `techniqueCandidate.value`. This pure
// function is the ONLY place that free-text name is compared against the
// real registry, entirely server-side and deterministically, exactly
// mirroring hair-state-delta-skill-candidate-selector.ts's own "declared
// facts, never keyword-guessed AUTHORITY, but a NAME match is exactly
// what a human reading a technique name would also do" reasoning applied
// at the naming layer only -- this function decides NOTHING about
// applicability, conflicts, or authority; compareExtractionAgainstRegistry
// (unchanged from L4) still owns all of that, using the skillId this
// function resolves.
//
// Deliberately simple and conservative: normalizes punctuation/case/
// hyphens and requires the recognized name to appear as a substring of a
// registry skill's own name (or vice versa for a short recognized name) --
// never a fuzzy/semantic match that could paper over the model
// misunderstanding the evidence.

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[-_]/g, " ")
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function significantTokens(text: string): string[] {
  return normalize(text)
    .split(" ")
    .filter((token) => token.length > 2);
}

// Word-level overlap, not substring containment -- a real free-text
// paraphrase ("constructing a one length perimeter haircut") shares most
// of its distinctive words with the registry name ("Construct One-Length
// Perimeter") without ever being a literal substring of it. Requires a
// clear majority (>=0.6) of the SHORTER name's own significant tokens to
// appear, so a short, generic recognized name never spuriously matches a
// long, unrelated registry entry.
const OVERLAP_THRESHOLD = 0.6;

export function matchTechniqueNameToRegistry(recognizedName: string, registry: readonly ProfessionalSkillDefinitionRecord[]): string | null {
  const recognizedTokens = significantTokens(recognizedName);
  if (recognizedTokens.length === 0) return null;
  const recognizedSet = new Set(recognizedTokens);

  for (const record of registry) {
    const skillTokens = significantTokens(record.name);
    if (skillTokens.length === 0) continue;

    const overlap = skillTokens.filter((token) => recognizedSet.has(token)).length;
    const denominator = Math.min(skillTokens.length, recognizedTokens.length);
    if (denominator > 0 && overlap / denominator >= OVERLAP_THRESHOLD) {
      return record.skillId;
    }
  }
  return null;
}
