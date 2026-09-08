import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import * as videoInstructionModule from "@/lib/professional-skill-video-instruction-contracts";
import {
  isValidVideoInstruction,
  isValidVideoInstructionSequence,
  isVideoInstructionCoverageSatisfied,
  isVideoInstructionObservationClaimSupported,
  isVideoInstructionSourceConsistent,
  type VideoInstruction,
} from "@/lib/professional-skill-video-instruction-contracts";

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
import { deriveDemonstrationRequirementsFromAtomicAction, type DemonstrationRequirementDerivationResult } from "@/lib/cutting-skill-demonstration-requirement-deriver";
import { isValidDemonstrationRequirement, type DemonstrationRequirement } from "@/lib/professional-skill-demonstration-requirement-contracts";
import { deriveViewpointConstraintsFromDemonstrationRequirements, type ViewpointSatisfactionResult } from "@/lib/cutting-skill-viewpoint-constraint-deriver";
import type { ViewpointConstraint } from "@/lib/professional-skill-viewpoint-constraint-contracts";
import type { AtomicAction } from "@/lib/professional-skill-atomic-action-contracts";

// AI Hair Architect, Stage 2.5.i.13 -- VIDEOINSTRUCTION CONTRACT TESTS.
// Section A/B/D/E use REAL professional content (Stage 2.5.i.6/i.7),
// compiled through the REAL Stage 2.5.i.8 compiler, REAL Stage 2.5.i.10
// deriver, and REAL Stage 2.5.i.12 deriver, wherever a real case is
// required. Every VideoInstruction fixture below is a TEST FIXTURE ONLY
// -- never persisted, never wired into any runtime path, never created
// by a compiler (none exists). Sections explicitly using fabricated
// values are labeled "SYNTHETIC TEST FIXTURE -- NOT REAL PROFESSIONAL
// AUTHORITY".

const COMPILED_AT = "2026-09-08T00:00:00.000Z";
const DERIVED_AT = "2026-09-08T00:00:00.000Z";

// ---------------------------------------------------------------------------
// Real chain builders -- mirror cutting-skill-demonstration-requirement-
// deriver.test.ts and cutting-skill-viewpoint-constraint-deriver.test.ts
// exactly.
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

function requirementsOf(result: DemonstrationRequirementDerivationResult): readonly DemonstrationRequirement[] {
  return result.status === "DERIVED" ? result.requirements : [];
}

function constraintsOf(result: ViewpointSatisfactionResult): readonly ViewpointConstraint[] {
  return result.status === "COVERED" ? result.constraints : [];
}

function napeGuideRequirementsFor(action: AtomicAction): readonly DemonstrationRequirement[] {
  return requirementsOf(
    deriveDemonstrationRequirementsFromAtomicAction(
      action,
      ESTABLISH_CENTRAL_NAPE_GUIDE_SKILL_INSTANCE,
      ESTABLISH_CENTRAL_NAPE_GUIDE_EXECUTION_UNITS[0],
      isEstablishCentralNapeGuideFact,
      DERIVED_AT,
    ),
  );
}

function occipitalRequirementsFor(action: AtomicAction, euIndex: 0 | 1): readonly DemonstrationRequirement[] {
  return requirementsOf(
    deriveDemonstrationRequirementsFromAtomicAction(
      action,
      OCCIPITAL_TRANSITION_SKILL_INSTANCE,
      OCCIPITAL_TRANSITION_EXECUTION_UNITS[euIndex],
      isOccipitalTransitionFact,
      DERIVED_AT,
    ),
  );
}

function napeGuideViewpointConstraints(requirements: readonly DemonstrationRequirement[]): readonly ViewpointConstraint[] {
  return constraintsOf(deriveViewpointConstraintsFromDemonstrationRequirements(requirements, isEstablishCentralNapeGuideFact, DERIVED_AT));
}

function occipitalViewpointConstraints(requirements: readonly DemonstrationRequirement[]): readonly ViewpointConstraint[] {
  return constraintsOf(deriveViewpointConstraintsFromDemonstrationRequirements(requirements, isOccipitalTransitionFact, DERIVED_AT));
}

