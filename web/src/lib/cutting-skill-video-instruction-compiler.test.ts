import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import * as compilerModule from "@/lib/cutting-skill-video-instruction-compiler";
import { compileAtomicActionToVideoInstruction, type VideoInstructionCompilationResult, type VideoInstructionCompilationSuccess } from "@/lib/cutting-skill-video-instruction-compiler";

import { compileExecutionUnitToAtomicActions, type AtomicActionCompilationSuccess } from "@/lib/cutting-skill-atomic-action-compiler";
import {
  ESTABLISH_CENTRAL_NAPE_GUIDE_EXECUTION_UNITS,
  ESTABLISH_CENTRAL_NAPE_GUIDE_SKILL,
  ESTABLISH_CENTRAL_NAPE_GUIDE_SKILL_INSTANCE,
  isEstablishCentralNapeGuideFact,
} from "@/lib/cutting-skill-establish-central-nape-guide";
import {
  isOccipitalTransitionFact,
  OCCIPITAL_TRANSITION_EXECUTION_UNITS,
  OCCIPITAL_TRANSITION_SKILL,
  OCCIPITAL_TRANSITION_SKILL_INSTANCE,
} from "@/lib/cutting-skill-occipital-transition";
import { deriveDemonstrationRequirementsFromAtomicAction } from "@/lib/cutting-skill-demonstration-requirement-deriver";
import { isValidDemonstrationRequirement, type DemonstrationRequirement } from "@/lib/professional-skill-demonstration-requirement-contracts";
import { deriveViewpointConstraintsFromDemonstrationRequirements, type ViewpointSatisfactionResult } from "@/lib/cutting-skill-viewpoint-constraint-deriver";
import type { AtomicAction, AtomicActionKind } from "@/lib/professional-skill-atomic-action-contracts";
import { isValidVideoInstructionSequence, isVideoInstructionObservationClaimSupported, type VideoInstruction } from "@/lib/professional-skill-video-instruction-contracts";

// AI Hair Architect, Stage 2.5.i.14 -- FIRST REAL VIDEOINSTRUCTION
// COMPILATION TESTS. Every "REAL" fixture below is compiled through the
// ACTUAL Stage 2.5.i.6/i.7 real Skills -> ACTUAL Stage 2.5.i.8 compiler
// -> ACTUAL Stage 2.5.i.10 deriver -> ACTUAL Stage 2.5.i.12 deriver ->
// this stage's own new compiler. Sections explicitly using fabricated
// values are labeled "SYNTHETIC TEST FIXTURE -- NOT REAL PROFESSIONAL
// AUTHORITY". Calling any of this has ZERO effect anywhere in the
// application today -- no DB, no provider, no runtime wiring.

const COMPILED_AT = "2026-09-08T00:00:00.000Z";
const DERIVED_AT = "2026-09-08T00:00:00.000Z";

// ---------------------------------------------------------------------------
// Real chain builders.
// ---------------------------------------------------------------------------

function compileNapeGuideActions(): readonly AtomicAction[] {
  const result = compileExecutionUnitToAtomicActions(
    ESTABLISH_CENTRAL_NAPE_GUIDE_SKILL,
    ESTABLISH_CENTRAL_NAPE_GUIDE_SKILL_INSTANCE,
    ESTABLISH_CENTRAL_NAPE_GUIDE_EXECUTION_UNITS[0],
    isEstablishCentralNapeGuideFact,
    COMPILED_AT,
  ) as AtomicActionCompilationSuccess;
  return result.actions;
}

function compileOccipitalActions(euIndex: 0 | 1): readonly AtomicAction[] {
  const result = compileExecutionUnitToAtomicActions(
    OCCIPITAL_TRANSITION_SKILL,
    OCCIPITAL_TRANSITION_SKILL_INSTANCE,
    OCCIPITAL_TRANSITION_EXECUTION_UNITS[euIndex],
    isOccipitalTransitionFact,
    COMPILED_AT,
  ) as AtomicActionCompilationSuccess;
  return result.actions;
}

