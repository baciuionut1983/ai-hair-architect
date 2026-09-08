import { describe, expect, it } from "vitest";

import { isRecord } from "@/lib/technical-visual-map-validators";
import * as atomicActionModule from "@/lib/professional-skill-atomic-action-contracts";
import {
  isAtomicActionEligibleForAuthority,
  isValidAtomicAction,
  isValidAtomicActionSequence,
  type AtomicAction,
} from "@/lib/professional-skill-atomic-action-contracts";

// SYNTHETIC TEST FIXTURE -- NOT REAL PROFESSIONAL AUTHORITY. Every fact
// name, zone label, parameter name, and presentation string below is an
// invented placeholder for structural contract testing only.

type SyntheticFact = "handedness" | "anatomicalThresholdCrossed" | "branchIntent";
function isSyntheticFact(value: unknown): value is SyntheticFact {
  return value === "handedness" || value === "anatomicalThresholdCrossed" || value === "branchIntent";
}

interface SyntheticCuttingPayload {
  zoneLabel: string;
}
function isSyntheticCuttingPayload(value: unknown): value is SyntheticCuttingPayload {
  return isRecord(value) && typeof value.zoneLabel === "string";
}

interface SyntheticColorPayload {
  shadeFamily: string;
}
function isSyntheticColorPayload(value: unknown): value is SyntheticColorPayload {
  return isRecord(value) && typeof value.shadeFamily === "string";
}

function baseAction(overrides: Partial<AtomicAction<SyntheticFact>> = {}): AtomicAction<SyntheticFact> {
  return {
    atomicActionId: "aa-synthetic-cut",
    vertical: "synthetic_cutting",
    order: 1,
    actionKind: "EXECUTE",
    sourceExecutionUnitId: "eu-synthetic-posterior",
    sourceSkillId: "skill-synthetic-structural",
    sourceSkillVersion: 1,
    boundParameterNames: ["syntheticElevation"],
    presentationSummary: "SYNTHETIC -- cut along established guide",
    compiledAt: "2026-09-08T00:00:00.000Z",
    ...overrides,
  };
}

