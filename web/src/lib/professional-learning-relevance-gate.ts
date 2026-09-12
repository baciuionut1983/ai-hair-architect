// AI Hair Architect, Professional Skill Engine Stage 8.5L4 -- RELEVANCE
// GATE (Part 9). Cheap, deterministic, fail-closed pre-checks that run
// BEFORE the (mock today, real/paid later) extractor is ever invoked --
// pure function, no I/O of its own; the service layer supplies whatever
// evidence/draft rows it already had to fetch anyway.
//
// Every reason this function can return corresponds to one of Part 9's
// own named cases: irrelevant material (caught by the extractor itself,
// not duplicated here), EMPTY_TRANSCRIPT, EVIDENCE_NOT_ACTIVE (covers
// both "revoked evidence" and "deleted-source evidence" -- both are
// non-ACTIVE statuses), and ALREADY_PROCESSED (duplicate evidence/version
// -- the idempotency case, Part 32).

export type RelevanceGateSkipReason = "EVIDENCE_NOT_ACTIVE" | "EMPTY_TRANSCRIPT" | "ALREADY_PROCESSED";

export type RelevanceGateResult = { readonly proceed: true } | { readonly proceed: false; readonly reason: RelevanceGateSkipReason };

export interface RelevanceGateEvidenceInput {
  readonly status: string;
  readonly evidenceType: string;
  readonly originalText: string | null;
}

const TEXT_SHAPED_EVIDENCE_TYPES = new Set(["TEXT", "VOICE_TRANSCRIPT"]);

export function checkRelevanceGate(evidence: RelevanceGateEvidenceInput, alreadyProcessedForThisExtractorVersion: boolean): RelevanceGateResult {
  if (alreadyProcessedForThisExtractorVersion) {
    return { proceed: false, reason: "ALREADY_PROCESSED" };
  }

  if (evidence.status !== "ACTIVE") {
    return { proceed: false, reason: "EVIDENCE_NOT_ACTIVE" };
  }

  if (TEXT_SHAPED_EVIDENCE_TYPES.has(evidence.evidenceType) && (!evidence.originalText || evidence.originalText.trim().length === 0)) {
    return { proceed: false, reason: "EMPTY_TRANSCRIPT" };
  }

  return { proceed: true };
}