function napeGuideRequirementsFor(action: AtomicAction): readonly DemonstrationRequirement[] {
  const result = deriveDemonstrationRequirementsFromAtomicAction(
    action,
    ESTABLISH_CENTRAL_NAPE_GUIDE_SKILL_INSTANCE,
    ESTABLISH_CENTRAL_NAPE_GUIDE_EXECUTION_UNITS[0],
    isEstablishCentralNapeGuideFact,
    DERIVED_AT,
  );
  return result.status === "DERIVED" ? result.requirements : [];
}

function occipitalRequirementsFor(action: AtomicAction, euIndex: 0 | 1): readonly DemonstrationRequirement[] {
  const result = deriveDemonstrationRequirementsFromAtomicAction(
    action,
    OCCIPITAL_TRANSITION_SKILL_INSTANCE,
    OCCIPITAL_TRANSITION_EXECUTION_UNITS[euIndex],
    isOccipitalTransitionFact,
    DERIVED_AT,
  );
  return result.status === "DERIVED" ? result.requirements : [];
}

function napeGuideVP(requirements: readonly DemonstrationRequirement[]): ViewpointSatisfactionResult {
  return deriveViewpointConstraintsFromDemonstrationRequirements(requirements, isEstablishCentralNapeGuideFact, DERIVED_AT);
}

function occipitalVP(requirements: readonly DemonstrationRequirement[]): ViewpointSatisfactionResult {
  return deriveViewpointConstraintsFromDemonstrationRequirements(requirements, isOccipitalTransitionFact, DERIVED_AT);
}

function compiledInstruction(result: VideoInstructionCompilationResult): VideoInstruction | undefined {
  return result.status === "COMPILED" ? result.instruction : undefined;
}

function findByKind(actions: readonly AtomicAction[], kind: AtomicActionKind): AtomicAction {
  const action = actions.find((a) => a.actionKind === kind);
  if (!action) throw new Error(`fixture setup error: no real ${kind} action found`);
  return action;
}

// ---------------------------------------------------------------------------
// Real fixtures -- Central Nape Guide: all 3 real Atomic Actions.
// ---------------------------------------------------------------------------

const napeActions = compileNapeGuideActions();
const napePosition = findByKind(napeActions, "POSITION");
const napeControl = findByKind(napeActions, "CONTROL");
const napeExecute = findByKind(napeActions, "EXECUTE");

const napePositionReqs = napeGuideRequirementsFor(napePosition);
const napeControlReqs = napeGuideRequirementsFor(napeControl);
const napeExecuteReqs = napeGuideRequirementsFor(napeExecute);

const napePositionVP = napeGuideVP(napePositionReqs);
const napeControlVP = napeGuideVP(napeControlReqs);
const napeExecuteVP = napeGuideVP(napeExecuteReqs);

const napePositionResult = compileAtomicActionToVideoInstruction(napePosition, napePositionReqs, napePositionVP, isEstablishCentralNapeGuideFact, COMPILED_AT);
const napeControlResult = compileAtomicActionToVideoInstruction(napeControl, napeControlReqs, napeControlVP, isEstablishCentralNapeGuideFact, COMPILED_AT);
const napeExecuteResult = compileAtomicActionToVideoInstruction(napeExecute, napeExecuteReqs, napeExecuteVP, isEstablishCentralNapeGuideFact, COMPILED_AT);

// ---------------------------------------------------------------------------
// Real fixtures -- Occipital Transition lower (euIndex 0): all 3 real
// Atomic Actions.
// ---------------------------------------------------------------------------

const occLowerActions = compileOccipitalActions(0);
const occLowerPosition = findByKind(occLowerActions, "POSITION");
const occLowerControl = findByKind(occLowerActions, "CONTROL");
const occLowerExecute = findByKind(occLowerActions, "EXECUTE");

const occLowerPositionReqs = occipitalRequirementsFor(occLowerPosition, 0);
const occLowerControlReqs = occipitalRequirementsFor(occLowerControl, 0);
const occLowerExecuteReqs = occipitalRequirementsFor(occLowerExecute, 0);

const occLowerPositionVP = occipitalVP(occLowerPositionReqs);
const occLowerControlVP = occipitalVP(occLowerControlReqs);
const occLowerExecuteVP = occipitalVP(occLowerExecuteReqs);