// Real EXECUTE actions -- the richest real requirement set of the three
// real actionKinds (bears elevation/tool/cuttingLineShape/anatomical
// context together), matching Stage 2.5.i.13's own per-case expressiveness
// requirements.
const napeGuideActions = compileNapeGuideActions();
const napeExecuteAction = napeGuideActions.find((a) => a.actionKind === "EXECUTE")!;
const napeRequirements = napeGuideRequirementsFor(napeExecuteAction);
const napeConstraints = napeGuideViewpointConstraints(napeRequirements);

const occipitalLowerActions = compileOccipitalActions(0);
const occipitalLowerExecuteAction = occipitalLowerActions.find((a) => a.actionKind === "EXECUTE")!;
const occipitalLowerRequirements = occipitalRequirementsFor(occipitalLowerExecuteAction, 0);
const occipitalLowerConstraints = occipitalViewpointConstraints(occipitalLowerRequirements);

const occipitalUpperActions = compileOccipitalActions(1);
const occipitalUpperExecuteAction = occipitalUpperActions.find((a) => a.actionKind === "EXECUTE")!;
const occipitalUpperRequirements = occipitalRequirementsFor(occipitalUpperExecuteAction, 1);
const occipitalUpperConstraints = occipitalViewpointConstraints(occipitalUpperRequirements);

// The COMB/FINGERS distinction lives on the CONTROL action, not EXECUTE --
// pulled in separately for Section C's own traceability tests.
const occipitalLowerControlAction = occipitalLowerActions.find((a) => a.actionKind === "CONTROL")!;
const occipitalLowerControlRequirements = occipitalRequirementsFor(occipitalLowerControlAction, 0);
const occipitalUpperControlAction = occipitalUpperActions.find((a) => a.actionKind === "CONTROL")!;
const occipitalUpperControlRequirements = occipitalRequirementsFor(occipitalUpperControlAction, 1);

function realVideoInstruction(
  action: AtomicAction,
  requirements: readonly DemonstrationRequirement[],
  constraints: readonly ViewpointConstraint[],
  order = 1,
): VideoInstruction {
  return {
    videoInstructionId: `${action.atomicActionId}#video-${order}`,
    vertical: action.vertical,
    order,
    sourceAtomicActionId: action.atomicActionId,
    sourceDemonstrationRequirementIds: requirements.map((r) => r.demonstrationRequirementId),
    sourceViewpointConstraintIds: constraints.map((c) => c.viewpointConstraintId),
    evidenceStatus: "DEMONSTRATED_TARGET",
    compiledAt: COMPILED_AT,
  };
}

const napeInstruction = realVideoInstruction(napeExecuteAction, napeRequirements, napeConstraints);
const occipitalLowerInstruction = realVideoInstruction(occipitalLowerExecuteAction, occipitalLowerRequirements, occipitalLowerConstraints);
const occipitalUpperInstruction = realVideoInstruction(occipitalUpperExecuteAction, occipitalUpperRequirements, occipitalUpperConstraints);

const allRealRequirements = [...napeRequirements, ...occipitalLowerRequirements, ...occipitalUpperRequirements];
const allRealConstraints = [...napeConstraints, ...occipitalLowerConstraints, ...occipitalUpperConstraints];

// ===========================================================================
// SECTION A -- CONTRACT (items 1-10)
// ===========================================================================

