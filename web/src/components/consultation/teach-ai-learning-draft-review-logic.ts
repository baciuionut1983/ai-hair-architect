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

// T1.1 Issue #1, Fix 1 -- FAIL-HONEST extraction errors (never a silent,
// blank "draft" with no explanation). Deliberately a small, closed
// lookup table rather than displaying the server's own `message` text
// verbatim: every code below is one this app itself throws with a
// controlled, non-secret message (professional-learning-extractor-
// selection.ts / professional-learning-extractor-gemini.ts /
// professional-learning-draft-service.ts), but resolving through a fixed
// Romanian label here -- instead of trusting raw text from the response
// -- means a future new error code can never leak something inappropriate
// (a stack trace, provider internals) into this UI merely by being
// thrown; unrecognized codes fall back to the same generic, safe message.
const EXTRACTION_ERROR_LABELS: Record<string, string> = {
  REAL_EXTRACTION_MISCONFIGURED: "Extracția reală AI nu este configurată corect. Contactează un administrator.",
  NOT_CONFIGURED: "Extracția reală AI nu este configurată corect. Contactează un administrator.",
  TIMEOUT: "Analiza materialului a durat prea mult și a fost întreruptă. Poți încerca din nou.",
  RATE_LIMITED: "Prea multe cereri către AI în acest moment. Încearcă din nou în câteva minute.",
  INVALID_RESPONSE: "AI-ul a răspuns într-un format neașteptat. Poți încerca din nou.",
  PROVIDER_ERROR: "Serviciul AI nu a putut analiza materialul acum. Poți încerca din nou.",
  EVIDENCE_NOT_FOUND: "Materialul nu a fost găsit.",
  VIDEO_MEDIA_UNAVAILABLE: "Materialul video încărcat nu a putut fi citit. Încearcă să îl reîncarci.",
  IMAGE_MEDIA_UNAVAILABLE: "Materialul încărcat nu a putut fi citit. Încearcă să îl reîncarci.",
  // T1.2.R1 -- EXPLICIT REANALYSIS SEMANTICS.
  DRAFT_REANALYSIS_IN_PROGRESS: "O reanalizare a acestui material este deja în curs. Încearcă din nou în câteva momente.",
  DRAFT_NOT_REANALYZABLE: "Acest draft a fost deja revizuit profesional și nu mai poate fi reanalizat.",
};

const EXTRACTION_ERROR_GENERIC_LABEL = "Analiza materialului nu a putut fi finalizată. Poți încerca din nou.";

export function extractionErrorLabel(code: string | null | undefined): string {
  if (!code) return EXTRACTION_ERROR_GENERIC_LABEL;
  return EXTRACTION_ERROR_LABELS[code] ?? EXTRACTION_ERROR_GENERIC_LABEL;
}

// A failed attempt must never look like a successful reanalysis --
// "Reanalizează" only ever labels the button after a PRIOR SUCCESSFUL
// analysis (a real draft or a genuine skip), never after an error.
export function draftActionButtonLabel(expanded: boolean, hasError: boolean): string {
  if (hasError) return "Încearcă din nou";
  return expanded ? "Reanalizează" : "Analizează material (draft)";
}

export type DraftAnalysisOutcome =
  | { readonly kind: "draft"; readonly draft: unknown }
  | { readonly kind: "skipped"; readonly reason: string }
  | { readonly kind: "error"; readonly message: string };