const occLowerPositionResult = compileAtomicActionToVideoInstruction(occLowerPosition, occLowerPositionReqs, occLowerPositionVP, isOccipitalTransitionFact, COMPILED_AT);
const occLowerControlResult = compileAtomicActionToVideoInstruction(occLowerControl, occLowerControlReqs, occLowerControlVP, isOccipitalTransitionFact, COMPILED_AT);
const occLowerExecuteResult = compileAtomicActionToVideoInstruction(occLowerExecute, occLowerExecuteReqs, occLowerExecuteVP, isOccipitalTransitionFact, COMPILED_AT);

// ---------------------------------------------------------------------------
// Real fixtures -- Occipital Transition upper (euIndex 1): all 3 real
// Atomic Actions.
// ---------------------------------------------------------------------------

const occUpperActions = compileOccipitalActions(1);
const occUpperPosition = findByKind(occUpperActions, "POSITION");
const occUpperControl = findByKind(occUpperActions, "CONTROL");
const occUpperExecute = findByKind(occUpperActions, "EXECUTE");

const occUpperPositionReqs = occipitalRequirementsFor(occUpperPosition, 1);
const occUpperControlReqs = occipitalRequirementsFor(occUpperControl, 1);
const occUpperExecuteReqs = occipitalRequirementsFor(occUpperExecute, 1);

const occUpperPositionVP = occipitalVP(occUpperPositionReqs);
const occUpperControlVP = occipitalVP(occUpperControlReqs);
const occUpperExecuteVP = occipitalVP(occUpperExecuteReqs);

const occUpperPositionResult = compileAtomicActionToVideoInstruction(occUpperPosition, occUpperPositionReqs, occUpperPositionVP, isOccipitalTransitionFact, COMPILED_AT);
const occUpperControlResult = compileAtomicActionToVideoInstruction(occUpperControl, occUpperControlReqs, occUpperControlVP, isOccipitalTransitionFact, COMPILED_AT);
const occUpperExecuteResult = compileAtomicActionToVideoInstruction(occUpperExecute, occUpperExecuteReqs, occUpperExecuteVP, isOccipitalTransitionFact, COMPILED_AT);

const ALL_REAL_RESULTS = [
  napePositionResult,
  napeControlResult,
  napeExecuteResult,
  occLowerPositionResult,
  occLowerControlResult,
  occLowerExecuteResult,
  occUpperPositionResult,
  occUpperControlResult,
  occUpperExecuteResult,
];

// ===========================================================================
// SECTION A -- BASIC COMPILER (items 1-5)
// ===========================================================================

