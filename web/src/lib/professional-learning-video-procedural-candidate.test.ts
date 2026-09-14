import { describe, expect, it } from "vitest";

import { buildOrderedActionEntries, buildProceduralCandidate } from "./professional-learning-video-procedural-candidate";
import { createVideoLearningSegment } from "./professional-learning-video-segmentation";
import { createActionCandidate } from "./professional-learning-video-temporal-reasoning";

const SOURCE = "evidence-long-1";
const VERSION = "v1";

function seg(start: number, end: number) {
  return createVideoLearningSegment(SOURCE, { timeStartSeconds: start, timeEndSeconds: end }, VERSION);
}

describe("professional-learning-video-procedural-candidate (Stage 8.5L5.R2)", () => {
  describe("buildOrderedActionEntries (Section 34-36)", () => {
    it("orders actions by absolute source time, first entry is START, source order never implies dependency by itself", () => {
      const s1 = seg(0, 10);
      const s2 = seg(20, 30);
      const a1 = createActionCandidate([s1.id], [], "CUTTING_ACTION", "KNOWN", "KNOWN");
      const a2 = createActionCandidate([s2.id], [], "INSPECTION", "KNOWN", "KNOWN");
      const entries = buildOrderedActionEntries([a2, a1], [s1, s2], []);
      expect(entries.map((e) => e.action.id)).toEqual([a1.id, a2.id]);
      expect(entries[0].precedingTransition).toBe("START");
    });

    it("Section 36: a wide silent gap with no corroborating observation is UNKNOWN_TRANSITION, never silently collapsed into continuity", () => {
      const s1 = seg(0, 10);
      const s2 = seg(60, 70); // 50s gap, well beyond the threshold
      const a1 = createActionCandidate([s1.id], [], "CUTTING_ACTION", "KNOWN", "KNOWN");
      const a2 = createActionCandidate([s2.id], [], "CUTTING_ACTION", "KNOWN", "KNOWN");
      const entries = buildOrderedActionEntries([a1, a2], [s1, s2], []);
      expect(entries[1].precedingTransition).toBe("UNKNOWN_TRANSITION");
    });

    it("a reconciled edit gap spanning the transition is reported as DISCONTINUOUS_EDITED", () => {
      const s1 = seg(0, 10);
      const s2 = seg(60, 70);
      const a1 = createActionCandidate([s1.id], [], "CUTTING_ACTION", "KNOWN", "KNOWN");
      const a2 = createActionCandidate([s2.id], [], "CUTTING_ACTION", "KNOWN", "KNOWN");
      const entries = buildOrderedActionEntries([a1, a2], [s1, s2], [{ beforeTimeSeconds: 10, afterTimeSeconds: 60 }]);
      expect(entries[1].precedingTransition).toBe("DISCONTINUOUS_EDITED");
    });

    it("a short, adjacent gap with no edit reported is ADJACENT (reasonably continuous)", () => {
      const s1 = seg(0, 10);
      const s2 = seg(12, 20);
      const a1 = createActionCandidate([s1.id], [], "CUTTING_ACTION", "KNOWN", "KNOWN");
      const a2 = createActionCandidate([s2.id], [], "CUTTING_ACTION", "KNOWN", "KNOWN");
      const entries = buildOrderedActionEntries([a1, a2], [s1, s2], []);
      expect(entries[1].precedingTransition).toBe("ADJACENT");
    });
  });

  describe("buildProceduralCandidate -- core chain summary (Section 37)", () => {
    it("no actions at all -> every stage NOT_OBSERVED", () => {
      const candidate = buildProceduralCandidate({ actionCandidates: [], segments: [], editGaps: [], resultObservationPresent: false, validationCandidatePresent: false });
      expect(candidate.coreChainSummary.START).toBe("NOT_OBSERVED");
      expect(candidate.coreChainSummary.ACTION).toBe("NOT_OBSERVED");
      expect(candidate.coreChainSummary.PROGRESSION).toBe("NOT_OBSERVED");
    });

    it("actions present but no spatial/zone evidence solicited -> PROGRESSION always UNKNOWN, never fabricated as SUPPORTED", () => {
      const s1 = seg(0, 10);
      const a1 = createActionCandidate([s1.id], [], "CUTTING_ACTION", "KNOWN", "KNOWN");
      const candidate = buildProceduralCandidate({ actionCandidates: [a1], segments: [s1], editGaps: [], resultObservationPresent: false, validationCandidatePresent: false });
      expect(candidate.coreChainSummary.ACTION).toBe("SUPPORTED");
      expect(candidate.coreChainSummary.PROGRESSION).toBe("UNKNOWN");
    });

    it("repeated same-kind actions with no discontinuity -> ITERATION SUPPORTED; with an unknown/discontinuous transition among them -> PARTIALLY_SUPPORTED", () => {
      const s1 = seg(0, 10);
      const s2 = seg(12, 20);
      const s3 = seg(80, 90);
      const a1 = createActionCandidate([s1.id], ["o1"], "CUTTING_ACTION", "KNOWN", "KNOWN");
      const a2 = createActionCandidate([s2.id], ["o2"], "CUTTING_ACTION", "KNOWN", "KNOWN");
      const clean = buildProceduralCandidate({ actionCandidates: [a1, a2], segments: [s1, s2], editGaps: [], resultObservationPresent: false, validationCandidatePresent: false });
      expect(clean.coreChainSummary.ITERATION).toBe("SUPPORTED");

      const a3 = createActionCandidate([s3.id], ["o3"], "CUTTING_ACTION", "KNOWN", "KNOWN");
      const withGap = buildProceduralCandidate({ actionCandidates: [a1, a2, a3], segments: [s1, s2, s3], editGaps: [], resultObservationPresent: false, validationCandidatePresent: false });
      expect(withGap.coreChainSummary.ITERATION).toBe("PARTIALLY_SUPPORTED");
    });

    it("Section 24: zone completion requires repetition scope + progression + result + validation -- with no declared scope and no progression evidence, ZONE_COMPLETE is never SUPPORTED", () => {
      const s1 = seg(0, 10);
      const s2 = seg(12, 20);
      const a1 = createActionCandidate([s1.id], ["o1"], "CUTTING_ACTION", "KNOWN", "KNOWN");
      const a2 = createActionCandidate([s2.id], ["o2"], "CUTTING_ACTION", "KNOWN", "KNOWN");
      const candidate = buildProceduralCandidate({ actionCandidates: [a1, a2], segments: [s1, s2], editGaps: [], resultObservationPresent: true, validationCandidatePresent: true });
      expect(candidate.coreChainSummary.ZONE_COMPLETE).not.toBe("SUPPORTED");
    });

    it("result/validation presence maps directly and only to those two stages", () => {
      const candidate = buildProceduralCandidate({ actionCandidates: [], segments: [], editGaps: [], resultObservationPresent: true, validationCandidatePresent: true });
      expect(candidate.coreChainSummary.RESULT_OBSERVATION).toBe("SUPPORTED");
      expect(candidate.coreChainSummary.VALIDATION).toBe("SUPPORTED");
    });
  });
});