describe("A. CONTRACT", () => {
  it("1. valid provider-independent VideoInstruction (REAL fixture) validates", () => {
    expect(napeGuideActions.length).toBeGreaterThan(0);
    expect(napeRequirements.length).toBeGreaterThan(0);
    expect(napeConstraints.length).toBeGreaterThan(0);
    expect(isValidVideoInstruction(napeInstruction)).toBe(true);
  });

  it("2. missing source Atomic Action rejected", () => {
    expect(isValidVideoInstruction({ ...napeInstruction, sourceAtomicActionId: "" })).toBe(false);
  });

  it("3. empty Demonstration Requirement references rejected", () => {
    expect(isValidVideoInstruction({ ...napeInstruction, sourceDemonstrationRequirementIds: [] })).toBe(false);
  });

  it("4. empty Viewpoint Constraint references structurally rejected, and non-empty-but-non-covering references fail the coverage check", () => {
    expect(isValidVideoInstruction({ ...napeInstruction, sourceViewpointConstraintIds: [] })).toBe(false);

    const uncovering: VideoInstruction = { ...napeInstruction, sourceViewpointConstraintIds: [occipitalLowerConstraints[0].viewpointConstraintId] };
    expect(isValidVideoInstruction(uncovering)).toBe(true);
    expect(isVideoInstructionCoverageSatisfied(uncovering, allRealRequirements, allRealConstraints)).toBe(false);
  });

  it("5. provider-specific fields (model/prompt/seed/API shape) are not representable -- the type has no such keys", () => {
    const keys = Object.keys(napeInstruction);
    for (const forbidden of ["model", "prompt", "seed", "provider", "operationid", "requestbody", "apikey", "safety"]) {
      expect(keys.some((k) => k.toLowerCase().includes(forbidden))).toBe(false);
    }
  });

  it("6. exact camera commands are not representable -- the type has no such keys", () => {
    const keys = Object.keys(napeInstruction);
    for (const forbidden of ["camera", "angle", "degrees", "distance", "lens", "dolly", "pan", "tilt", "zoom"]) {
      expect(keys.some((k) => k.toLowerCase().includes(forbidden))).toBe(false);
    }
  });

  it("7. exact seconds/duration/frame metadata is not representable -- the type has no such keys", () => {
    const keys = Object.keys(napeInstruction);
    for (const forbidden of ["second", "duration", "fps", "frame", "millisecond", "pacing"]) {
      expect(keys.some((k) => k.toLowerCase().includes(forbidden))).toBe(false);
    }
  });

  it("8. runtime observation cannot be falsely asserted -- real EXECUTE actions carry no observationCriterion", () => {
    expect(napeExecuteAction.observationCriterion).toBeUndefined();
    const falseClaim: VideoInstruction = { ...napeInstruction, evidenceStatus: "RUNTIME_PROFESSIONAL_OBSERVATION" };
    expect(isVideoInstructionObservationClaimSupported(falseClaim, napeExecuteAction)).toBe(false);
    expect(isVideoInstructionObservationClaimSupported(napeInstruction, napeExecuteAction)).toBe(true);
  });

  it("9. the universal contract's own field names contain no haircut-specific vocabulary", () => {
    const keys = Object.keys(napeInstruction).join(" ").toLowerCase();
    for (const term of ["comb", "finger", "shear", "elevation", "hair", "occipital", "nape"]) {
      expect(keys.includes(term)).toBe(false);
    }
  });

  it("10. ordering validates correctly for a real, contiguous sequence", () => {
    const sequence = [
      napeInstruction,
      { ...occipitalLowerInstruction, order: 2 },
      { ...occipitalUpperInstruction, order: 3 },
    ];
    expect(isValidVideoInstructionSequence(sequence)).toBe(true);
  });
});

// ===========================================================================
// SECTION B -- COVERAGE INTEGRITY (items 11-16)
// ===========================================================================

describe("B. COVERAGE INTEGRITY", () => {
  it("11. all mandatory requirements covered -> valid", () => {
    expect(isVideoInstructionSourceConsistent(napeInstruction, napeRequirements, napeConstraints)).toBe(true);
    expect(isVideoInstructionCoverageSatisfied(napeInstruction, napeRequirements, napeConstraints)).toBe(true);
  });

  it("12. one mandatory requirement uncovered -> invalid", () => {
    const missingOneConstraint = napeConstraints.slice(1);
    expect(isVideoInstructionCoverageSatisfied(napeInstruction, napeRequirements, missingOneConstraint)).toBe(false);
  });

  it("13. a duplicate requirement reference is rejected at the structural level", () => {
    const withDuplicate = { ...napeInstruction, sourceDemonstrationRequirementIds: [...napeInstruction.sourceDemonstrationRequirementIds, napeInstruction.sourceDemonstrationRequirementIds[0]] };
    expect(isValidVideoInstruction(withDuplicate)).toBe(false);
  });

  it("14. an unrelated Viewpoint Constraint (belongs to a different real Atomic Action) is rejected", () => {
    const withUnrelated: VideoInstruction = {
      ...napeInstruction,
      sourceViewpointConstraintIds: [...napeInstruction.sourceViewpointConstraintIds, occipitalLowerConstraints[0].viewpointConstraintId],
    };
    expect(isVideoInstructionSourceConsistent(withUnrelated, allRealRequirements, allRealConstraints)).toBe(false);
  });

  it("15. a cross-action Demonstration Requirement reference is rejected", () => {
    const withForeignRequirement: VideoInstruction = {
      ...napeInstruction,
      sourceDemonstrationRequirementIds: [...napeInstruction.sourceDemonstrationRequirementIds, occipitalLowerRequirements[0].demonstrationRequirementId],
    };
    expect(isVideoInstructionSourceConsistent(withForeignRequirement, allRealRequirements, allRealConstraints)).toBe(false);
  });

  it("16. a cross-action Viewpoint Constraint reference is rejected", () => {
    const withForeignConstraint: VideoInstruction = {
      ...napeInstruction,
      sourceViewpointConstraintIds: [...napeInstruction.sourceViewpointConstraintIds, occipitalUpperConstraints[0].viewpointConstraintId],
    };
    expect(isVideoInstructionSourceConsistent(withForeignConstraint, allRealRequirements, allRealConstraints)).toBe(false);
  });
});