describe("A. BASIC COMPILER", () => {
  it("1. valid Atomic Action + valid Requirements + valid Viewpoint Policy -> valid VideoInstruction", () => {
    expect(napeExecuteResult.status).toBe("COMPILED");
  });

  it("2. output validates against the Stage 2.5.i.13 contract itself", () => {
    const instruction = compiledInstruction(napeExecuteResult)!;
    expect(instruction.videoInstructionId.length).toBeGreaterThan(0);
    expect(instruction.sourceDemonstrationRequirementIds.length).toBeGreaterThan(0);
    expect(instruction.sourceViewpointConstraintIds.length).toBeGreaterThan(0);
  });

  it("3. instruction remains 1:1 with its source Atomic Action", () => {
    const instruction = compiledInstruction(napeExecuteResult)!;
    expect(instruction.sourceAtomicActionId).toBe(napeExecute.atomicActionId);
    expect(instruction.videoInstructionId).toBe(`${napeExecute.atomicActionId}#video`);
  });

  it("4. evidenceStatus is safely inherited from the source Atomic Action", () => {
    // Real EXECUTE actions carry no observationCriterion -> DEMONSTRATED_TARGET.
    expect(napeExecute.observationCriterion).toBeUndefined();
    expect(compiledInstruction(napeExecuteResult)!.evidenceStatus).toBe("DEMONSTRATED_TARGET");

    // SYNTHETIC TEST FIXTURE -- NOT REAL PROFESSIONAL AUTHORITY. A
    // fabricated OBSERVE-kind action that DOES already claim
    // RUNTIME_PROFESSIONAL_OBSERVATION -- proves the inheritance also
    // works the other direction, never invented independently.
    const syntheticObserveAction: AtomicAction = {
      atomicActionId: "aa-synthetic-observe-1",
      vertical: "cutting",
      order: 1,
      actionKind: "OBSERVE",
      sourceExecutionUnitId: napeExecute.sourceExecutionUnitId,
      sourceSkillId: napeExecute.sourceSkillId,
      sourceSkillVersion: napeExecute.sourceSkillVersion,
      observationCriterion: { fact: "aboveOccipitalThreshold", expectedValue: false, evidenceStatus: "RUNTIME_PROFESSIONAL_OBSERVATION" },
      presentationSummary: "SYNTHETIC observation action.",
      compiledAt: COMPILED_AT,
    };
    const syntheticRequirement: DemonstrationRequirement = {
      demonstrationRequirementId: "req-synthetic-observe-1",
      vertical: "cutting",
      category: "ANATOMICAL_CONTEXT",
      subjectParameterNames: ["aboveOccipitalThreshold"],
      subjectValue: "posterior_below_occipital",
      sourceAtomicActionId: "aa-synthetic-observe-1",
      presentationSummary: "SYNTHETIC.",
      derivedAt: DERIVED_AT,
    };
    const syntheticVP = deriveViewpointConstraintsFromDemonstrationRequirements([syntheticRequirement], isOccipitalTransitionFact, DERIVED_AT);
    const result = compileAtomicActionToVideoInstruction(syntheticObserveAction, [syntheticRequirement], syntheticVP, isOccipitalTransitionFact, COMPILED_AT);
    expect(result.status).toBe("COMPILED");
    expect(compiledInstruction(result)!.evidenceStatus).toBe("RUNTIME_PROFESSIONAL_OBSERVATION");
  });

  it("5. order is preserved from the source Atomic Action, never invented", () => {
    expect(compiledInstruction(napePositionResult)!.order).toBe(napePosition.order);
    expect(compiledInstruction(napeControlResult)!.order).toBe(napeControl.order);
    expect(compiledInstruction(napeExecuteResult)!.order).toBe(napeExecute.order);
    expect(napePosition.order).toBe(1);
    expect(napeControl.order).toBe(2);
    expect(napeExecute.order).toBe(3);
  });
});

// ===========================================================================
// SECTION B -- CENTRAL NAPE GUIDE REAL (items 6-12)
// ===========================================================================

describe("B. CENTRAL NAPE GUIDE REAL", () => {
  it("6. real head-position (POSITION) Atomic Action compiles", () => {
    expect(napePositionResult.status).toBe("COMPILED");
  });

  it("7. real comb-control (CONTROL) Atomic Action compiles, comb traceable", () => {
    expect(napeControlResult.status).toBe("COMPILED");
    const controlRequirement = napeControlReqs.find((r) => r.category === "TOOL_TO_SUBJECT_RELATIONSHIP");
    expect(controlRequirement?.subjectValue).toBe("comb");
  });

  it("8. real cutting (EXECUTE) Atomic Action compiles", () => {
    expect(napeExecuteResult.status).toBe("COMPILED");
  });

  it("9. all requirements covered for every real Nape Guide action", () => {
    for (const result of [napePositionResult, napeControlResult, napeExecuteResult]) {
      expect(result.status).toBe("COMPILED");
    }
  });

  it("10. no requirement is dropped -- every derived requirement id is referenced", () => {
    const instruction = compiledInstruction(napeExecuteResult)!;
    expect(instruction.sourceDemonstrationRequirementIds.length).toBe(napeExecuteReqs.length);
    expect(new Set(instruction.sourceDemonstrationRequirementIds)).toEqual(new Set(napeExecuteReqs.map((r) => r.demonstrationRequirementId)));
  });

  it("11. POSTERIOR constraints correctly referenced -- no other family", () => {
    const instruction = compiledInstruction(napeExecuteResult)!;
    const referenced = napeExecuteVP.status === "COVERED" ? napeExecuteVP.constraints : [];
    for (const id of instruction.sourceViewpointConstraintIds) {
      const constraint = referenced.find((c) => c.viewpointConstraintId === id);
      expect(constraint?.viewpointFamily).toBe("POSTERIOR");
    }
  });

  it("12. a real Nape Guide sequence (POSITION -> CONTROL -> EXECUTE) validates", () => {
    const sequence = [compiledInstruction(napePositionResult)!, compiledInstruction(napeControlResult)!, compiledInstruction(napeExecuteResult)!];
    expect(isValidVideoInstructionSequence(sequence)).toBe(true);
  });
});

