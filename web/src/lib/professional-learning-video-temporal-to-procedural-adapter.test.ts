import { describe, expect, it } from "vitest";

import { buildProceduralInterpretation } from "@/lib/professional-learning-video-temporal-to-procedural-adapter";
import type { ProfessionalLearningTemporalEvidence } from "@/lib/professional-learning-video-temporal-evidence";

// AI Hair Architect, Professional Skill Engine Stage 8.5T1.4.a -- pure
// tests, zero I/O, zero real Gemini calls. Proves the bridge correctly
// reuses the existing (previously dormant) procedural-reasoning engine
// against World A's real persisted shape, without fabricating anything
// the evidence does not support.
//
// Items 12-15 of this stage's own required proof list (no
// ProfessionalKnowledgeEntry write, no Skill activation, no
// ExecutionPlan creation, no provider/Gemini call) are proven by direct
// code inspection rather than a contrived runtime test: the adapter
// module (professional-learning-video-temporal-to-procedural-
// adapter.ts) imports nothing from professional-knowledge-*.ts,
// professional-skill-*.ts, professional-execution-plan-*.ts, prisma, or
// any Gemini/provider client -- there is nothing in its import graph
// that could perform any of those actions.

function evidence(overrides: Partial<ProfessionalLearningTemporalEvidence>): ProfessionalLearningTemporalEvidence {
  return { observations: [], actions: [], editGaps: [], sourceDurationSeconds: null, ...overrides };
}

