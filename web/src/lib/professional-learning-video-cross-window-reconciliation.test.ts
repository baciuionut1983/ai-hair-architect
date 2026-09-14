import { describe, expect, it } from "vitest";

import { detectResultObservationCandidates, detectValidationCandidates, reconcileLongVideoWindows, reconcileWindowResult } from "./professional-learning-video-cross-window-reconciliation";
import { planLongVideoWindows } from "./professional-learning-video-long-window-planner";
import type { ProfessionalLearningExtractorOutput } from "./professional-learning-extractor";

const SOURCE = "evidence-long-1";
const VERSION = "gemini-long-video-window-v1";

function emptyOutput(overrides: Partial<ProfessionalLearningExtractorOutput> = {}): ProfessionalLearningExtractorOutput {
  return {
    discernment: { category: "PROFESSIONAL_TECHNIQUE", reason: "test" },
    extraction: {},
    comparisonSkillIdHint: null,
    relatedSkillIdHints: [],
    temporalObservations: [],
    actionCandidates: [],
    notableEditsOrCuts: [],
    ...overrides,
  };
}

describe("professional-learning-video-cross-window-reconciliation (Stage 8.5L5.R2)", () => {
  const plan = planLongVideoWindows({ sourceEvidenceId: SOURCE, totalDurationSeconds: 400, windowCount: 3, contextMarginSeconds: 20, segmentationVersion: "v1" });
  // core: [0,133) [133,267) [267,400); context: [0,153) [113,287) [247,400)

  describe("reconcileWindowResult -- ownership / deduplication (Section 17/43/56.6-8)", () => {
    it("keeps an observation whose absolute start falls inside this window's own core", () => {
      const window = plan.windows[1]; // core [133,267), context [113,287)
      // relative time 30 within a [113,287) window -> absolute 143, inside core
      const raw = emptyOutput({ temporalObservations: [{ timeStartSeconds: 30, timeEndSeconds: 35, observation: "comb passes through a section" }] });
      const result = reconcileWindowResult(SOURCE, window, raw, VERSION);
      expect(result.observations).toHaveLength(1);
      expect(result.segments[0].interval).toEqual({ timeStartSeconds: 143, timeEndSeconds: 148 });
    });

    it("Section 56.6/7: drops an observation whose absolute time falls only in the context (overlap) portion -- owned by a neighboring window instead", () => {
      const window = plan.windows[1]; // core [133,267), context [113,287)
      // relative time 5 -> absolute 118, which is context-only (before core start 133)
      const raw = emptyOutput({ temporalObservations: [{ timeStartSeconds: 5, timeEndSeconds: 8, observation: "context-only observation" }] });
      const result = reconcileWindowResult(SOURCE, window, raw, VERSION);
      expect(result.observations).toHaveLength(0);
    });

    it("overlapping windows never produce a duplicate observation for the same absolute moment (Section 56.7/8)", () => {
      const windowA = plan.windows[0]; // core [0,133), context [0,153)
      const windowB = plan.windows[1]; // core [133,267), context [113,287)
      // The SAME real moment (absolute 140) appears in BOTH windows' raw
      // context, but only window B's core owns it.
      const rawA = emptyOutput({ temporalObservations: [{ timeStartSeconds: 140, timeEndSeconds: 145, observation: "same real moment, seen from window A's own context" }] });
      const rawB = emptyOutput({ temporalObservations: [{ timeStartSeconds: 27, timeEndSeconds: 32, observation: "same real moment, seen from window B's own core" }] });
      const resultA = reconcileWindowResult(SOURCE, windowA, rawA, VERSION);
      const resultB = reconcileWindowResult(SOURCE, windowB, rawB, VERSION);
      expect(resultA.observations).toHaveLength(0); // absolute 140 is outside A's own core [0,133)
      expect(resultB.observations).toHaveLength(1);
    });

    it("action candidates are filtered by the same core-ownership rule, and gain the observations that share their segment", () => {
      const window = plan.windows[0];
      const raw = emptyOutput({
        temporalObservations: [{ timeStartSeconds: 10, timeEndSeconds: 15, observation: "scissors visibly close" }],
        actionCandidates: [{ timeStartSeconds: 10, timeEndSeconds: 15, kind: "CUTTING_ACTION" }],
      });
      const result = reconcileWindowResult(SOURCE, window, raw, VERSION);
      expect(result.actionCandidates).toHaveLength(1);
      expect(result.actionCandidates[0].observationIds).toEqual(result.observations.map((o) => o.id));
    });

    it("an edit gap is owned by whichever window's core contains its 'before' point", () => {
      const window = plan.windows[0]; // core [0,133), context [0,153)
      // relative 120->125 => absolute before=120 (inside core), after=125
      const raw = emptyOutput({ notableEditsOrCuts: [{ beforeTimeSeconds: 120, afterTimeSeconds: 125 }] });
      const result = reconcileWindowResult(SOURCE, window, raw, VERSION);
      expect(result.editGaps).toEqual([{ beforeTimeSeconds: 120, afterTimeSeconds: 125 }]);
    });
  });

  describe("Section 18/6: reference-dependency candidates are always unestablished from this blind pass", () => {
    it("a mention of a reference-indicating phrase produces a candidate, but it is never `established`", () => {
      const window = plan.windows[0];
      const raw = emptyOutput({ temporalObservations: [{ timeStartSeconds: 10, timeEndSeconds: 15, observation: "the strand appears cut using the previous section as a guide" }] });
      const result = reconcileWindowResult(SOURCE, window, raw, VERSION);
      expect(result.referenceDependencyCandidates).toHaveLength(1);
      expect(result.referenceDependencyCandidates[0].established).toBe(false);
      expect(result.referenceDependencyCandidates[0].provenance).toBe("INFERRED");
    });

    it("plain observation text with no reference-indicating phrase produces zero candidates", () => {
      const window = plan.windows[0];
      const raw = emptyOutput({ temporalObservations: [{ timeStartSeconds: 10, timeEndSeconds: 15, observation: "scissors visibly close near the ends" }] });
      const result = reconcileWindowResult(SOURCE, window, raw, VERSION);
      expect(result.referenceDependencyCandidates).toHaveLength(0);
    });
  });

  describe("Section 27/28: result/validation candidate detection is narrow-mention-only, never a professional confirmation", () => {
    it("detects a result-mention candidate but this is only a candidate, not proof", () => {
      const window = plan.windows[2]; // core [267,400), context [247,400) -> relative 25 => absolute 272, inside core
      const raw = emptyOutput({ temporalObservations: [{ timeStartSeconds: 25, timeEndSeconds: 30, observation: "the finished look is shown to the camera" }] });
      const result = reconcileWindowResult(SOURCE, window, raw, VERSION);
      expect(detectResultObservationCandidates(result.observations)).toHaveLength(1);
    });

    it("detects a validation-mention candidate", () => {
      const window = plan.windows[2];
      const raw = emptyOutput({ temporalObservations: [{ timeStartSeconds: 25, timeEndSeconds: 30, observation: "operator checks symmetry on both sides" }] });
      const result = reconcileWindowResult(SOURCE, window, raw, VERSION);
      expect(detectValidationCandidates(result.observations)).toHaveLength(1);
    });

    it("plain observations with no such phrases produce zero candidates of either kind", () => {
      const window = plan.windows[2];
      const raw = emptyOutput({ temporalObservations: [{ timeStartSeconds: 25, timeEndSeconds: 30, observation: "scissors visibly close near the ends" }] });
      const result = reconcileWindowResult(SOURCE, window, raw, VERSION);
      expect(detectResultObservationCandidates(result.observations)).toHaveLength(0);
      expect(detectValidationCandidates(result.observations)).toHaveLength(0);
    });
  });

  describe("reconcileLongVideoWindows -- global merge + continuity (Section 13/43/44)", () => {
    it("merges near-identical edit gaps reported by two different windows into one", () => {
      const rawByWindow = new Map<string, ProfessionalLearningExtractorOutput>([
        [plan.windows[0].id, emptyOutput({ notableEditsOrCuts: [{ beforeTimeSeconds: 130, afterTimeSeconds: 132 }] })], // absolute before=130, in window0's core
        [plan.windows[1].id, emptyOutput()],
        [plan.windows[2].id, emptyOutput()],
      ]);
      const result = reconcileLongVideoWindows(SOURCE, plan.windows, rawByWindow, VERSION);
      expect(result.editGaps).toHaveLength(1);
    });

    it("Section 13: a boundary spanned by a reconciled edit gap is DISCONTINUOUS_EDITED", () => {
      const rawByWindow = new Map<string, ProfessionalLearningExtractorOutput>([
        [plan.windows[0].id, emptyOutput({ notableEditsOrCuts: [{ beforeTimeSeconds: 132, afterTimeSeconds: 134 }] })], // spans the 133 boundary
        [plan.windows[1].id, emptyOutput()],
        [plan.windows[2].id, emptyOutput()],
      ]);
      const result = reconcileLongVideoWindows(SOURCE, plan.windows, rawByWindow, VERSION);
      expect(result.continuityByBoundary[0].state).toBe("DISCONTINUOUS_EDITED");
    });

    it("Section 13: matching action kind across a boundary with NO edit gap yields the weak POSSIBLY_CONTINUES signal, never a hard CONTINUES", () => {
      // window0 core [0,133); window1 core [133,267) context [113,287) ->
      // relative 23 within window1's context = absolute 136, safely
      // inside window1's OWN core (just after the 133 boundary).
      const rawByWindow = new Map<string, ProfessionalLearningExtractorOutput>([
        [plan.windows[0].id, emptyOutput({ temporalObservations: [{ timeStartSeconds: 125, timeEndSeconds: 130, observation: "cutting" }], actionCandidates: [{ timeStartSeconds: 125, timeEndSeconds: 130, kind: "CUTTING_ACTION" }] })],
        [
          plan.windows[1].id,
          emptyOutput({ temporalObservations: [{ timeStartSeconds: 23, timeEndSeconds: 28, observation: "cutting continues" }], actionCandidates: [{ timeStartSeconds: 23, timeEndSeconds: 28, kind: "CUTTING_ACTION" }] }),
        ],
        [plan.windows[2].id, emptyOutput()],
      ]);
      const result = reconcileLongVideoWindows(SOURCE, plan.windows, rawByWindow, VERSION);
      expect(result.continuityByBoundary[0].state).toBe("POSSIBLY_CONTINUES");
      expect(result.continuityByBoundary[0].state).not.toBe("CONTINUES");
    });

    it("no edit gap and no matching action kind across a boundary -> UNKNOWN, never guessed", () => {
      const rawByWindow = new Map<string, ProfessionalLearningExtractorOutput>([
        [plan.windows[0].id, emptyOutput({ temporalObservations: [{ timeStartSeconds: 125, timeEndSeconds: 130, observation: "combing" }], actionCandidates: [{ timeStartSeconds: 125, timeEndSeconds: 130, kind: "COMBING" }] })],
        [
          plan.windows[1].id,
          emptyOutput({ temporalObservations: [{ timeStartSeconds: 23, timeEndSeconds: 28, observation: "inspection" }], actionCandidates: [{ timeStartSeconds: 23, timeEndSeconds: 28, kind: "INSPECTION" }] }),
        ],
        [plan.windows[2].id, emptyOutput()],
      ]);
      const result = reconcileLongVideoWindows(SOURCE, plan.windows, rawByWindow, VERSION);
      expect(result.continuityByBoundary[0].state).toBe("UNKNOWN");
    });

    it("a window with no captured raw result (e.g. a permanently failed call) is simply absent from the merge -- never fabricated", () => {
      const rawByWindow = new Map<string, ProfessionalLearningExtractorOutput>([
        [plan.windows[0].id, emptyOutput({ temporalObservations: [{ timeStartSeconds: 10, timeEndSeconds: 15, observation: "x" }] })],
        // window[1] intentionally missing
        [plan.windows[2].id, emptyOutput()],
      ]);
      const result = reconcileLongVideoWindows(SOURCE, plan.windows, rawByWindow, VERSION);
      expect(result.observations).toHaveLength(1);
    });
  });
});
