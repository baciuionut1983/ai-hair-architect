import { describe, expect, it } from "vitest";

import {
  computeTemporalObservationId,
  computeVideoLearningSegmentId,
  createTemporalObservation,
  createVideoLearningSegment,
  isValidTemporalObservation,
  isValidVideoLearningSegment,
  processSegmentsIndependently,
  toExtractionSegmentReference,
} from "./professional-learning-video-segmentation";

const EVIDENCE_ID = "evidence-1";
const INTERVAL = { timeStartSeconds: 10, timeEndSeconds: 18.5 };
const VERSION = "seg-v1";

describe("professional-learning-video-segmentation (Stage 8.5L5)", () => {
  describe("VideoLearningSegment identity / idempotency (Section 9/50)", () => {
    it("identical inputs always produce the identical id -- deterministic, not random", () => {
      const a = createVideoLearningSegment(EVIDENCE_ID, INTERVAL, VERSION);
      const b = createVideoLearningSegment(EVIDENCE_ID, INTERVAL, VERSION);
      expect(a.id).toBe(b.id);
      expect(a).toEqual(b);
    });

    it("a different interval, evidence, or segmentation version produces a different id", () => {
      const base = createVideoLearningSegment(EVIDENCE_ID, INTERVAL, VERSION);
      expect(createVideoLearningSegment("evidence-2", INTERVAL, VERSION).id).not.toBe(base.id);
      expect(createVideoLearningSegment(EVIDENCE_ID, { timeStartSeconds: 0, timeEndSeconds: 5 }, VERSION).id).not.toBe(base.id);
      expect(createVideoLearningSegment(EVIDENCE_ID, INTERVAL, "seg-v2").id).not.toBe(base.id);
    });

    it("isValidVideoLearningSegment is a structural + tamper-evidence check", () => {
      const segment = createVideoLearningSegment(EVIDENCE_ID, INTERVAL, VERSION);
      expect(isValidVideoLearningSegment(segment)).toBe(true);
      expect(isValidVideoLearningSegment({ ...segment, id: "spoofed-id" })).toBe(false);
      expect(isValidVideoLearningSegment({ ...segment, interval: { timeStartSeconds: 5, timeEndSeconds: 4 } })).toBe(false);
      expect(isValidVideoLearningSegment(null)).toBe(false);
    });

    it("computeVideoLearningSegmentId matches what createVideoLearningSegment assigns", () => {
      const id = computeVideoLearningSegmentId(EVIDENCE_ID, INTERVAL, VERSION);
      expect(createVideoLearningSegment(EVIDENCE_ID, INTERVAL, VERSION).id).toBe(id);
    });
  });

  describe("toExtractionSegmentReference -- interop with the existing Stage 8.5L4 shape", () => {
    it("converts a segment to the canonical ProfessionalLearningExtractionSegmentReference shape", () => {
      const segment = createVideoLearningSegment(EVIDENCE_ID, INTERVAL, VERSION);
      const reference = toExtractionSegmentReference(segment, "comb passes root to tip", 0.9, { confidence: 0.8, frameReferences: ["frame-1"] });
      expect(reference).toEqual({
        timeStartSeconds: 10,
        timeEndSeconds: 18.5,
        relevance: 0.9,
        observations: "comb passes root to tip",
        confidence: 0.8,
        frameReferences: ["frame-1"],
      });
    });

    it("omits optional fields entirely when not supplied, never writing literal undefined", () => {
      const segment = createVideoLearningSegment(EVIDENCE_ID, INTERVAL, VERSION);
      const reference = toExtractionSegmentReference(segment, "obs", 0.5);
      expect(Object.keys(reference).sort()).toEqual(["observations", "relevance", "timeEndSeconds", "timeStartSeconds"].sort());
    });
  });

  describe("TemporalObservation (Section 10/11) -- OBSERVATION != ACTION, always traceable", () => {
    it("carries segmentId + sourceEvidenceId always -- never detachable/authoritative on its own", () => {
      const segment = createVideoLearningSegment(EVIDENCE_ID, INTERVAL, VERSION);
      const observation = createTemporalObservation(segment.id, EVIDENCE_ID, "scissors visibly close", "OBSERVED");
      expect(observation.segmentId).toBe(segment.id);
      expect(observation.sourceEvidenceId).toBe(EVIDENCE_ID);
      expect(isValidTemporalObservation(observation)).toBe(true);
    });

    it("identical (segment, description, extractorVersion) is idempotent -- reprocessing never duplicates knowledge (Section 50)", () => {
      const a = createTemporalObservation("seg-1", EVIDENCE_ID, "scissors visibly close", "OBSERVED", "extractor-v1");
      const b = createTemporalObservation("seg-1", EVIDENCE_ID, "scissors visibly close", "OBSERVED", "extractor-v1");
      expect(a.id).toBe(b.id);
      expect(computeTemporalObservationId("seg-1", "scissors visibly close", "extractor-v1")).toBe(a.id);
    });

    it("preserves OBSERVED/INFERRED/PROFESSIONAL_INPUT/UNKNOWN provenance distinctly -- reuses the existing vocabulary, no parallel one", () => {
      const segment = createVideoLearningSegment(EVIDENCE_ID, INTERVAL, VERSION);
      for (const provenance of ["OBSERVED", "INFERRED", "PROFESSIONAL_INPUT", "UNKNOWN"] as const) {
        const observation = createTemporalObservation(segment.id, EVIDENCE_ID, "x", provenance);
        expect(observation.provenance).toBe(provenance);
        expect(isValidTemporalObservation(observation)).toBe(true);
      }
    });

    it("rejects an invalid provenance, missing segmentId/sourceEvidenceId, or a spoofed id", () => {
      const segment = createVideoLearningSegment(EVIDENCE_ID, INTERVAL, VERSION);
      const valid = createTemporalObservation(segment.id, EVIDENCE_ID, "x", "OBSERVED");
      expect(isValidTemporalObservation({ ...valid, provenance: "MADE_UP" })).toBe(false);
      expect(isValidTemporalObservation({ ...valid, segmentId: "" })).toBe(false);
      expect(isValidTemporalObservation({ ...valid, sourceEvidenceId: "" })).toBe(false);
      expect(isValidTemporalObservation({ ...valid, id: "spoofed" })).toBe(false);
    });
  });

  describe("processSegmentsIndependently -- failure isolation (Section 49)", () => {
    it("one segment's processor throwing never discards or mutates another segment's success", () => {
      const s1 = createVideoLearningSegment(EVIDENCE_ID, { timeStartSeconds: 0, timeEndSeconds: 5 }, VERSION);
      const s2 = createVideoLearningSegment(EVIDENCE_ID, { timeStartSeconds: 5, timeEndSeconds: 10 }, VERSION);
      const s3 = createVideoLearningSegment(EVIDENCE_ID, { timeStartSeconds: 10, timeEndSeconds: 15 }, VERSION);
      const s4 = createVideoLearningSegment(EVIDENCE_ID, { timeStartSeconds: 15, timeEndSeconds: 20 }, VERSION);

      const outcome = processSegmentsIndependently([s1, s2, s3, s4], (segment) => {
        if (segment.id === s3.id) throw new Error("boom");
        return `ok:${segment.id}`;
      });

      expect(outcome.succeeded.map((s) => s.segmentId)).toEqual([s1.id, s2.id, s4.id]);
      expect(outcome.failed).toEqual([{ segmentId: s3.id, error: "boom" }]);
    });

    it("reprocessing only the failed segment does not require re-touching the others", () => {
      const s1 = createVideoLearningSegment(EVIDENCE_ID, { timeStartSeconds: 0, timeEndSeconds: 5 }, VERSION);
      const s3 = createVideoLearningSegment(EVIDENCE_ID, { timeStartSeconds: 10, timeEndSeconds: 15 }, VERSION);

      const first = processSegmentsIndependently([s1, s3], (segment) => {
        if (segment.id === s3.id) throw new Error("boom");
        return "ok";
      });
      expect(first.failed.map((f) => f.segmentId)).toEqual([s3.id]);

      const retry = processSegmentsIndependently([s3], () => "ok-now");
      expect(retry.succeeded).toEqual([{ segmentId: s3.id, result: "ok-now" }]);
      expect(retry.failed).toEqual([]);
    });
  });
});