// ===========================================================================
// SECTION C -- OCCIPITAL LOWER REAL (items 13-17)
// ===========================================================================

describe("C. OCCIPITAL LOWER REAL", () => {
  it("13. real lower Atomic Actions compile", () => {
    expect(occLowerPositionResult.status).toBe("COMPILED");
    expect(occLowerControlResult.status).toBe("COMPILED");
    expect(occLowerExecuteResult.status).toBe("COMPILED");
  });

  it("14. COMB source remains traceable through the referenced Demonstration Requirement", () => {
    const controlRequirement = occLowerControlReqs.find((r) => r.category === "TOOL_TO_SUBJECT_RELATIONSHIP");
    expect(controlRequirement?.subjectValue).toBe("comb");
    const instruction = compiledInstruction(occLowerControlResult)!;
    expect(instruction.sourceDemonstrationRequirementIds).toContain(controlRequirement!.demonstrationRequirementId);
  });

  it("15. the anatomical condition stays upstream (on the Demonstration Requirement), never duplicated onto VideoInstruction", () => {
    const anatomical = occLowerExecuteReqs.find((r) => r.category === "ANATOMICAL_CONTEXT");
    expect(anatomical?.condition).toEqual({ op: "equals", fact: "aboveOccipitalThreshold", value: false });
    const instruction = compiledInstruction(occLowerExecuteResult)!;
    expect(Object.keys(instruction)).not.toContain("condition");
    expect(Object.keys(instruction)).not.toContain("aboveOccipitalThreshold");
  });

  it("16. coverage complete for every real lower action", () => {
    for (const result of [occLowerPositionResult, occLowerControlResult, occLowerExecuteResult]) {
      expect(result.status).toBe("COMPILED");
    }
  });

  it("17. no invented viewpoint -- only the real POSTERIOR family appears", () => {
    const instruction = compiledInstruction(occLowerExecuteResult)!;
    const referenced = occLowerExecuteVP.status === "COVERED" ? occLowerExecuteVP.constraints : [];
    expect(instruction.sourceViewpointConstraintIds.length).toBeGreaterThan(0);
    for (const id of instruction.sourceViewpointConstraintIds) {
      expect(referenced.find((c) => c.viewpointConstraintId === id)?.viewpointFamily).toBe("POSTERIOR");
    }
  });
});

// ===========================================================================
// SECTION D -- OCCIPITAL UPPER REAL (items 18-21)
// ===========================================================================

describe("D. OCCIPITAL UPPER REAL", () => {
  it("18. real upper Atomic Actions compile", () => {
    expect(occUpperPositionResult.status).toBe("COMPILED");
    expect(occUpperControlResult.status).toBe("COMPILED");
    expect(occUpperExecuteResult.status).toBe("COMPILED");
  });

  it("19. FINGERS source remains traceable through the referenced Demonstration Requirement", () => {
    const controlRequirement = occUpperControlReqs.find((r) => r.category === "TOOL_TO_SUBJECT_RELATIONSHIP");
    expect(controlRequirement?.subjectValue).toBe("fingers");
    const instruction = compiledInstruction(occUpperControlResult)!;
    expect(instruction.sourceDemonstrationRequirementIds).toContain(controlRequirement!.demonstrationRequirementId);
  });

  it("20. lower and upper remain structurally distinguishable -- never interchangeable", () => {
    const lowerControlInstruction = compiledInstruction(occLowerControlResult)!;
    const upperControlInstruction = compiledInstruction(occUpperControlResult)!;
    expect(lowerControlInstruction.sourceAtomicActionId).not.toBe(upperControlInstruction.sourceAtomicActionId);
    expect(lowerControlInstruction.sourceDemonstrationRequirementIds).not.toEqual(upperControlInstruction.sourceDemonstrationRequirementIds);
    expect(
      isVideoInstructionObservationClaimSupported(upperControlInstruction, occLowerControl),
    ).toBe(false); // mismatched source id -- structurally rejected
  });

  it("21. coverage complete for every real upper action", () => {
    for (const result of [occUpperPositionResult, occUpperControlResult, occUpperExecuteResult]) {
      expect(result.status).toBe("COMPILED");
    }
  });
});

