import { describe, expect, it } from "vitest";

import {
  assessEffect,
  assessProgression,
  assessRepetition,
  assessZoneCompletion,
  bindTemporalProfessionalFieldClaim,
  computeActionCandidateId,
  createActionCandidate,
  isContinuityBrokenBetween,
  isZoneCompletionState,
  summarizeCoreCompletionChain,
  type ZoneVisit,
} from "./professional-learning-video-temporal-reasoning";
import { createTemporalObservation, createVideoLearningSegment } from "./professional-learning-video-segmentation";

const EVIDENCE_ID = "evidence-1";
const VERSION = "seg-v1";

function seg(start: number, end: number) {
  return createVideoLearningSegment(EVIDENCE_ID, { timeStartSeconds: start, timeEndSeconds: end }, VERSION);
}

describe("professional-learning-video-temporal-reasoning (Stage 8.5L5)", () => {
  describe("ActionCandidate identity (Section 9/29/30/50)", () => {
    it("is deterministic/idempotent for identical (segments, observations, kind)", () => {
      const a = computeActionCandidateId(["s1", "s2"], ["o1"], "CUTTING");
      const b = computeActionCandidateId(["s2", "s1"], ["o1"], "CUTTING");
      expect(a).toBe(b);
    });

    it("differs when observations differ, even with the same segments/kind -- two distinct actions of the same kind never collide", () => {
      const a = computeActionCandidateId(["s1"], ["o1"], "CUTTING");
      const b = computeActionCandidateId(["s1"], ["o2"], "CUTTING");
      expect(a).not.toBe(b);
    });

    it("one action may span multiple segments (Section 29)", () => {
      const candidate = createActionCandidate(["s1", "s2"], ["o1"], "CUTTING", "APPROXIMATE", "APPROXIMATE");
      expect(candidate.segmentIds).toEqual(["s1", "s2"]);
    });

    it("one segment may contain multiple observations/actions (Section 30) -- observationIds live on the candidate, not forced 1:1", () => {
      const candidate = createActionCandidate(["s1"], ["o1", "o2", "o3"], "CUTTING", "KNOWN", "KNOWN");
      expect(candidate.observationIds).toHaveLength(3);
    });
  });

  describe("bindTemporalProfessionalFieldClaim -- semantic binding cannot be bypassed (Section 12/31/39/60)", () => {
    it("a temporal observation proposing elevation without grounding is downgraded to UNKNOWN, exactly like the image pipeline's guard", () => {
      const result = bindTemporalProfessionalFieldClaim("elevation", "90 degrees", "OBSERVED", "A strand visibly moves upward in the frame.");
      expect(result.source).toBe("UNKNOWN");
      expect(result.value).toBeNull();
      expect(result.rawObservation).toContain("moves upward");
    });

    it("comb movement does not automatically establish distribution", () => {
      const result = bindTemporalProfessionalFieldClaim("distribution", "natural fall relative to the parting", "OBSERVED", "Comb moves down through the section.");
      // The claim's OWN text ("natural fall relative to the parting") is
      // what the guard evaluates -- it is grounded on its own merits, not
      // because a comb was seen moving. This proves the guard is being
      // consulted (not bypassed): a same-shape claim with no grounding at
      // all is rejected below.
      expect(result.source).toBe("OBSERVED");

      const ungrounded = bindTemporalProfessionalFieldClaim("distribution", "generic diagonal lines", "OBSERVED", "Comb moves down through the frame.");
      expect(ungrounded.source).toBe("UNKNOWN");
    });

    it("strand moving upward does not automatically establish elevation without an explicit hair/lift relationship", () => {
      const result = bindTemporalProfessionalFieldClaim("elevation", "some value", "OBSERVED", "Strand moves upward.");
      expect(result.source).toBe("UNKNOWN");
    });

    it("a genuinely grounded claim survives as its declared source (OBSERVED or INFERRED)", () => {
      const observed = bindTemporalProfessionalFieldClaim("elevation", "90 degrees", "OBSERVED", "The strand is visibly lifted 90 degrees away from the head.");
      expect(observed.source).toBe("OBSERVED");
      const inferred = bindTemporalProfessionalFieldClaim("elevation", "90 degrees", "INFERRED", "The strand is visibly lifted 90 degrees away from the head.");
      expect(inferred.source).toBe("INFERRED");
    });

    it("PROFESSIONAL_INPUT and UNKNOWN are exempt, exactly like the image-evidence guard", () => {
      const input = bindTemporalProfessionalFieldClaim("elevation", "90 degrees", "PROFESSIONAL_INPUT", "unrelated text");
      expect(input).toEqual({ value: "90 degrees", source: "PROFESSIONAL_INPUT", note: "unrelated text" });
      const unknown = bindTemporalProfessionalFieldClaim("elevation", null, "UNKNOWN");
      expect(unknown).toEqual({ value: null, source: "UNKNOWN" });
    });

    it("a field with no configured semantic rule passes through unguarded, exactly like R2.2's own scope", () => {
      const result = bindTemporalProfessionalFieldClaim("techniqueCandidate", "Graduated Cutting", "OBSERVED", "some note");
      expect(result.source).toBe("OBSERVED");
    });
  });

  describe("assessRepetition (Section 15) -- REPETITION != COMPLETION", () => {
    it("counts occurrences of the same kind and requires an explicitly declared scope to establish completion-relevant scope", () => {
      const candidates = [
        createActionCandidate(["s1"], ["o1"], "CUTTING", "KNOWN", "KNOWN"),
        createActionCandidate(["s2"], ["o2"], "CUTTING", "KNOWN", "KNOWN"),
        createActionCandidate(["s3"], ["o3"], "COMBING", "KNOWN", "KNOWN"),
      ];
      const undeclared = assessRepetition(candidates, "CUTTING");
      expect(undeclared.occurrenceActionCandidateIds).toHaveLength(2);
      expect(undeclared.scopeEstablished).toBe(false);

      const declared = assessRepetition(candidates, "CUTTING", 2);
      expect(declared.scopeEstablished).toBe(true);

      const notMet = assessRepetition(candidates, "CUTTING", 5);
      expect(notMet.scopeEstablished).toBe(false);
    });
  });

  describe("assessProgression (Section 16/40) -- requires BOTH temporal and spatial support", () => {
    it("Part 40 positive control: adjacent zones visited in strict temporal order are SUPPORTED", () => {
      const visits: ZoneVisit[] = [
        { zoneId: "zone-A", segmentId: "s1", interval: { timeStartSeconds: 0, timeEndSeconds: 10 }, adjacentToPrevious: false },
        { zoneId: "zone-B", segmentId: "s2", interval: { timeStartSeconds: 10, timeEndSeconds: 20 }, adjacentToPrevious: true },
        { zoneId: "zone-C", segmentId: "s3", interval: { timeStartSeconds: 20, timeEndSeconds: 30 }, adjacentToPrevious: true },
      ];
      const result = assessProgression(visits);
      expect(result.status).toBe("SUPPORTED");
      expect(result.zoneSequence).toEqual(["zone-A", "zone-B", "zone-C"]);
    });

    it("Part 40 negative control: disconnected/out-of-order shots never prove progression", () => {
      const disconnected: ZoneVisit[] = [
        { zoneId: "zone-A", segmentId: "s1", interval: { timeStartSeconds: 0, timeEndSeconds: 10 }, adjacentToPrevious: false },
        { zoneId: "zone-C", segmentId: "s3", interval: { timeStartSeconds: 5, timeEndSeconds: 8 }, adjacentToPrevious: true },
      ];
      expect(assessProgression(disconnected).status).toBe("UNKNOWN");
    });

    it("no declared spatial adjacency -> UNKNOWN even if temporally ordered", () => {
      const visits: ZoneVisit[] = [
        { zoneId: "zone-A", segmentId: "s1", interval: { timeStartSeconds: 0, timeEndSeconds: 10 }, adjacentToPrevious: false },
        { zoneId: "zone-unrelated", segmentId: "s2", interval: { timeStartSeconds: 10, timeEndSeconds: 20 }, adjacentToPrevious: false },
      ];
      expect(assessProgression(visits).status).toBe("UNKNOWN");
    });

    it("fewer than two zone visits can never establish progression", () => {
      expect(assessProgression([]).status).toBe("UNKNOWN");
      expect(assessProgression([{ zoneId: "zone-A", segmentId: "s1", interval: { timeStartSeconds: 0, timeEndSeconds: 10 }, adjacentToPrevious: false }]).status).toBe("UNKNOWN");
    });
  });

  describe("assessZoneCompletion (Section 17/18) -- ONE ACTION/SUBSECTION != COMPLETION", () => {
    it("Section 37 single-cut negative control: one occurrence, no declared scope -> never COMPLETED", () => {
      const repetition = assessRepetition([createActionCandidate(["s1"], ["o1"], "CUTTING", "KNOWN", "KNOWN")], "CUTTING");
      const progression = assessProgression([]);
      const state = assessZoneCompletion({ repetition, progression, resultObservationPresent: false, validationPresent: false });
      expect(state).not.toBe("COMPLETED");
      expect(isZoneCompletionState(state)).toBe(true);
    });

    it("Section 41 completion positive control: declared scope met + progression supported + result + validation -> COMPLETED", () => {
      const candidates = [createActionCandidate(["s1"], ["o1"], "CUTTING", "KNOWN", "KNOWN"), createActionCandidate(["s2"], ["o2"], "CUTTING", "KNOWN", "KNOWN")];
      const repetition = assessRepetition(candidates, "CUTTING", 2);
      const progression = assessProgression([
        { zoneId: "zone-A", segmentId: "s1", interval: { timeStartSeconds: 0, timeEndSeconds: 10 }, adjacentToPrevious: false },
        { zoneId: "zone-B", segmentId: "s2", interval: { timeStartSeconds: 10, timeEndSeconds: 20 }, adjacentToPrevious: true },
      ]);
      const state = assessZoneCompletion({ repetition, progression, resultObservationPresent: true, validationPresent: true });
      expect(state).toBe("COMPLETED");
    });

    it("completion negative control: same repetition/progression but no result observation -> IN_PROGRESS, never COMPLETED", () => {
      const candidates = [createActionCandidate(["s1"], ["o1"], "CUTTING", "KNOWN", "KNOWN"), createActionCandidate(["s2"], ["o2"], "CUTTING", "KNOWN", "KNOWN")];
      const repetition = assessRepetition(candidates, "CUTTING", 2);
      const progression = assessProgression([
        { zoneId: "zone-A", segmentId: "s1", interval: { timeStartSeconds: 0, timeEndSeconds: 10 }, adjacentToPrevious: false },
        { zoneId: "zone-B", segmentId: "s2", interval: { timeStartSeconds: 10, timeEndSeconds: 20 }, adjacentToPrevious: true },
      ]);
      const state = assessZoneCompletion({ repetition, progression, resultObservationPresent: false, validationPresent: true });
      expect(state).toBe("IN_PROGRESS");
    });

    it("never inferred from a video simply ending -- zero occurrences remains NOT_ESTABLISHED regardless of result/validation flags", () => {
      const repetition = assessRepetition([], "CUTTING");
      const progression = assessProgression([]);
      const state = assessZoneCompletion({ repetition, progression, resultObservationPresent: true, validationPresent: true });
      expect(state).toBe("NOT_ESTABLISHED");
    });

    it("repetition control (Section 39): repetition alone, without declared scope or progression, never equals completion", () => {
      const candidates = [
        createActionCandidate(["s1"], ["o1"], "CUTTING", "KNOWN", "KNOWN"),
        createActionCandidate(["s2"], ["o2"], "CUTTING", "KNOWN", "KNOWN"),
        createActionCandidate(["s3"], ["o3"], "CUTTING", "KNOWN", "KNOWN"),
      ];
      const repetition = assessRepetition(candidates, "CUTTING"); // no declared scope
      const progression = assessProgression([]);
      const state = assessZoneCompletion({ repetition, progression, resultObservationPresent: false, validationPresent: false });
      expect(state).not.toBe("COMPLETED");
    });
  });

  describe("assessEffect (Section 19/20/24/42/43) -- TEMPORAL ORDER != CAUSALITY", () => {
    const segment = seg(0, 10);
    const action = createActionCandidate([segment.id], ["o1"], "CUTTING", "KNOWN", "KNOWN");

    it("Section 42 effect negative control: action observed, no after-state -> effect UNKNOWN", () => {
      const before = createTemporalObservation(segment.id, EVIDENCE_ID, "ends visibly uneven", "OBSERVED");
      const result = assessEffect(before, action, null, false);
      expect(result.status).toBe("UNKNOWN");
    });

    it("Section 43 effect positive control: before + after + continuity intact -> effect candidate SUPPORTED", () => {
      const before = createTemporalObservation(segment.id, EVIDENCE_ID, "ends visibly uneven", "OBSERVED");
      const after = createTemporalObservation(seg(10, 15).id, EVIDENCE_ID, "line visibly cleaner", "OBSERVED");
      const result = assessEffect(before, action, after, false);
      expect(result.status).toBe("SUPPORTED");
    });

    it("Section 24: a declared continuity break between before/after forces UNKNOWN even with both states present", () => {
      const before = createTemporalObservation(segment.id, EVIDENCE_ID, "ends visibly uneven", "OBSERVED");
      const after = createTemporalObservation(seg(200, 205).id, EVIDENCE_ID, "line visibly cleaner", "OBSERVED");
      const result = assessEffect(before, action, after, true);
      expect(result.status).toBe("UNKNOWN");
    });

    it("SUPPORTED never claims causation -- only structural presence with no declared break", () => {
      const before = createTemporalObservation(segment.id, EVIDENCE_ID, "wet", "OBSERVED");
      const after = createTemporalObservation(seg(180, 190).id, EVIDENCE_ID, "dry", "OBSERVED");
      const result = assessEffect(before, action, after, false);
      // The returned shape carries no field named "cause"/"caused"/
      // "causal" -- structurally incapable of asserting causation.
      expect(Object.keys(result).some((key) => key.toLowerCase().includes("caus"))).toBe(false);
    });
  });

  describe("isContinuityBrokenBetween (Section 24/25/26) -- declared only, never auto-detected", () => {
    it("true only for an explicitly declared gap", () => {
      const breaks = [{ beforeSegmentId: "s1", afterSegmentId: "s5" }];
      expect(isContinuityBrokenBetween("s1", "s5", breaks)).toBe(true);
      expect(isContinuityBrokenBetween("s1", "s2", breaks)).toBe(false);
      expect(isContinuityBrokenBetween("s1", "s5", [])).toBe(false);
    });
  });

  describe("summarizeCoreCompletionChain (Section 23) -- missing stage is NOT_OBSERVED, never fabricated", () => {
    it("reports every stage independently, no invented continuity", () => {
      const repetition = assessRepetition([createActionCandidate(["s1"], ["o1"], "CUTTING", "KNOWN", "KNOWN")], "CUTTING");
      const progression = assessProgression([]);
      const summary = summarizeCoreCompletionChain({
        startObserved: true,
        actionObserved: true,
        progression,
        repetition,
        zoneCompletion: "NOT_ESTABLISHED",
        resultObservationPresent: false,
        validationPresent: false,
      });
      expect(summary.START).toBe("OBSERVED");
      expect(summary.ACTION).toBe("OBSERVED");
      expect(summary.PROGRESSION).toBe("NOT_OBSERVED");
      expect(summary.ITERATION).toBe("NOT_OBSERVED");
      expect(summary.ZONE_COMPLETE).toBe("NOT_OBSERVED");
      expect(summary.RESULT).toBe("NOT_OBSERVED");
      expect(summary.VALIDATION).toBe("NOT_OBSERVED");
    });
  });
});