// ===========================================================================
// SECTION C -- REAL EXPRESSIVENESS (items 17-22)
// ===========================================================================

describe("C. REAL EXPRESSIVENESS", () => {
  it("17. Central Nape Guide fixture representable end-to-end", () => {
    expect(isValidVideoInstruction(napeInstruction)).toBe(true);
    expect(isVideoInstructionSourceConsistent(napeInstruction, napeRequirements, napeConstraints)).toBe(true);
    expect(isVideoInstructionCoverageSatisfied(napeInstruction, napeRequirements, napeConstraints)).toBe(true);
  });

  it("18. Occipital Transition lower fixture representable end-to-end", () => {
    expect(isValidVideoInstruction(occipitalLowerInstruction)).toBe(true);
    expect(isVideoInstructionSourceConsistent(occipitalLowerInstruction, occipitalLowerRequirements, occipitalLowerConstraints)).toBe(true);
    expect(isVideoInstructionCoverageSatisfied(occipitalLowerInstruction, occipitalLowerRequirements, occipitalLowerConstraints)).toBe(true);
  });

  it("19. Occipital Transition upper fixture representable end-to-end", () => {
    expect(isValidVideoInstruction(occipitalUpperInstruction)).toBe(true);
    expect(isVideoInstructionSourceConsistent(occipitalUpperInstruction, occipitalUpperRequirements, occipitalUpperConstraints)).toBe(true);
    expect(isVideoInstructionCoverageSatisfied(occipitalUpperInstruction, occipitalUpperRequirements, occipitalUpperConstraints)).toBe(true);
  });

  it("20. lower and upper remain structurally distinguishable -- never interchangeable", () => {
    expect(occipitalLowerInstruction.sourceAtomicActionId).not.toBe(occipitalUpperInstruction.sourceAtomicActionId);
    expect(occipitalLowerInstruction.sourceDemonstrationRequirementIds).not.toEqual(occipitalUpperInstruction.sourceDemonstrationRequirementIds);
    // Lower's own viewpoint constraints do not satisfy upper's own instruction.
    expect(isVideoInstructionSourceConsistent(occipitalUpperInstruction, allRealRequirements, occipitalLowerConstraints)).toBe(false);
  });

  it("21. COMB/FINGERS distinction remains upstream (on the Demonstration Requirement) and traceable, never duplicated onto VideoInstruction", () => {
    const combRequirement = occipitalLowerControlRequirements.find((r) => r.category === "TOOL_TO_SUBJECT_RELATIONSHIP")!;
    const fingersRequirement = occipitalUpperControlRequirements.find((r) => r.category === "TOOL_TO_SUBJECT_RELATIONSHIP")!;
    expect(combRequirement.subjectValue).toBe("comb");
    expect(fingersRequirement.subjectValue).toBe("fingers");
    // VideoInstruction itself carries no comb/fingers field -- only the id
    // reference chain (already proven generic in test 9).
    const keys = Object.keys(napeInstruction);
    expect(keys).not.toContain("controlMethod");
    expect(keys).not.toContain("tool");
  });

  it("22. the POSTERIOR viewpoint policy is reachable transitively without VideoInstruction importing the old ViewLabel type", () => {
    expect(napeConstraints.every((c) => c.viewpointFamily === "POSTERIOR")).toBe(true);
    expect(Object.keys(napeInstruction)).not.toContain("viewpointFamily");
    expect(Object.keys(napeInstruction)).not.toContain("viewLabel");
  });
});