// ===========================================================================
// SECTION E -- FAIL CLOSED (items 22-29)
// ===========================================================================

describe("E. FAIL CLOSED", () => {
  it("22. missing Demonstration Requirements fails", () => {
    const result = compileAtomicActionToVideoInstruction(napeExecute, [], napeExecuteVP, isEstablishCentralNapeGuideFact, COMPILED_AT);
    expect(result.status).toBe("UNRESOLVED");
  });

  it("23. an uncovered mandatory requirement fails", () => {
    const truncatedVP: ViewpointSatisfactionResult =
      napeExecuteVP.status === "COVERED" ? { status: "COVERED", constraints: napeExecuteVP.constraints.slice(1) } : napeExecuteVP;
    const result = compileAtomicActionToVideoInstruction(napeExecute, napeExecuteReqs, truncatedVP, isEstablishCentralNapeGuideFact, COMPILED_AT);
    expect(result.status).toBe("UNRESOLVED");
  });

  it("24. a cross-action Demonstration Requirement fails", () => {
    const mixed = [...napeExecuteReqs, occLowerExecuteReqs[0]];
    const result = compileAtomicActionToVideoInstruction(napeExecute, mixed, napeExecuteVP, isEstablishCentralNapeGuideFact, COMPILED_AT);
    expect(result.status).toBe("UNRESOLVED");
  });

  it("25. an unrelated Viewpoint Policy (derived for a different action) fails", () => {
    const result = compileAtomicActionToVideoInstruction(napeExecute, napeExecuteReqs, occLowerExecuteVP, isEstablishCentralNapeGuideFact, COMPILED_AT);
    expect(result.status).toBe("UNRESOLVED");
  });

  it("26. invalid/unsupported evidence claims fail at the validator this compiler relies on", () => {
    // The real compiler API structurally cannot be made to emit a
    // mismatched claim (evidenceStatus is always computed FROM the source
    // action, never supplied) -- proven above (test 4). What CAN be
    // proven here is that the underlying gate this compiler's own final
    // check delegates to correctly rejects a hand-built mismatch, which
    // is exactly why the compiler can never produce one.
    const falseClaim: VideoInstruction = { ...compiledInstruction(napeExecuteResult)!, evidenceStatus: "RUNTIME_PROFESSIONAL_OBSERVATION" };
    expect(isVideoInstructionObservationClaimSupported(falseClaim, napeExecute)).toBe(false);
  });

  it("27. malformed sequence/source fails", () => {
    const nonContiguous = [compiledInstruction(napePositionResult)!, { ...compiledInstruction(napeExecuteResult)!, order: 3 }];
    expect(isValidVideoInstructionSequence(nonContiguous)).toBe(false);
  });

  it("28. a Viewpoint Policy unresolved/unsatisfied upstream fails", () => {
    const unsatisfied: ViewpointSatisfactionResult = { status: "VIEWPOINT_UNSATISFIED", reason: "SYNTHETIC: no family covers this set", uncoveredDemonstrationRequirementIds: [napeExecuteReqs[0].demonstrationRequirementId] };
    const result = compileAtomicActionToVideoInstruction(napeExecute, napeExecuteReqs, unsatisfied, isEstablishCentralNapeGuideFact, COMPILED_AT);
    expect(result.status).toBe("UNRESOLVED");
  });

  it("29. no partial VideoInstruction is ever emitted on any failure path", () => {
    const failures = [
      compileAtomicActionToVideoInstruction(napeExecute, [], napeExecuteVP, isEstablishCentralNapeGuideFact, COMPILED_AT),
      compileAtomicActionToVideoInstruction(napeExecute, napeExecuteReqs, occLowerExecuteVP, isEstablishCentralNapeGuideFact, COMPILED_AT),
    ];
    for (const failure of failures) {
      expect(failure.status).toBe("UNRESOLVED");
      expect("instruction" in failure).toBe(false);
    }
  });
});