describe("buildProceduralInterpretation", () => {
  it("1. persisted temporal evidence enters the existing procedural engine -- one action in, one ordered action out", () => {
    const result = buildProceduralInterpretation("draft-1", evidence({ actions: [{ timeStartSeconds: 0, timeEndSeconds: 6, kind: "COMBING", source: "INFERRED" }] }));
    expect(result?.orderedActions).toHaveLength(1);
    expect(result?.orderedActions[0].action.kind).toBe("COMBING");
    expect(result?.orderedActions[0].absoluteInterval).toEqual({ timeStartSeconds: 0, timeEndSeconds: 6 });
  });

  it("2. ordering is preserved even when the source array is out of order", () => {
    const result = buildProceduralInterpretation(
      "draft-2",
      evidence({
        actions: [
          { timeStartSeconds: 40, timeEndSeconds: 45, kind: "COMBING", source: "INFERRED" },
          { timeStartSeconds: 0, timeEndSeconds: 6, kind: "COMBING", source: "INFERRED" },
          { timeStartSeconds: 15, timeEndSeconds: 20, kind: "COMBING", source: "INFERRED" },
        ],
      }),
    );
    expect(result?.orderedActions.map((e) => e.absoluteInterval.timeStartSeconds)).toEqual([0, 15, 40]);
  });

  it("3. repeated comb/cut cycles produce the expected repetition/iteration representation", () => {
    const result = buildProceduralInterpretation(
      "draft-3",
      evidence({
        actions: [
          { timeStartSeconds: 0, timeEndSeconds: 6, kind: "COMBING", source: "INFERRED" },
          { timeStartSeconds: 7, timeEndSeconds: 14, kind: "CUTTING_ACTION", source: "INFERRED" },
          { timeStartSeconds: 15, timeEndSeconds: 20, kind: "COMBING", source: "INFERRED" },
          { timeStartSeconds: 21, timeEndSeconds: 27, kind: "CUTTING_ACTION", source: "INFERRED" },
          { timeStartSeconds: 28, timeEndSeconds: 33, kind: "COMBING", source: "INFERRED" },
          { timeStartSeconds: 34, timeEndSeconds: 39, kind: "CUTTING_ACTION", source: "INFERRED" },
        ],
      }),
    );
    expect(result?.repetitionByKind.COMBING.occurrenceActionCandidateIds).toHaveLength(3);
    expect(result?.repetitionByKind.CUTTING_ACTION.occurrenceActionCandidateIds).toHaveLength(3);
    expect(result?.coreChainSummary.ITERATION).toBe("SUPPORTED");
  });

  it("4. a generic CUTTING_ACTION does NOT become a specific haircut technique -- kind is carried through verbatim", () => {
    const result = buildProceduralInterpretation("draft-4", evidence({ actions: [{ timeStartSeconds: 0, timeEndSeconds: 6, kind: "CUTTING_ACTION", source: "INFERRED" }] }));
    expect(result?.orderedActions[0].action.kind).toBe("CUTTING_ACTION");
    // Never rewritten into any technique-shaped string.
    expect(result?.orderedActions[0].action.kind).not.toMatch(/interior|one-length|graduated|45/i);
  });

  it("5/6/7. the bridge output carries no professional scalar field at all (elevation/cutting angle/guide authority stay wherever the extraction already left them -- UNKNOWN when absent -- this function never touches them)", () => {
    const result = buildProceduralInterpretation("draft-5", evidence({ actions: [{ timeStartSeconds: 0, timeEndSeconds: 6, kind: "COMBING", source: "INFERRED" }] }));
    expect(JSON.stringify(result)).not.toMatch(/elevation|cuttingAngle|guideAuthority|travelling/i);
  });

  it("8. video end does NOT imply procedure/zone completion, even with many repeated cycles filling the whole clip", () => {
    const actions = Array.from({ length: 5 }, (_, i) => [
      { timeStartSeconds: i * 15, timeEndSeconds: i * 15 + 6, kind: "COMBING", source: "INFERRED" as const },
      { timeStartSeconds: i * 15 + 7, timeEndSeconds: i * 15 + 14, kind: "CUTTING_ACTION", source: "INFERRED" as const },
    ]).flat();
    const result = buildProceduralInterpretation("draft-8", evidence({ actions }));
    expect(result?.zoneCompletionByKind.COMBING).not.toBe("COMPLETED");
    expect(result?.zoneCompletionByKind.CUTTING_ACTION).not.toBe("COMPLETED");
    expect(result?.coreChainSummary.ZONE_COMPLETE).not.toBe("SUPPORTED");
  });

  it("9. edit markers are not converted into professional actions -- they only affect transition classification", () => {
    const result = buildProceduralInterpretation(
      "draft-9",
      evidence({
        actions: [
          { timeStartSeconds: 0, timeEndSeconds: 6, kind: "COMBING", source: "INFERRED" },
          { timeStartSeconds: 40, timeEndSeconds: 46, kind: "COMBING", source: "INFERRED" },
        ],
        editGaps: [{ beforeTimeSeconds: 6, afterTimeSeconds: 40, source: "OBSERVED" }],
      }),
    );
    // Exactly the two real actions -- the edit gap itself never becomes a third action entry.
    expect(result?.orderedActions).toHaveLength(2);
    expect(result?.orderedActions[1].precedingTransition).toBe("DISCONTINUOUS_EDITED");
  });

  it("10a. missing temporal evidence (null) produces an honest null interpretation", () => {
    expect(buildProceduralInterpretation("draft-10a", null)).toBeNull();
  });

  it("10b. temporal evidence with zero actions produces an honest null interpretation", () => {
    expect(buildProceduralInterpretation("draft-10b", evidence({ observations: [{ timeStartSeconds: 0, timeEndSeconds: 5, observation: "x", source: "OBSERVED" }] }))).toBeNull();
  });

  it("11. identical input produces an identical interpretation (deterministic, no randomness/time dependency)", () => {
    const input = evidence({
      actions: [
        { timeStartSeconds: 0, timeEndSeconds: 6, kind: "COMBING", source: "INFERRED" },
        { timeStartSeconds: 7, timeEndSeconds: 14, kind: "CUTTING_ACTION", source: "INFERRED" },
      ],
    });
    const first = buildProceduralInterpretation("draft-11", input);
    const second = buildProceduralInterpretation("draft-11", input);
    expect(first).toEqual(second);
  });
});