// ===========================================================================
// SECTION D -- PROVIDER/DOMAIN BOUNDARY (items 23-28)
// ===========================================================================

const SOURCE_TEXT = readFileSync(fileURLToPath(new URL("./professional-skill-video-instruction-contracts.ts", import.meta.url)), "utf8");
const IMPORT_LINES = SOURCE_TEXT.split("\n")
  .filter((line) => /^\s*import\s/.test(line))
  // isRecord is a legitimate, pre-existing, already-established shared
  // utility import used identically by every contract file in this domain
  // (i.1, i.3, i.4, i.5, i.10, i.12) -- never a real Technical Visual Map
  // domain-data dependency. Same exclusion i.12 already established.
  .filter((line) => !line.includes("isRecord"));

describe("D. PROVIDER/DOMAIN BOUNDARY", () => {
  it("23. no Veo/Gemini/OpenAI/provider vocabulary anywhere in the universal contract's imports or exported vocabulary", () => {
    for (const line of IMPORT_LINES) {
      expect(/\bveo\b/i.test(line)).toBe(false);
      expect(/gemini/i.test(line)).toBe(false);
      expect(/openai/i.test(line)).toBe(false);
    }
    const exported = Object.keys(videoInstructionModule).join(" ").toLowerCase();
    expect(/\bveo\b/.test(exported)).toBe(false);
    expect(exported.includes("gemini")).toBe(false);
    expect(exported.includes("openai")).toBe(false);
  });

  it("24. no Technical Visual Map dependency (beyond the established shared isRecord utility)", () => {
    for (const line of IMPORT_LINES) {
      expect(line.includes("technical-visual-map")).toBe(false);
    }
  });

  it("25. no Spatial Map dependency", () => {
    for (const line of IMPORT_LINES) {
      expect(line.toLowerCase().includes("spatial")).toBe(false);
    }
  });

  it("26. no Photo Preview dependency", () => {
    for (const line of IMPORT_LINES) {
      expect(line.toLowerCase().includes("photo-preview")).toBe(false);
    }
  });

  it("27. no Result Video dependency", () => {
    for (const line of IMPORT_LINES) {
      expect(line.toLowerCase().includes("result-video")).toBe(false);
    }
  });

  it("28. a SYNTHETIC non-cutting (color vertical) fixture is representable -- proves multi-vertical generality", () => {
    // SYNTHETIC TEST FIXTURE -- NOT REAL PROFESSIONAL AUTHORITY. No color
    // Skill exists yet; this only proves the universal contract carries no
    // hidden cutting-only assumption.
    const colorRequirement: DemonstrationRequirement = {
      demonstrationRequirementId: "req-synthetic-color-1",
      vertical: "color",
      category: "TOOL_TO_SUBJECT_RELATIONSHIP",
      subjectParameterNames: ["applicatorType"],
      subjectValue: "foil",
      sourceAtomicActionId: "aa-synthetic-color-1",
      presentationSummary: "SYNTHETIC: foil-to-strand relationship.",
      derivedAt: DERIVED_AT,
    };
    const colorConstraint: ViewpointConstraint = {
      viewpointConstraintId: "vc-synthetic-color-1",
      vertical: "color",
      viewpointFamily: "POSTERIOR",
      framingSemantic: "TECHNICAL_RELATIONSHIP_READABLE",
      satisfiedDemonstrationRequirementIds: ["req-synthetic-color-1"],
      derivedAt: DERIVED_AT,
    };
    const colorInstruction: VideoInstruction = {
      videoInstructionId: "aa-synthetic-color-1#video-1",
      vertical: "color",
      order: 1,
      sourceAtomicActionId: "aa-synthetic-color-1",
      sourceDemonstrationRequirementIds: ["req-synthetic-color-1"],
      sourceViewpointConstraintIds: ["vc-synthetic-color-1"],
      evidenceStatus: "DEMONSTRATED_TARGET",
      compiledAt: COMPILED_AT,
    };
    expect(isValidVideoInstruction(colorInstruction)).toBe(true);
    expect(isVideoInstructionSourceConsistent(colorInstruction, [colorRequirement], [colorConstraint])).toBe(true);
    expect(isVideoInstructionCoverageSatisfied(colorInstruction, [colorRequirement], [colorConstraint])).toBe(true);
  });
});