describe("Atomic Action contract (Stage 2.5.i.4, SYNTHETIC FIXTURES ONLY)", () => {
  it("1. validates a well-formed synthetic Atomic Action", () => {
    expect(isValidAtomicAction(baseAction(), isSyntheticFact)).toBe(true);
  });

  it("2. validates an ordered sequence of Atomic Actions compiled from one Execution Unit", () => {
    const actions: AtomicAction<SyntheticFact>[] = [
      baseAction({ atomicActionId: "aa-1", order: 1, actionKind: "PREPARE", boundParameterNames: ["syntheticGuideType"] }),
      baseAction({ atomicActionId: "aa-2", order: 2, actionKind: "EXECUTE", boundParameterNames: ["syntheticElevation"] }),
      baseAction({
        atomicActionId: "aa-3",
        order: 3,
        actionKind: "VERIFY",
        observationCriterion: { fact: "syntheticGuideVisible", expectedValue: true, evidenceStatus: "DEMONSTRATED_TARGET" },
      }),
    ];
    expect(actions.every((a) => isValidAtomicAction(a, isSyntheticFact))).toBe(true);
    expect(isValidAtomicActionSequence(actions)).toBe(true);
  });

  it("3. traces every Atomic Action back to a source Execution Unit + Skill provenance; a mixed-source array is rejected", () => {
    expect(isValidAtomicAction(baseAction({ sourceExecutionUnitId: "" }), isSyntheticFact)).toBe(false);
    expect(isValidAtomicAction(baseAction({ sourceSkillId: "" }), isSyntheticFact)).toBe(false);
    expect(isValidAtomicAction(baseAction({ sourceSkillVersion: 0 }), isSyntheticFact)).toBe(false);

    const mixedUnit = [
      baseAction({ atomicActionId: "aa-1", order: 1, sourceExecutionUnitId: "eu-a" }),
      baseAction({ atomicActionId: "aa-2", order: 2, sourceExecutionUnitId: "eu-b" }),
    ];
    expect(isValidAtomicActionSequence(mixedUnit)).toBe(false);
  });

  it("4. represents vertical-specific payload as an isolated, caller-validated shape", () => {
    const cuttingAction = baseAction({ verticalPayload: { zoneLabel: "synthetic-nape" } });
    expect(isValidAtomicAction(cuttingAction, isSyntheticFact, isSyntheticCuttingPayload)).toBe(true);
  });

  it("5. rejects a bare parameter-shaped object masquerading as an Atomic Action", () => {
    const bareParameter = {
      parameterName: "syntheticElevation",
      semantic: "REQUIRED_FIXED",
      fixedValue: "synthetic_0_deg",
      rationale: "SYNTHETIC placeholder.",
    };
    expect(isValidAtomicAction(bareParameter, isSyntheticFact)).toBe(false);
  });

  it("6. distinguishes a typed state transition from the action itself, only where the action kind changes something", () => {
    const positionAction = baseAction({
      actionKind: "POSITION",
      boundParameterNames: undefined,
      stateTransition: { fact: "syntheticClientHeadPosition", fromValue: "neutral", toValue: "tilted_forward" },
    });
    expect(isValidAtomicAction(positionAction, isSyntheticFact)).toBe(true);

    // A stateTransition attached to an OBSERVE/VERIFY-kind action is a
    // structural contradiction -- observation never changes state.
    const invalidObserveWithState = baseAction({
      actionKind: "VERIFY",
      stateTransition: { fact: "x", toValue: "y" },
      observationCriterion: { fact: "syntheticGuideVisible", expectedValue: true, evidenceStatus: "DEMONSTRATED_TARGET" },
    });
    expect(isValidAtomicAction(invalidObserveWithState, isSyntheticFact)).toBe(false);
  });

  it("7. requires a typed observation criterion for OBSERVE/VERIFY kinds, never a bare unwrapped fact", () => {
    const missingCriterion = baseAction({ actionKind: "OBSERVE", boundParameterNames: undefined });
    expect(isValidAtomicAction(missingCriterion, isSyntheticFact)).toBe(false);

    const withCriterion = baseAction({
      actionKind: "OBSERVE",
      boundParameterNames: undefined,
      observationCriterion: { fact: "syntheticGuideVisible", expectedValue: true, evidenceStatus: "RUNTIME_PROFESSIONAL_OBSERVATION" },
    });
    expect(isValidAtomicAction(withCriterion, isSyntheticFact)).toBe(true);
  });

  it("8. supports a typed, closed precondition using the reused SkillCondition language", () => {
    const gated = baseAction({ precondition: { op: "equals", fact: "branchIntent", value: "none" } });
    expect(isValidAtomicAction(gated, isSyntheticFact)).toBe(true);
  });

  it("9. rejects any precondition op outside the closed operator set and any free-form/executable expression", () => {
    const invalidOp = baseAction({ precondition: { op: "eval", expression: "1===1" } as unknown as AtomicAction<SyntheticFact>["precondition"] });
    expect(isValidAtomicAction(invalidOp, isSyntheticFact)).toBe(false);

    const executableString = baseAction({ precondition: "return true" as unknown as AtomicAction<SyntheticFact>["precondition"] });
    expect(isValidAtomicAction(executableString, isSyntheticFact)).toBe(false);
  });

  it("10. supports deterministic dependency references between Atomic Actions, including an observation gate preceding the next action", () => {
    const actions: AtomicAction<SyntheticFact>[] = [
      baseAction({
        atomicActionId: "aa-1",
        order: 1,
        actionKind: "OBSERVE",
        boundParameterNames: undefined,
        observationCriterion: { fact: "syntheticGuideVisible", expectedValue: true, evidenceStatus: "RUNTIME_PROFESSIONAL_OBSERVATION" },
      }),
      baseAction({ atomicActionId: "aa-2", order: 2, requiresActionIds: ["aa-1"] }),
    ];
    expect(isValidAtomicActionSequence(actions)).toBe(true);
  });

  it("11. rejects a self-referencing, dangling, cyclic, non-contiguous, or duplicate-id dependency structure", () => {
    expect(isValidAtomicAction(baseAction({ atomicActionId: "aa-self", requiresActionIds: ["aa-self"] }), isSyntheticFact)).toBe(false);

    const dangling = [baseAction({ atomicActionId: "aa-1", order: 1, requiresActionIds: ["aa-does-not-exist"] })];
    expect(isValidAtomicActionSequence(dangling)).toBe(false);

    const cyclic = [
      baseAction({ atomicActionId: "aa-1", order: 1, requiresActionIds: ["aa-2"] }),
      baseAction({ atomicActionId: "aa-2", order: 2, requiresActionIds: ["aa-1"] }),
    ];
    expect(isValidAtomicActionSequence(cyclic)).toBe(false);

    const nonContiguous = [baseAction({ atomicActionId: "aa-1", order: 1 }), baseAction({ atomicActionId: "aa-2", order: 3 })];
    expect(isValidAtomicActionSequence(nonContiguous)).toBe(false);

    const duplicateIds = [baseAction({ atomicActionId: "aa-1", order: 1 }), baseAction({ atomicActionId: "aa-1", order: 2 })];
    expect(isValidAtomicActionSequence(duplicateIds)).toBe(false);

    expect(isValidAtomicActionSequence([])).toBe(false);
  });

  it("12. carries no persistence field or independent authority -- module exports name no Prisma/persistence/authority-authoring concept", () => {
    const exported = Object.keys(atomicActionModule);
    expect(exported).not.toContain("createAtomicAction");
    expect(exported).not.toContain("saveAtomicAction");
    expect(exported).not.toContain("ATOMIC_ACTION_STATUSES");
    expect(exported).not.toContain("AtomicActionAuthorityType");
  });

  it("13. requires the full provenance chain (sourceSkillId, sourceSkillVersion, sourceExecutionUnitId) on every Atomic Action", () => {
    expect(isValidAtomicAction(baseAction(), isSyntheticFact)).toBe(true);
    expect(isValidAtomicAction(baseAction({ sourceSkillVersion: 1.5 }), isSyntheticFact)).toBe(false);
  });

  it("14. rejects a cross-vertical payload shape against the wrong vertical's own validator", () => {
    const colorShaped = baseAction({ verticalPayload: { shadeFamily: "synthetic-cool-ash" } });
    expect(isValidAtomicAction(colorShaped, isSyntheticFact, isSyntheticCuttingPayload)).toBe(false);

    const cuttingShaped = baseAction({ verticalPayload: { zoneLabel: "synthetic-nape" } });
    expect(isValidAtomicAction(cuttingShaped, isSyntheticFact, isSyntheticColorPayload)).toBe(false);
  });

  it("15. supports a closed, bounded repetition model without requiring one row per repetition", () => {
    const overSubsections = baseAction({ iteration: { mode: "OVER_ORDERED_SUBSECTIONS", note: "SYNTHETIC -- repeats per subsection release." } });
    expect(isValidAtomicAction(overSubsections, isSyntheticFact)).toBe(true);

    const untilComplete = baseAction({ iteration: { mode: "UNTIL_EXECUTION_UNIT_COMPLETE" } });
    expect(isValidAtomicAction(untilComplete, isSyntheticFact)).toBe(true);

    const fixedCount = baseAction({ iteration: { mode: "FIXED_COUNT", count: 3 } });
    expect(isValidAtomicAction(fixedCount, isSyntheticFact)).toBe(true);

    const fixedCountMissingCount = baseAction({
      iteration: { mode: "FIXED_COUNT" } as unknown as AtomicAction<SyntheticFact>["iteration"],
    });
    expect(isValidAtomicAction(fixedCountMissingCount, isSyntheticFact)).toBe(false);

    const nonFixedWithCount = baseAction({
      iteration: { mode: "UNTIL_EXECUTION_UNIT_COMPLETE", count: 5 } as unknown as AtomicAction<SyntheticFact>["iteration"],
    });
    expect(isValidAtomicAction(nonFixedWithCount, isSyntheticFact)).toBe(false);

    // ONE Atomic Action record represents the whole repeated operation --
    // nothing in this contract requires repetition to imply multiple
    // AtomicAction objects.
    expect(isValidAtomicActionSequence([overSubsections])).toBe(true);
  });

  it("16. never requires decomposing a single real action into multiple artificial ones", () => {
    // Unlike SkillDefinition.procedure (>= 2 steps required), a sequence
    // of exactly ONE Atomic Action covering a whole coherent operation is
    // fully valid -- no forced artificial splitting to reach a minimum.
    expect(isValidAtomicActionSequence([baseAction()])).toBe(true);
  });

  it("17. never reads presentation text as technical authority -- only emptiness is checked, content is never interpreted", () => {
    const nonsensicalLabel = baseAction({ presentationSummary: "SYNTHETIC -- zzz not a real technique description at all" });
    expect(isValidAtomicAction(nonsensicalLabel, isSyntheticFact)).toBe(true);

    expect(isValidAtomicAction(baseAction({ presentationSummary: "" }), isSyntheticFact)).toBe(false);
  });

  it("18. keeps VideoInstruction entirely out of this contract's scope", () => {
    const exported = Object.keys(atomicActionModule);
    expect(exported).not.toContain("VideoInstruction");
    expect(exported).not.toContain("isValidVideoInstruction");
  });
});

describe("isAtomicActionEligibleForAuthority", () => {
  it("delegates to the exact same governance principle as isSkillEligibleForAuthority", () => {
    expect(isAtomicActionEligibleForAuthority({ status: "ACTIVE", authorityType: "PROFESSIONALLY_AUTHORED" })).toBe(true);
    expect(isAtomicActionEligibleForAuthority({ status: "DRAFT", authorityType: "PROFESSIONALLY_AUTHORED" })).toBe(false);
    expect(isAtomicActionEligibleForAuthority({ status: "ACTIVE", authorityType: "MACHINE_DRAFTED" })).toBe(false);
  });
});