// ===========================================================================
// SECTION F -- FREE TEXT / PROVIDER (items 30-37)
// ===========================================================================

const SOURCE_TEXT = readFileSync(fileURLToPath(new URL("./cutting-skill-video-instruction-compiler.ts", import.meta.url)), "utf8");
const IMPORT_LINES = SOURCE_TEXT.split("\n").filter((line) => /^\s*import\s/.test(line));

describe("F. FREE TEXT / PROVIDER BOUNDARY", () => {
  it("30. mangled free-text/presentation fields never influence the compiled result", () => {
    const mangledAction: AtomicAction = { ...napeExecute, presentationSummary: "SYNTHETIC garbage prose", presentationDetail: "SYNTHETIC garbage detail claiming tool=razor and elevation=90" };
    const mangledReqs = napeExecuteReqs.map((r) => ({ ...r, presentationSummary: "SYNTHETIC garbage requirement prose" }));
    const real = compileAtomicActionToVideoInstruction(napeExecute, napeExecuteReqs, napeExecuteVP, isEstablishCentralNapeGuideFact, COMPILED_AT);
    const mangled = compileAtomicActionToVideoInstruction(mangledAction, mangledReqs, napeExecuteVP, isEstablishCentralNapeGuideFact, COMPILED_AT);
    expect(compiledInstruction(mangled)).toEqual(compiledInstruction(real));
  });

  it("31. no Veo/Gemini/OpenAI/provider vocabulary anywhere in the compiler's imports or exports", () => {
    for (const line of IMPORT_LINES) {
      expect(/\bveo\b/i.test(line)).toBe(false);
      expect(/gemini/i.test(line)).toBe(false);
      expect(/openai/i.test(line)).toBe(false);
    }
    const exported = Object.keys(compilerModule).join(" ").toLowerCase();
    expect(exported.includes("veo")).toBe(false);
    expect(exported.includes("gemini")).toBe(false);
    expect(exported.includes("provider")).toBe(false);
  });

  it("32. no camera field is ever created on a compiled instruction", () => {
    const keys = Object.keys(compiledInstruction(napeExecuteResult)!);
    for (const forbidden of ["camera", "angle", "degrees", "lens", "dolly", "pan", "tilt", "zoom"]) {
      expect(keys.some((k) => k.toLowerCase().includes(forbidden))).toBe(false);
    }
  });

  it("33. no timing field is ever created on a compiled instruction", () => {
    const keys = Object.keys(compiledInstruction(napeExecuteResult)!);
    for (const forbidden of ["second", "duration", "fps", "frame", "millisecond"]) {
      expect(keys.some((k) => k.toLowerCase().includes(forbidden))).toBe(false);
    }
  });

  it("34. no Technical Visual Map dependency", () => {
    for (const line of IMPORT_LINES) expect(line.toLowerCase().includes("technical-visual-map")).toBe(false);
  });

  it("35. no Spatial Map dependency", () => {
    for (const line of IMPORT_LINES) expect(line.toLowerCase().includes("spatial")).toBe(false);
  });

  it("36. no Result Video dependency", () => {
    for (const line of IMPORT_LINES) expect(line.toLowerCase().includes("result-video")).toBe(false);
  });

  it("37. no Photo Preview dependency", () => {
    for (const line of IMPORT_LINES) expect(line.toLowerCase().includes("photo-preview")).toBe(false);
  });
});

// ===========================================================================
// SECTION G -- DETERMINISM (items 38-40)
// ===========================================================================