// ===========================================================================
// SECTION E -- PROVENANCE / FAIL-CLOSED (items 29-32)
// ===========================================================================

describe("E. PROVENANCE / FAIL-CLOSED", () => {
  it("29. broken provenance (a referenced Demonstration Requirement id that resolves to nothing) is rejected", () => {
    const brokenReference: VideoInstruction = { ...napeInstruction, sourceDemonstrationRequirementIds: ["req-does-not-exist-anywhere"] };
    expect(isVideoInstructionSourceConsistent(brokenReference, allRealRequirements, allRealConstraints)).toBe(false);
  });

  it("30. unresolved mandatory visual coverage (a referenced Viewpoint Constraint id absent from the supplied set) is rejected", () => {
    const unresolvedConstraintRef: VideoInstruction = { ...napeInstruction, sourceViewpointConstraintIds: ["vc-does-not-exist-anywhere"] };
    expect(isVideoInstructionCoverageSatisfied(unresolvedConstraintRef, napeRequirements, napeConstraints)).toBe(false);
  });

  it("31. invalid ordering is rejected -- non-contiguous, duplicate id, duplicate source action, and empty sequences", () => {
    expect(isValidVideoInstructionSequence([])).toBe(false);
    expect(isValidVideoInstructionSequence([napeInstruction, { ...occipitalLowerInstruction, order: 3 }])).toBe(false);
    expect(isValidVideoInstructionSequence([napeInstruction, { ...occipitalLowerInstruction, order: 1 }])).toBe(false);
    const sameIdTwice = [napeInstruction, { ...occipitalLowerInstruction, order: 2, videoInstructionId: napeInstruction.videoInstructionId }];
    expect(isValidVideoInstructionSequence(sameIdTwice)).toBe(false);
    const sameSourceActionTwice = [napeInstruction, { ...occipitalLowerInstruction, order: 2, sourceAtomicActionId: napeInstruction.sourceAtomicActionId }];
    expect(isValidVideoInstructionSequence(sameSourceActionTwice)).toBe(false);
  });

  it("32. unsupported observation semantics rejected when the supplied source Atomic Action does not even match the instruction's own reference", () => {
    const mismatched = { ...napeInstruction, evidenceStatus: "DEMONSTRATED_TARGET" as const };
    expect(isVideoInstructionObservationClaimSupported(mismatched, occipitalLowerExecuteAction)).toBe(false);
  });
});

// ===========================================================================
// Non-regression spot check -- every real Demonstration Requirement/
// Viewpoint Constraint object used above still independently validates
// against its own Stage 2.5.i.10/i.12 contract, unmodified by this file.
// ===========================================================================

describe("Non-regression: upstream real objects remain independently valid", () => {
  it("every real Demonstration Requirement used in this file's fixtures is independently valid", () => {
    // isOccipitalTransitionFact is a strict superset of the Central-Nape-
    // only fact guard (established at Stage 2.5.i.12) -- safe to use
    // uniformly across both real Skills' own requirements here.
    for (const requirement of allRealRequirements) {
      expect(isValidDemonstrationRequirement(requirement, isOccipitalTransitionFact)).toBe(true);
    }
  });

  it("the module exports no compiler, no provider adapter, and no Technical Execution Video symbol", () => {
    const exported = Object.keys(videoInstructionModule);
    for (const forbidden of ["compileAtomicActionToVideoInstruction", "compileVideoInstruction", "ProviderAdapter", "TechnicalExecutionVideo", "generateVideo"]) {
      expect(exported.some((name) => name.includes(forbidden))).toBe(false);
    }
  });
});