// T1.1 Issue #1, Fix 1 -- the ONE place that decides what a POST
// /api/v1/learning-evidence/[evidenceId]/drafts response means. Pure and
// fully testable, unlike the fetch call itself: given the response's
// `ok` flag and its parsed body (or null, when the body could not be
// parsed as JSON at all), it classifies the outcome into exactly one of
// three shapes -- never silently falling through to "nothing to show"
// the way the pre-fix component did. A non-ok response is ALWAYS an
// error, regardless of its body shape; an ok response that matches
// neither the "skipped" nor the "draft" success shape is ALSO treated as
// an error (a defensive floor -- a 2xx response this UI cannot make
// sense of must never be presented as if nothing happened).
export function classifyDraftAnalysisResponse(
  ok: boolean,
  body: { status?: unknown; reason?: unknown; draft?: unknown; error?: unknown; message?: unknown } | null,
): DraftAnalysisOutcome {
  if (!ok) {
    return { kind: "error", message: extractionErrorLabel(typeof body?.error === "string" ? body.error : undefined) };
  }
  if (body?.status === "skipped") {
    return { kind: "skipped", reason: typeof body.reason === "string" ? body.reason : "SKIPPED" };
  }
  if (body?.draft) {
    return { kind: "draft", draft: body.draft };
  }
  return { kind: "error", message: extractionErrorLabel(undefined) };
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

// T1.2 -- TEMPORAL OBSERVATION PRESERVATION. Heading for the new,
// clearly separate section: this is raw evidence the AI observed over
// time, never the reviewable professional field summary above, and
// never professional truth/approved knowledge on its own.
export const TEMPORAL_EVIDENCE_HEADING_TEXT = "Observații temporale din material";

export interface TemporalEvidenceDisplayEntry {
  readonly rangeLabel: string;
  readonly text: string;
  readonly source: string;
}

interface TemporalObservationLike {
  readonly timeStartSeconds: number;
  readonly timeEndSeconds: number;
  readonly observation: string;
  readonly source: string;
}
interface TemporalActionLike {
  readonly timeStartSeconds: number;
  readonly timeEndSeconds: number;
  readonly kind: string;
  readonly source: string;
}
interface TemporalEditGapLike {
  readonly beforeTimeSeconds: number;
  readonly afterTimeSeconds: number;
  readonly source: string;
}

// Merges the three separately-shaped evidence arrays into ONE
// chronological, display-ready list (Array.prototype.sort is stable, so
// entries sharing an identical start second keep their original,
// deterministic relative order -- never reshuffled). Never claims
// professional authority for an edit-gap entry beyond what it is: a
// literal, structural claim about the video itself, so its own text is
// fixed and descriptive rather than professionally worded.
export function formatTemporalEvidenceForDisplay(
  temporalEvidence: { observations?: readonly TemporalObservationLike[]; actions?: readonly TemporalActionLike[]; editGaps?: readonly TemporalEditGapLike[] } | null | undefined,
): readonly TemporalEvidenceDisplayEntry[] {
  if (!temporalEvidence) return [];

  const withStart: { startSeconds: number; entry: TemporalEvidenceDisplayEntry }[] = [];

  for (const o of temporalEvidence.observations ?? []) {
    withStart.push({ startSeconds: o.timeStartSeconds, entry: { rangeLabel: `${o.timeStartSeconds}s–${o.timeEndSeconds}s`, text: o.observation, source: provenanceLabel(o.source) } });
  }
  for (const a of temporalEvidence.actions ?? []) {
    withStart.push({ startSeconds: a.timeStartSeconds, entry: { rangeLabel: `${a.timeStartSeconds}s–${a.timeEndSeconds}s`, text: a.kind, source: provenanceLabel(a.source) } });
  }
  for (const g of temporalEvidence.editGaps ?? []) {
    withStart.push({
      startSeconds: g.beforeTimeSeconds,
      entry: { rangeLabel: `${g.beforeTimeSeconds}s–${g.afterTimeSeconds}s`, text: "Posibilă tăietură/editare video", source: provenanceLabel(g.source) },
    });
  }

  return withStart.sort((a, b) => a.startSeconds - b.startSeconds).map((item) => item.entry);
}

// T1.4.a -- TEMPORAL EVIDENCE -> PROCEDURAL INTERPRETATION (read-only,
// derived, non-authoritative). This function does NOT recompute
// anything -- the server already ran the existing (previously dormant)
// procedural-reasoning engine and sent the plain result; this file only
// maps it to Romanian display labels, exactly mirroring
// formatTemporalEvidenceForDisplay's own established convention.
// Deliberately has ZERO import from any @/lib file that pulls in
// node:crypto (professional-learning-video-temporal-reasoning.ts /
// -segmentation.ts / -video-temporal-to-procedural-adapter.ts) -- this
// module is loaded into a "use client" component, and those files are
// server-only, real-I/O-adjacent constructors. The shapes below are a
// deliberate, duck-typed mirror, matching this file's own
// TemporalObservationLike/TemporalActionLike precedent exactly.
export const PROCEDURAL_INTERPRETATION_HEADING_TEXT = "Interpretare procedurală (dedusă din dovezi, nu este adevăr profesional confirmat)";

interface ProceduralActionEntryLike {
  readonly action: { readonly kind: string };
  readonly absoluteInterval: { readonly timeStartSeconds: number; readonly timeEndSeconds: number };
  readonly precedingTransition: string;
}
interface RepetitionAssessmentLike {
  readonly occurrenceActionCandidateIds: readonly string[];
}
interface ProceduralCandidateLike {
  readonly orderedActions?: readonly ProceduralActionEntryLike[];
  readonly repetitionByKind?: Readonly<Record<string, RepetitionAssessmentLike>>;
  readonly zoneCompletionByKind?: Readonly<Record<string, string>>;
  readonly coreChainSummary?: Readonly<Record<string, string>>;
}

export interface ProceduralActionSequenceDisplayEntry {
  readonly rangeLabel: string;
  readonly kind: string;
  readonly transitionLabel: string;
}
export interface ProceduralRepetitionDisplayEntry {
  readonly kind: string;
  readonly occurrenceCount: number;
}
export interface ProceduralZoneCompletionDisplayEntry {
  readonly kind: string;
  readonly stateLabel: string;
}
export interface ProceduralChainStageDisplayEntry {
  readonly stageLabel: string;
  readonly supportLabel: string;
}
export interface ProceduralInterpretationDisplay {
  readonly actionSequence: readonly ProceduralActionSequenceDisplayEntry[];
  readonly repetitions: readonly ProceduralRepetitionDisplayEntry[];
  readonly zoneCompletion: readonly ProceduralZoneCompletionDisplayEntry[];
  readonly coreChainSummary: readonly ProceduralChainStageDisplayEntry[];
}

const ACTION_TRANSITION_LABELS: Record<string, string> = {
  START: "Început",
  ADJACENT: "Continuă imediat",
  UNKNOWN_TRANSITION: "Tranziție neclară",
  DISCONTINUOUS_EDITED: "Întrerupt de o editare video",
};
const ZONE_COMPLETION_STATE_LABELS: Record<string, string> = {
  NOT_ESTABLISHED: "Neestablit din material",
  IN_PROGRESS: "În desfășurare",
  COMPLETED: "Finalizat",
  UNKNOWN: "Nedeterminat din material",
};
// Fixed, deterministic display order -- never derived from Object.keys
// (whose iteration order is an implementation detail, not a
// professional-meaningful sequence).
const CORE_CHAIN_STAGE_ORDER = ["START", "ACTION", "PROGRESSION", "ITERATION", "ZONE_COMPLETE", "RESULT_OBSERVATION", "VALIDATION"] as const;
const CORE_CHAIN_STAGE_LABELS: Record<string, string> = {
  START: "Început",
  ACTION: "Acțiune",
  PROGRESSION: "Progresie",
  ITERATION: "Repetiție",
  ZONE_COMPLETE: "Zonă finalizată",
  RESULT_OBSERVATION: "Observare rezultat",
  VALIDATION: "Validare",
};
const CORE_CHAIN_SUPPORT_LABELS: Record<string, string> = {
  SUPPORTED: "Susținut de dovezi",
  PARTIALLY_SUPPORTED: "Parțial susținut",
  UNKNOWN: "Nedeterminat din material",
  NOT_OBSERVED: "Neobservat",
};

// Returns null (never a fabricated placeholder) when the server sent no
// derivable interpretation -- the caller renders nothing for this
// section in that case, exactly like formatTemporalEvidenceForDisplay's
// own empty-array convention.
export function formatProceduralInterpretationForDisplay(candidate: ProceduralCandidateLike | null | undefined): ProceduralInterpretationDisplay | null {
  if (!candidate) return null;

  const actionSequence = (candidate.orderedActions ?? []).map((entry) => ({
    rangeLabel: `${entry.absoluteInterval.timeStartSeconds}s–${entry.absoluteInterval.timeEndSeconds}s`,
    kind: entry.action.kind,
    transitionLabel: ACTION_TRANSITION_LABELS[entry.precedingTransition] ?? entry.precedingTransition,
  }));

  const repetitions = Object.entries(candidate.repetitionByKind ?? {}).map(([kind, r]) => ({
    kind,
    occurrenceCount: r.occurrenceActionCandidateIds.length,
  }));

  const zoneCompletion = Object.entries(candidate.zoneCompletionByKind ?? {}).map(([kind, state]) => ({
    kind,
    stateLabel: ZONE_COMPLETION_STATE_LABELS[state] ?? state,
  }));

  const coreChainSummary = CORE_CHAIN_STAGE_ORDER.filter((stage) => candidate.coreChainSummary?.[stage] !== undefined).map((stage) => {
    const support = candidate.coreChainSummary![stage];
    return { stageLabel: CORE_CHAIN_STAGE_LABELS[stage] ?? stage, supportLabel: CORE_CHAIN_SUPPORT_LABELS[support] ?? support };
  });

  return { actionSequence, repetitions, zoneCompletion, coreChainSummary };
}

// T1.2.R1 -- EXPLICIT REANALYSIS SEMANTICS. The ONE place the component
// decides what to send the server: REANALYZE only once a successful
// draft has genuinely been shown in this session, exactly matching the
// button's own "Reanalizează" intent -- the very first click (even after
// a page refresh, even if a draft already exists server-side) is always
// a normal, idempotent ANALYZE, never REANALYZE. `hasExistingDraft` must
// be tracked separately from `draft`/`expanded` (both of which the
// component resets at the start of every attempt, including a failed
// retry) -- see the component's own comment for why.
export function nextRequestMode(hasExistingDraft: boolean): "ANALYZE" | "REANALYZE" {
  return hasExistingDraft ? "REANALYZE" : "ANALYZE";
}