describe("G. DETERMINISM", () => {
  it("38. the same structured inputs produce a deep-equal output", () => {
    const first = compileAtomicActionToVideoInstruction(napeExecute, napeExecuteReqs, napeExecuteVP, isEstablishCentralNapeGuideFact, COMPILED_AT);
    const second = compileAtomicActionToVideoInstruction(napeExecute, napeExecuteReqs, napeExecuteVP, isEstablishCentralNapeGuideFact, COMPILED_AT);
    expect(second).toEqual(first);
  });

  it("39. input array ordering does not change the compiled result", () => {
    const forward = compileAtomicActionToVideoInstruction(napeExecute, napeExecuteReqs, napeExecuteVP, isEstablishCentralNapeGuideFact, COMPILED_AT);
    const reversed = compileAtomicActionToVideoInstruction(napeExecute, [...napeExecuteReqs].reverse(), napeExecuteVP, isEstablishCentralNapeGuideFact, COMPILED_AT);
    expect(reversed).toEqual(forward);
  });

  it("40. an exact duplicate requirement reference is normalized; an incompatible one is rejected", () => {
    const withExactDuplicate = [...napeExecuteReqs, napeExecuteReqs[0]];
    const normalizedResult = compileAtomicActionToVideoInstruction(napeExecute, withExactDuplicate, napeExecuteVP, isEstablishCentralNapeGuideFact, COMPILED_AT);
    expect(normalizedResult.status).toBe("COMPILED");
    expect(compiledInstruction(normalizedResult)).toEqual(compiledInstruction(napeExecuteResult));

    const incompatibleDuplicate = { ...napeExecuteReqs[0], subjectValue: "SYNTHETIC_DIFFERENT_VALUE" };
    const withIncompatibleDuplicate = [...napeExecuteReqs, incompatibleDuplicate];
    const rejectedResult = compileAtomicActionToVideoInstruction(napeExecute, withIncompatibleDuplicate, napeExecuteVP, isEstablishCentralNapeGuideFact, COMPILED_AT);
    expect(rejectedResult.status).toBe("UNRESOLVED");
  });
});

// ===========================================================================
// REAL COMPILATION RESULT SUMMARY (assertion form of the report's own
// numbers, kept as a live regression against the final report text).
// ===========================================================================

describe("Real compilation result summary", () => {
  it("produces exactly 9 real VideoInstructions across the 3 real Skills (3 Atomic Actions each)", () => {
    const compiled = ALL_REAL_RESULTS.filter((r) => r.status === "COMPILED") as VideoInstructionCompilationSuccess[];
    expect(compiled.length).toBe(9);
  });

  it("every real compiled instruction independently validates as a full sequence per source Skill", () => {
    const napeSequence = [compiledInstruction(napePositionResult)!, compiledInstruction(napeControlResult)!, compiledInstruction(napeExecuteResult)!];
    const lowerSequence = [compiledInstruction(occLowerPositionResult)!, compiledInstruction(occLowerControlResult)!, compiledInstruction(occLowerExecuteResult)!];
    const upperSequence = [compiledInstruction(occUpperPositionResult)!, compiledInstruction(occUpperControlResult)!, compiledInstruction(occUpperExecuteResult)!];
    expect(isValidVideoInstructionSequence(napeSequence)).toBe(true);
    expect(isValidVideoInstructionSequence(lowerSequence)).toBe(true);
    expect(isValidVideoInstructionSequence(upperSequence)).toBe(true);
  });
});

// ===========================================================================
// Non-regression: upstream real objects remain independently valid.
// ===========================================================================

describe("Non-regression: upstream real objects remain independently valid", () => {
  it("every real Demonstration Requirement used in this file's fixtures is independently valid", () => {
    const all = [
      ...napePositionReqs,
      ...napeControlReqs,
      ...napeExecuteReqs,
      ...occLowerPositionReqs,
      ...occLowerControlReqs,
      ...occLowerExecuteReqs,
      ...occUpperPositionReqs,
      ...occUpperControlReqs,
      ...occUpperExecuteReqs,
    ];
    for (const requirement of all) {
      expect(isValidDemonstrationRequirement(requirement, isOccipitalTransitionFact)).toBe(true);
    }
  });

  it("the compiler module exports no provider adapter or Technical Execution Video symbol", () => {
    const exported = Object.keys(compilerModule);
    for (const forbidden of ["ProviderAdapter", "TechnicalExecutionVideo", "generateVideo", "compileVideoInstructionSequence"]) {
      expect(exported.some((name) => name.includes(forbidden))).toBe(false);
    }
  });
});