// ---------------------------------------------------------------------
// REAL 45 DEGREE INTERIOR REPLAY (Section "REAL 45 DEGREE INTERIOR
// REPLAY TEST") -- a deterministic fixture matching the SHAPE of the
// already-persisted real extraction (5 repeated vertical-section
// cycles of comb -> cut across ~67s), used ONLY as a conceptual replay.
// NO Gemini call, NO reanalysis, NO use of Ionuț's own professional
// explanation as expected truth. The test fails if the bridge ever
// asserts a specific technique identity from this blind shape alone.
// ---------------------------------------------------------------------

const REAL_45_INTERIOR_SHAPED_EVIDENCE: ProfessionalLearningTemporalEvidence = evidence({
  actions: [
    { timeStartSeconds: 0, timeEndSeconds: 6, kind: "COMBING", source: "INFERRED" },
    { timeStartSeconds: 7, timeEndSeconds: 14, kind: "CUTTING_ACTION", source: "INFERRED" },
    { timeStartSeconds: 15, timeEndSeconds: 20, kind: "COMBING", source: "INFERRED" },
    { timeStartSeconds: 21, timeEndSeconds: 27, kind: "CUTTING_ACTION", source: "INFERRED" },
    { timeStartSeconds: 28, timeEndSeconds: 33, kind: "COMBING", source: "INFERRED" },
    { timeStartSeconds: 34, timeEndSeconds: 39, kind: "CUTTING_ACTION", source: "INFERRED" },
    { timeStartSeconds: 40, timeEndSeconds: 45, kind: "COMBING", source: "INFERRED" },
    { timeStartSeconds: 46, timeEndSeconds: 51, kind: "CUTTING_ACTION", source: "INFERRED" },
    { timeStartSeconds: 52, timeEndSeconds: 58, kind: "COMBING", source: "INFERRED" },
    { timeStartSeconds: 59, timeEndSeconds: 66, kind: "CUTTING_ACTION", source: "INFERRED" },
  ],
});

describe("real 45 Interior blind replay (conceptual only, no Gemini call)", () => {
  it("derives ordering + repeated-cycle iteration from the blind evidence alone", () => {
    const result = buildProceduralInterpretation("real-45-interior-draft", REAL_45_INTERIOR_SHAPED_EVIDENCE);
    expect(result).not.toBeNull();
    expect(result?.orderedActions).toHaveLength(10);
    expect(result?.repetitionByKind.COMBING.occurrenceActionCandidateIds).toHaveLength(5);
    expect(result?.repetitionByKind.CUTTING_ACTION.occurrenceActionCandidateIds).toHaveLength(5);
    // Small (<10s) gaps between consecutive real cycles -> continuous, not discontinuous/unknown.
    expect(result?.orderedActions.every((e) => e.precedingTransition === "START" || e.precedingTransition === "ADJACENT")).toBe(true);
    expect(result?.coreChainSummary.ITERATION).toBe("SUPPORTED");
  });

  it("MUST NOT know 45 Interior, One-Length, or Graduated Cutting from the blind evidence alone", () => {
    const result = buildProceduralInterpretation("real-45-interior-draft", REAL_45_INTERIOR_SHAPED_EVIDENCE);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toMatch(/interior|one-length|graduated|45°|45 degree/i);
  });

  it("MUST NOT claim zone completion merely because the clip's own last cycle ends at the video's end", () => {
    const result = buildProceduralInterpretation("real-45-interior-draft", REAL_45_INTERIOR_SHAPED_EVIDENCE);
    expect(result?.zoneCompletionByKind.COMBING).toBe("UNKNOWN");
    expect(result?.zoneCompletionByKind.CUTTING_ACTION).toBe("UNKNOWN");
    expect(result?.coreChainSummary.ZONE_COMPLETE).toBe("NOT_OBSERVED");
    expect(result?.coreChainSummary.PROGRESSION).toBe("UNKNOWN");
  });
});
