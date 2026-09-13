// AI Hair Architect, Professional Skill Engine Stage 8.5L4 -- UI logic
// (Part 29). Pure, fully-tested display formatting only -- no fetch, no
// React. ABSOLUTE COPY RULE: this stage never implies "AI a învățat cu
// succes" (AI successfully learned) anywhere -- every label below leads
// with "draft, requires professional review," matching the task's own
// preferred wording exactly ("Draft de învățare -- necesită verificare
// profesională.").

export const LEARNING_DRAFT_HEADING_TEXT = "Draft de învățare — necesită verificare profesională.";

const DISCERNMENT_LABELS: Record<string, string> = {
  PROFESSIONAL_TECHNIQUE: "Tehnică profesională",
  PROFESSIONAL_VARIATION: "Variație a unei tehnici",
  PROFESSIONAL_CORRECTION: "Corecție profesională",
  PROFESSIONAL_RULE: "Regulă profesională",
  PROFESSIONAL_RATIONALE: "Justificare profesională",
  PROFESSIONAL_EXAMPLE: "Exemplu profesional",
  TOOL_INFORMATION: "Informație despre unealtă",
  PRODUCT_INFORMATION: "Informație despre produs",
  BRAND_INFORMATION: "Informație despre brand",
  RESULT_REFERENCE: "Referință la un rezultat/look (nu o tehnică)",
  TREND_INFORMATION: "Informație despre tendințe",
  IRRELEVANT: "Fără relevanță profesională",
  INSUFFICIENT_EVIDENCE: "Informație insuficientă",
};

const COMPARISON_LABELS: Record<string, string> = {
  MATCH_EXISTING: "Corespunde unei tehnici existente",
  EVIDENCE_FOR_EXISTING: "Susține o tehnică existentă",
  VARIATION_OF_EXISTING: "Variație a unei tehnici existente",
  POSSIBLE_CORRECTION: "Posibilă corecție",
  POSSIBLE_CONFLICT: "Posibil conflict cu o regulă aprobată",
  POSSIBLE_NEW_SKILL: "Posibilă tehnică nouă (necesită analiză separată)",
  INSUFFICIENT_INFORMATION: "Informație insuficientă pentru comparație",
};

const PROVENANCE_LABELS: Record<string, string> = {
  OBSERVED: "Observat",
  INFERRED: "Dedus",
  PROFESSIONAL_INPUT: "Introdus de profesionist",
  // Stage 8.5L4.R1.1 -- "Nedeterminat din material" rather than a bare
  // "Necunoscut" (unknown/ignorant): the meaning is specifically "the
  // supplied source did not establish this reliably," never "the AI
  // failed" or "this information does not exist" (this stage's own
  // absolute rule).
  UNKNOWN: "Nedeterminat din material",
  EXTERNAL_RESEARCH: "Cercetare externă",
  MANUFACTURER_CLAIM: "Afirmație producător",
  TREND_SIGNAL: "Semnal de tendință",
};

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Draft",
  READY_FOR_REVIEW: "Gata pentru verificare",
  APPROVED: "Interpretare aprobată de profesionist",
  REJECTED: "Respins",
  SUPERSEDED: "Înlocuit de o versiune ulterioară",
};

export function discernmentLabel(category: string): string {
  return DISCERNMENT_LABELS[category] ?? category;
}
export function comparisonLabel(outcome: string): string {
  return COMPARISON_LABELS[outcome] ?? outcome;
}
export function provenanceLabel(source: string): string {
  return PROVENANCE_LABELS[source] ?? source;
}
export function draftStatusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

export interface ExtractedFieldDisplay {
  readonly field: string;
  readonly value: string;
  readonly source: string;
}

// Never claims registry activation for APPROVED -- the caller must show
// this note alongside any APPROVED status (Part 28: PROFESSIONAL REVIEW
// APPROVED, never REGISTRY ACTIVATED).
export const APPROVED_NOTE_TEXT = "Aprobarea înregistrează verificarea profesională a interpretării -- nu activează automat nicio tehnică în registru.";

// Stage 8.5L4.R2.2, Part 17 -- minimum safe reviewability for a claim the
// general semantic-binding guard downgraded: rather than a bare "—"
// (indistinguishable from a field the extractor never addressed at all),
// a preserved rawObservation is shown so the professional can see
// something WAS observed, even though its professional meaning could not
// be safely established. No redesign, no verbose AI explanation -- one
// short, clearly-labeled line.
export function formatExtractionForDisplay(
  extraction: Record<string, { value: unknown; source: string; rawObservation?: string } | undefined>,
): readonly ExtractedFieldDisplay[] {
  return Object.entries(extraction)
    .filter((entry): entry is [string, { value: unknown; source: string; rawObservation?: string }] => entry[1] !== undefined)
    .map(([field, entry]) => {
      const isEmpty = entry.value === null || entry.value === undefined;
      const value = isEmpty ? (entry.rawObservation ? `Observat, sens neclar: ${entry.rawObservation}` : "—") : String(entry.value);
      return { field, value, source: provenanceLabel(entry.source) };
    });
}
