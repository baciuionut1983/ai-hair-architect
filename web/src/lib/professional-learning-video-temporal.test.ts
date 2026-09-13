import { describe, expect, it } from "vitest";

import {
  computeVideoTimeIntervalOrder,
  isProfessionalLearningTemporalRelation,
  isValidVideoTimeInterval,
  isVideoTimeIntervalOrder,
  PROFESSIONAL_LEARNING_TEMPORAL_RELATIONS,
  sortByStartTimeStable,
  videoTimeIntervalDurationSeconds,
} from "./professional-learning-video-temporal";

describe("professional-learning-video-temporal (Stage 8.5L5)", () => {
  describe("isValidVideoTimeInterval", () => {
    it("Part 1: accepts a well-formed interval", () => {
      expect(isValidVideoTimeInterval({ timeStartSeconds: 10, timeEndSeconds: 18.5 })).toBe(true);
    });

    it("Part 2: rejects an invalid interval (end <= start, negative start, non-finite, wrong shape)", () => {
      expect(isValidVideoTimeInterval({ timeStartSeconds: 10, timeEndSeconds: 10 })).toBe(false);
      expect(isValidVideoTimeInterval({ timeStartSeconds: 10, timeEndSeconds: 5 })).toBe(false);
      expect(isValidVideoTimeInterval({ timeStartSeconds: -1, timeEndSeconds: 5 })).toBe(false);
      expect(isValidVideoTimeInterval({ timeStartSeconds: Infinity, timeEndSeconds: 5 })).toBe(false);
      expect(isValidVideoTimeInterval(null)).toBe(false);
      expect(isValidVideoTimeInterval("not an interval")).toBe(false);
      expect(isValidVideoTimeInterval({})).toBe(false);
    });

    it("computes duration", () => {
      expect(videoTimeIntervalDurationSeconds({ timeStartSeconds: 10, timeEndSeconds: 18.5 })).toBeCloseTo(8.5);
    });
  });

  describe("computeVideoTimeIntervalOrder -- pure interval math only", () => {
    it("BEFORE when a ends at or before b starts", () => {
      expect(computeVideoTimeIntervalOrder({ timeStartSeconds: 0, timeEndSeconds: 10 }, { timeStartSeconds: 10, timeEndSeconds: 20 })).toBe("BEFORE");
    });

    it("AFTER when b ends at or before a starts", () => {
      expect(computeVideoTimeIntervalOrder({ timeStartSeconds: 10, timeEndSeconds: 20 }, { timeStartSeconds: 0, timeEndSeconds: 10 })).toBe("AFTER");
    });

    it("OVERLAPS when the intervals share time", () => {
      expect(computeVideoTimeIntervalOrder({ timeStartSeconds: 0, timeEndSeconds: 15 }, { timeStartSeconds: 10, timeEndSeconds: 20 })).toBe("OVERLAPS");
    });

    it("UNKNOWN for an invalid interval on either side -- never throws, never guesses", () => {
      expect(computeVideoTimeIntervalOrder({ timeStartSeconds: NaN, timeEndSeconds: 20 }, { timeStartSeconds: 0, timeEndSeconds: 10 })).toBe("UNKNOWN");
      expect(isVideoTimeIntervalOrder("UNKNOWN")).toBe(true);
    });

    it("never returns CONTINUES or REPEATS -- those are domain-asserted only, not pure time math", () => {
      const relation = computeVideoTimeIntervalOrder({ timeStartSeconds: 0, timeEndSeconds: 10 }, { timeStartSeconds: 10, timeEndSeconds: 20 });
      expect(relation).not.toBe("CONTINUES");
      expect(relation).not.toBe("REPEATS");
    });
  });

  it("PROFESSIONAL_LEARNING_TEMPORAL_RELATIONS is the full closed vocabulary including domain-asserted-only values", () => {
    expect(PROFESSIONAL_LEARNING_TEMPORAL_RELATIONS).toContain("CONTINUES");
    expect(PROFESSIONAL_LEARNING_TEMPORAL_RELATIONS).toContain("REPEATS");
    expect(isProfessionalLearningTemporalRelation("REPEATS")).toBe(true);
    expect(isProfessionalLearningTemporalRelation("INVENTED")).toBe(false);
  });

  describe("sortByStartTimeStable (Section 51)", () => {
    it("orders by start time", () => {
      const items = [
        { id: "b", interval: { timeStartSeconds: 10, timeEndSeconds: 20 } },
        { id: "a", interval: { timeStartSeconds: 0, timeEndSeconds: 10 } },
      ];
      expect(sortByStartTimeStable(items).map((i) => i.id)).toEqual(["a", "b"]);
    });

    it("falls back to a deterministic id tiebreak when start times are identical -- never invents sub-second precision", () => {
      const items = [
        { id: "z", interval: { timeStartSeconds: 5, timeEndSeconds: 20 } },
        { id: "a", interval: { timeStartSeconds: 5, timeEndSeconds: 15 } },
      ];
      const result = sortByStartTimeStable(items);
      expect(result.map((i) => i.id)).toEqual(["a", "z"]);
      // Idempotent: re-sorting an already-sorted (or differently-ordered)
      // input always yields the same canonical order.
      expect(sortByStartTimeStable([...items].reverse()).map((i) => i.id)).toEqual(["a", "z"]);
    });
  });
});
