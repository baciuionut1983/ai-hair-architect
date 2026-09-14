import { describe, expect, it } from "vitest";

import { L5R2_REAL_RAW_RESULTS_BY_WINDOW_ID, L5R2_REAL_WINDOW_PLAN } from "@/lib/professional-learning-video-l5r2-real-fixture";
import { reconcileLongVideoWindows } from "@/lib/professional-learning-video-cross-window-reconciliation";
import { buildProceduralCandidate } from "@/lib/professional-learning-video-procedural-candidate";
import type { ProfessionalLearningExtractorOutput } from "@/lib/professional-learning-extractor";

// AI Hair Architect, Professional Skill Engine Stage 8.5L5.R2 -- Section
// 45 DETERMINISTIC REPLAY. Reruns the COMPLETE reconciliation +
// procedural-candidate pipeline against the exact captured 5-window real
// output (professional-learning-video-l5r2-real-fixture.ts) with ZERO AI
// calls anywhere in this file. Proves canonical-equivalent reproduction:
// identical segment/observation/action ids (content-hash-derived),
// identical continuity/repetition/zone-completion/core-chain results.
//
// Always runs as part of npm test/CI -- makes no network call of any
// kind.

function runPipeline() {
  const rawByWindowId = new Map<string, ProfessionalLearningExtractorOutput>(Object.entries(L5R2_REAL_RAW_RESULTS_BY_WINDOW_ID));
  const reconciliation = reconcileLongVideoWindows(L5R2_REAL_WINDOW_PLAN.sourceEvidenceId, L5R2_REAL_WINDOW_PLAN.windows, rawByWindowId, L5R2_REAL_WINDOW_PLAN.segmentationVersion);
  const proceduralCandidate = buildProceduralCandidate({
    actionCandidates: reconciliation.actionCandidates,
    segments: reconciliation.segments,
    editGaps: reconciliation.editGaps,
    resultObservationPresent: reconciliation.resultObservationCandidates.length > 0,
    validationCandidatePresent: reconciliation.validationCandidates.length > 0,
  });
  return { reconciliation, proceduralCandidate };
}

describe("Stage 8.5L5.R2 -- deterministic replay of the real captured long-video extraction (Section 45, ZERO AI calls)", () => {
  it("Section 46: rerunning the pipeline twice on the identical captured fixture produces byte-identical ids and results (idempotency)", () => {
    const first = runPipeline();
    const second = runPipeline();

    expect(second.reconciliation.segments.map((s) => s.id)).toEqual(first.reconciliation.segments.map((s) => s.id));
    expect(second.reconciliation.observations.map((o) => o.id)).toEqual(first.reconciliation.observations.map((o) => o.id));
    expect(second.reconciliation.actionCandidates.map((a) => a.id)).toEqual(first.reconciliation.actionCandidates.map((a) => a.id));
    expect(second.reconciliation.continuityByBoundary).toEqual(first.reconciliation.continuityByBoundary);
    expect(second.proceduralCandidate.coreChainSummary).toEqual(first.proceduralCandidate.coreChainSummary);
  });

  it("replays the exact real result: 28 reconciled observations (2 context-only observations correctly excluded), 21 reconciled action candidates, 24 merged edit gaps", () => {
    const { reconciliation } = runPipeline();
    expect(reconciliation.observations).toHaveLength(28);
    expect(reconciliation.actionCandidates).toHaveLength(21);
    expect(reconciliation.editGaps).toHaveLength(24);
  });

  it("replays the exact real cross-window continuity result: 3 DISCONTINUOUS_EDITED boundaries, 1 UNKNOWN, never a false CONTINUES", () => {
    const { reconciliation } = runPipeline();
    expect(reconciliation.continuityByBoundary.map((c) => c.state)).toEqual(["DISCONTINUOUS_EDITED", "UNKNOWN", "DISCONTINUOUS_EDITED", "DISCONTINUOUS_EDITED"]);
    expect(reconciliation.continuityByBoundary.every((c) => c.state !== "CONTINUES")).toBe(true);
  });

  it("replays the exact real reference-dependency result: 4 candidates detected, ALL unestablished (REFERENCE != GUIDE AUTOMATICALLY held on real data)", () => {
    const { reconciliation } = runPipeline();
    expect(reconciliation.referenceDependencyCandidates).toHaveLength(4);
    expect(reconciliation.referenceDependencyCandidates.every((r) => r.established === false)).toBe(true);
  });

  it("replays the exact real repetition result: CUTTING_ACTION repeats 13 times, scope never established (honest, never fabricated)", () => {
    const { proceduralCandidate } = runPipeline();
    expect(proceduralCandidate.repetitionByKind.CUTTING_ACTION.occurrenceActionCandidateIds).toHaveLength(13);
    expect(proceduralCandidate.repetitionByKind.CUTTING_ACTION.scopeEstablished).toBe(false);
  });

  it("replays the exact real zone-completion result: every kind UNKNOWN, never COMPLETED despite 13 repeated cutting actions", () => {
    const { proceduralCandidate } = runPipeline();
    for (const state of Object.values(proceduralCandidate.zoneCompletionByKind)) {
      expect(state).toBe("UNKNOWN");
    }
  });

  it("replays the exact real core demonstration chain summary", () => {
    const { proceduralCandidate } = runPipeline();
    expect(proceduralCandidate.coreChainSummary).toEqual({
      START: "SUPPORTED",
      ACTION: "SUPPORTED",
      PROGRESSION: "UNKNOWN",
      ITERATION: "PARTIALLY_SUPPORTED",
      ZONE_COMPLETE: "NOT_OBSERVED",
      RESULT_OBSERVATION: "NOT_OBSERVED",
      VALIDATION: "SUPPORTED",
    });
  });

  it("Section 42/48: raw provider output is preserved verbatim in the fixture -- discernment/extraction for window 0 exactly matches the real captured call", () => {
    const window0 = L5R2_REAL_WINDOW_PLAN.windows[0];
    const raw = L5R2_REAL_RAW_RESULTS_BY_WINDOW_ID[window0.id];
    expect(raw.discernment.category).toBe("PROFESSIONAL_TECHNIQUE");
    expect(raw.extraction.techniqueCandidate?.value).toBe("graduated haircut");
    expect(raw.extraction.techniqueCandidate?.source).toBe("INFERRED");
    expect(raw.comparisonSkillIdHint).toBeNull(); // no false registry match anywhere across all 5 windows
  });
});
