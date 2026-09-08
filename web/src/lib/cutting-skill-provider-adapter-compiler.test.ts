import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import * as compilerModule from "@/lib/cutting-skill-provider-adapter-compiler";
import {
  translateVideoInstructionSequenceToProviderAdapterOutput,
  type ProviderAdapterTranslationResult,
  type ProviderAdapterTranslationSuccess,
} from "@/lib/cutting-skill-provider-adapter-compiler";
import type { ProviderAdapterTranslationRequest } from "@/lib/professional-skill-provider-adapter-contracts";

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
import type { DemonstrationRequirement } from "@/lib/professional-skill-demonstration-requirement-contracts";
import { deriveViewpointConstraintsFromDemonstrationRequirements } from "@/lib/cutting-skill-viewpoint-constraint-deriver";
import type { AtomicAction, AtomicActionKind } from "@/lib/professional-skill-atomic-action-contracts";
import { compileAtomicActionToVideoInstruction } from "@/lib/cutting-skill-video-instruction-compiler";
import { isValidVideoInstructionSequence, type VideoInstruction } from "@/lib/professional-skill-video-instruction-contracts";

// AI Hair Architect, Stage 2.5.i.21 -- FIRST REAL PROVIDER ADAPTER
// TRANSLATION TESTS. Every "REAL" fixture below is compiled through the
// ACTUAL Stage 2.5.i.6/i.7 real Skills -> ACTUAL Stage 2.5.i.8 compiler
// -> ACTUAL Stage 2.5.i.10/i.19 deriver -> ACTUAL Stage 2.5.i.12 deriver
// -> ACTUAL Stage 2.5.i.14 compiler -> this stage's own new translator.
// Sections explicitly using fabricated values are labeled "SYNTHETIC TEST
// FIXTURE -- NOT REAL PROFESSIONAL AUTHORITY". Calling any of this has
// ZERO effect anywhere in the application today -- no DB, no provider,
// no runtime wiring.

const COMPILED_AT = "2026-09-08T00:00:00.000Z";
const DERIVED_AT = "2026-09-08T00:00:00.000Z";
const SEALED_REQUEST_ID = "sealed-request-synthetic-1";

const REAL_VISUAL_REFERENCE = { imageAssetId: "image-asset-real-fixture-1", classification: "VISUAL_REFERENCE_ONLY" as const };

// ---------------------------------------------------------------------------
// Real chain builders (mirror cutting-skill-video-instruction-compiler.test.ts).
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
  const result = deriveDemonstrationRequirementsFromAtomicAction(action, ESTABLISH_CENTRAL_NAPE_GUIDE_SKILL_INSTANCE, ESTABLISH_CENTRAL_NAPE_GUIDE_EXECUTION_UNITS[0], isEstablishCentralNapeGuideFact, DERIVED_AT);
  return result.status === "DERIVED" ? result.requirements : [];
}

function occipitalRequirementsFor(action: AtomicAction, euIndex: 0 | 1): readonly DemonstrationRequirement[] {
  const result = deriveDemonstrationRequirementsFromAtomicAction(action, OCCIPITAL_TRANSITION_SKILL_INSTANCE, OCCIPITAL_TRANSITION_EXECUTION_UNITS[euIndex], isOccipitalTransitionFact, DERIVED_AT);
  return result.status === "DERIVED" ? result.requirements : [];
}

function napeGuideVP(requirements: readonly DemonstrationRequirement[]) {
  return deriveViewpointConstraintsFromDemonstrationRequirements(requirements, isEstablishCentralNapeGuideFact, DERIVED_AT);
}

function occipitalVP(requirements: readonly DemonstrationRequirement[]) {
  return deriveViewpointConstraintsFromDemonstrationRequirements(requirements, isOccipitalTransitionFact, DERIVED_AT);
}

function findByKind(actions: readonly AtomicAction[], kind: AtomicActionKind): AtomicAction {
  const action = actions.find((a) => a.actionKind === kind);
  if (!action) throw new Error(`fixture setup error: no real ${kind} action found`);
  return action;
}

function compiledInstruction(result: ReturnType<typeof compileAtomicActionToVideoInstruction>): VideoInstruction {
  if (result.status !== "COMPILED") throw new Error(`fixture setup error: expected COMPILED, got ${result.status}: ${result.status === "UNRESOLVED" ? result.reason : ""}`);
  return result.instruction;
}

// ---------------------------------------------------------------------------
// Real Central Nape Guide fixtures -- all 3 real Atomic Actions, grouped.
// ---------------------------------------------------------------------------

const napeActions = compileNapeGuideActions();
const napePosition = findByKind(napeActions, "POSITION");
const napeControl = findByKind(napeActions, "CONTROL");
const napeExecute = findByKind(napeActions, "EXECUTE");

const napePositionReqs = napeGuideRequirementsFor(napePosition);
const napeControlReqs = napeGuideRequirementsFor(napeControl);
const napeExecuteReqs = napeGuideRequirementsFor(napeExecute);
const napeAllReqs = [...napePositionReqs, ...napeControlReqs, ...napeExecuteReqs];

const napePositionVP = napeGuideVP(napePositionReqs);
const napeControlVP = napeGuideVP(napeControlReqs);
const napeExecuteVP = napeGuideVP(napeExecuteReqs);
const napeAllConstraints = [
  ...(napePositionVP.status === "COVERED" ? napePositionVP.constraints : []),
  ...(napeControlVP.status === "COVERED" ? napeControlVP.constraints : []),
  ...(napeExecuteVP.status === "COVERED" ? napeExecuteVP.constraints : []),
];

const napePositionInstruction = compiledInstruction(compileAtomicActionToVideoInstruction(napePosition, napePositionReqs, napePositionVP, isEstablishCentralNapeGuideFact, COMPILED_AT));
const napeControlInstruction = compiledInstruction(compileAtomicActionToVideoInstruction(napeControl, napeControlReqs, napeControlVP, isEstablishCentralNapeGuideFact, COMPILED_AT));
const napeExecuteInstruction = compiledInstruction(compileAtomicActionToVideoInstruction(napeExecute, napeExecuteReqs, napeExecuteVP, isEstablishCentralNapeGuideFact, COMPILED_AT));

const napeSequence = [napePositionInstruction, napeControlInstruction, napeExecuteInstruction];

function realRequest(overrides: Partial<ProviderAdapterTranslationRequest> = {}): ProviderAdapterTranslationRequest {
  return {
    videoInstructions: napeSequence,
    demonstrationRequirements: napeAllReqs,
    viewpointConstraints: napeAllConstraints,
    visualReference: REAL_VISUAL_REFERENCE,
    authorizationStatus: "VALIDATED",
    visualReferenceQualification: "QUALIFIED",
    sealedRequestId: SEALED_REQUEST_ID,
    ...overrides,
  };
}

function translate(request: ProviderAdapterTranslationRequest = realRequest()): ProviderAdapterTranslationResult {
  return translateVideoInstructionSequenceToProviderAdapterOutput(request, isEstablishCentralNapeGuideFact);
}

// ===========================================================================
// SECTION A -- CONTRACT
// ===========================================================================

describe("A. CONTRACT", () => {
  it("valid adapter input translates successfully", () => {
    expect(translate().status).toBe("TRANSLATED");
  });

  it("invalid sequence (non-contiguous order) is rejected", () => {
    const brokenSequence = [napePositionInstruction, { ...napeExecuteInstruction, order: 3 }];
    const result = translate(realRequest({ videoInstructions: brokenSequence }));
    expect(result.status).toBe("UNRESOLVED");
  });

  it("invalid visual reference (missing) is rejected", () => {
    const result = translate({ ...realRequest(), visualReference: undefined as never });
    expect(result.status).toBe("UNRESOLVED");
  });

  it("invalid authorization precondition is rejected", () => {
    const result = translate(realRequest({ authorizationStatus: "NOT_VALIDATED" }));
    expect(result.status).toBe("UNRESOLVED");
  });

  it("invalid image qualification precondition is rejected", () => {
    const result = translate(realRequest({ visualReferenceQualification: "NOT_QUALIFIED" }));
    expect(result.status).toBe("UNRESOLVED");
  });

  it("invalid provenance (broken reference to a non-existent Demonstration Requirement) is rejected", () => {
    const truncatedReqs = napeAllReqs.filter((r) => r.sourceAtomicActionId !== napeExecute.atomicActionId);
    const result = translate(realRequest({ demonstrationRequirements: truncatedReqs }));
    expect(result.status).toBe("UNRESOLVED");
  });
});

// ===========================================================================
// SECTION B -- TRANSLATION: grouping, ordering, 8/8 real fact matrix
// ===========================================================================

describe("B. TRANSLATION: real Central Nape Guide, grouped as ONE request", () => {
  const result = translate();
  const success = result as ProviderAdapterTranslationSuccess;

  it("deterministic 3-action grouping: exactly ONE output, 3 segments, never three outputs", () => {
    expect(result.status).toBe("TRANSLATED");
    expect(success.output.segments.length).toBe(3);
  });

  it("exact action order preserved: POSITION(1) -> CONTROL(2) -> EXECUTE(3)", () => {
    expect(success.output.segments.map((s) => s.order)).toEqual([1, 2, 3]);
    expect(success.output.segments[0].sourceVideoInstructionId).toBe(napePositionInstruction.videoInstructionId);
    expect(success.output.segments[1].sourceVideoInstructionId).toBe(napeControlInstruction.videoInstructionId);
    expect(success.output.segments[2].sourceVideoInstructionId).toBe(napeExecuteInstruction.videoInstructionId);
  });

  it("8/8 real fact matrix: every fact reachable in the translation output", () => {
    const allFacts = success.output.segments.flatMap((s) => s.requiredVisibleFacts);

    // 1. WET
    expect(allFacts.some((f) => f.category === "SUBJECT_CONDITION_STATE" && f.value === "wet")).toBe(true);
    // 2. posterior / center-nape
    expect(allFacts.some((f) => f.category === "ANATOMICAL_CONTEXT" && f.value === "center_nape")).toBe(true);
    // 3. head forward/down
    expect(allFacts.some((f) => f.category === "SUBJECT_POSITION_STATE" && f.value === "tilted_forward_down")).toBe(true);
    // 4. comb control
    expect(allFacts.some((f) => f.category === "TOOL_TO_SUBJECT_RELATIONSHIP" && f.value === "comb")).toBe(true);
    // 5. 0 degree elevation
    expect(allFacts.some((f) => f.category === "SUBJECT_TO_REFERENCE_GEOMETRY" && f.value === "0_deg_blunt")).toBe(true);
    // 6. straight shear
    expect(allFacts.some((f) => f.category === "TOOL_TO_SUBJECT_RELATIONSHIP" && f.value === "straight_shear")).toBe(true);
    // 7. horizontal shear orientation
    expect(allFacts.some((f) => f.category === "TOOL_TO_SUBJECT_RELATIONSHIP" && f.value === "horizontal")).toBe(true);
    // 8. straight guide/cutting line
    expect(allFacts.some((f) => f.category === "RESULTING_LINE_OR_FORM" && f.value === "straight")).toBe(true);
  });

  it("POSTERIOR viewpoint family preserved on every segment, never invented (no FRONT/LEFT_PROFILE/etc.)", () => {
    for (const segment of success.output.segments) {
      expect(segment.viewpointFamily).toBe("POSTERIOR");
    }
  });

  it("WET remains a STATE fact, never an invented action segment", () => {
    // Exactly 3 segments exist -- one per real Atomic Action. No 4th
    // "wetting action" segment is ever created; WET only ever appears
    // inside an existing segment's own requiredVisibleFacts.
    expect(success.output.segments.length).toBe(3);
    const wetFact = success.output.segments.flatMap((s) => s.requiredVisibleFacts).find((f) => f.value === "wet");
    expect(wetFact?.category).toBe("SUBJECT_CONDITION_STATE");
  });

  it("evidenceStatus is reused directly from each source VideoInstruction, never re-derived", () => {
    expect(success.output.segments[0].evidenceStatus).toBe(napePositionInstruction.evidenceStatus);
    expect(success.output.segments[1].evidenceStatus).toBe(napeControlInstruction.evidenceStatus);
    expect(success.output.segments[2].evidenceStatus).toBe(napeExecuteInstruction.evidenceStatus);
    expect(success.output.segments[2].evidenceStatus).toBe("DEMONSTRATED_TARGET");
  });

  it("provenance: every semantic fact traces back to a real Demonstration Requirement id, every segment traces to a real VideoInstruction/Atomic Action id", () => {
    const reqIds = new Set(napeAllReqs.map((r) => r.demonstrationRequirementId));
    for (const segment of success.output.segments) {
      for (const fact of segment.requiredVisibleFacts) {
        expect(reqIds.has(fact.sourceDemonstrationRequirementId)).toBe(true);
      }
    }
    expect(success.output.segments[2].sourceAtomicActionId).toBe(napeExecute.atomicActionId);
  });

  it("visual reference is never substituted -- output visualReference is exactly the input, no arbitrary fallback", () => {
    expect(success.output.visualReference).toEqual(REAL_VISUAL_REFERENCE);
  });

  it("sealedRequestId passes through unchanged", () => {
    expect(success.output.sealedRequestId).toBe(SEALED_REQUEST_ID);
  });

  it("no provider syntax anywhere in the output -- no camera/timing/model/prompt field", () => {
    const json = JSON.stringify(success.output).toLowerCase();
    for (const forbidden of ["camera", "angle", "degrees_", "lens", "duration", "seconds", "fps", "aspectratio", "resolution", "seed", "veo", "gemini", "prompt", "model"]) {
      expect(json.includes(forbidden)).toBe(false);
    }
  });
});

// ===========================================================================
// SECTION C -- FREE-TEXT BAN
// ===========================================================================

describe("C. FREE-TEXT BAN", () => {
  it("misleading prose on the source Atomic Actions never changes the translated structured facts", () => {
    const mangledExecute = {
      ...napeExecute,
      presentationSummary: "SYNTHETIC prose: hair is dry, use fingers, vertical scissors, raise to 45 degrees.",
      presentationDetail: "SYNTHETIC: absolutely dry, definitely fingers, definitely 45 degrees, definitely vertical.",
    };
    const mangledReqs = napeExecuteReqs.map((r) => ({ ...r, presentationSummary: "SYNTHETIC prose: dry hair, fingers, vertical scissors, 45 degrees." }));
    const mangledResult = compileAtomicActionToVideoInstruction(mangledExecute, mangledReqs, napeExecuteVP, isEstablishCentralNapeGuideFact, COMPILED_AT);
    const mangledInstruction = compiledInstruction(mangledResult);

    const mangledSequence = [napePositionInstruction, napeControlInstruction, mangledInstruction];
    const mangledTranslation = translate(realRequest({ videoInstructions: mangledSequence, demonstrationRequirements: [...napePositionReqs, ...napeControlReqs, ...mangledReqs] }));
    const realTranslation = translate();

    expect(mangledTranslation.status).toBe("TRANSLATED");
    expect(realTranslation.status).toBe("TRANSLATED");
    const mangledSuccess = mangledTranslation as ProviderAdapterTranslationSuccess;
    const realSuccess = realTranslation as ProviderAdapterTranslationSuccess;

    const mangledFacts = mangledSuccess.output.segments.flatMap((s) => s.requiredVisibleFacts.map((f) => f.value));
    const realFacts = realSuccess.output.segments.flatMap((s) => s.requiredVisibleFacts.map((f) => f.value));
    expect(mangledFacts.sort()).toEqual(realFacts.sort());

    // Scan only the semantic fact VALUES, never the whole JSON -- the
    // output's own legitimate `vertical: "cutting"` field would otherwise
    // false-positive against the word "vertical" in the mangled prose
    // (same "prose mentioning a boundary != violating it" lesson this
    // domain has hit before, e.g. Stage 2.5.i.12's own "spatial" false
    // positive).
    const factValues = mangledSuccess.output.segments.flatMap((s) => s.requiredVisibleFacts.map((f) => String(f.value))).join(" ").toLowerCase();
    expect(factValues.includes("dry")).toBe(false);
    expect(factValues.includes("finger")).toBe(false);
    expect(/\bvertical\b/.test(factValues)).toBe(false);
    expect(factValues.includes("45")).toBe(false);
  });
});

// ===========================================================================
// SECTION D -- VISUAL REFERENCE TESTS
// ===========================================================================

describe("D. VISUAL REFERENCE", () => {
  it("one valid VISUAL_REFERENCE_ONLY reference is accepted", () => {
    expect(translate().status).toBe("TRANSLATED");
  });

  it("missing reference is rejected", () => {
    expect(translate({ ...realRequest(), visualReference: undefined as never }).status).toBe("UNRESOLVED");
  });

  it("wrong classification is rejected -- Photo-Preview-like reference not explicitly classified VISUAL_REFERENCE_ONLY", () => {
    // SYNTHETIC TEST FIXTURE -- NOT REAL PROFESSIONAL AUTHORITY.
    const photoPreviewLike = { imageAssetId: "image-asset-ai-generated-1", classification: "AI_GENERATED_RESULT" as never };
    expect(translate(realRequest({ visualReference: photoPreviewLike })).status).toBe("UNRESOLVED");
  });

  it("the contract's own type structurally admits exactly ONE reference, never an array -- two references is impossible to represent", () => {
    // visualReference is typed as a single object; passing an array fails
    // the structural validator the same way any malformed shape would.
    const arrayReference = [REAL_VISUAL_REFERENCE, REAL_VISUAL_REFERENCE] as never;
    expect(translate(realRequest({ visualReference: arrayReference })).status).toBe("UNRESOLVED");
  });

  it("the adapter never selects or substitutes an image on its own", () => {
    const alternate = { imageAssetId: "image-asset-different-fixture-2", classification: "VISUAL_REFERENCE_ONLY" as const };
    const result = translate(realRequest({ visualReference: alternate }));
    expect(result.status).toBe("TRANSLATED");
    const success = result as ProviderAdapterTranslationSuccess;
    expect(success.output.visualReference).toEqual(alternate);
    expect(success.output.visualReference).not.toEqual(REAL_VISUAL_REFERENCE);
  });
});

// ===========================================================================
// SECTION E -- CONSENT PRECONDITION TESTS
// ===========================================================================

describe("E. CONSENT / AUTHORIZATION PRECONDITION", () => {
  it("refuses translation when authorization is missing entirely", () => {
    const request = realRequest();
    delete (request as { authorizationStatus?: unknown }).authorizationStatus;
    expect(translate(request).status).toBe("UNRESOLVED");
  });

  it("refuses translation when authorization is explicitly NOT_VALIDATED (wrong purpose / rejected consent equivalent)", () => {
    expect(translate(realRequest({ authorizationStatus: "NOT_VALIDATED" })).status).toBe("UNRESOLVED");
  });

  it("an unrecognized authorization value is rejected at the structural level, never silently accepted", () => {
    const request = { ...realRequest(), authorizationStatus: "SOMETHING_ELSE" as never };
    expect(translate(request).status).toBe("UNRESOLVED");
  });
});

// ===========================================================================
// SECTION F -- QUALITY PRECONDITION TESTS
// ===========================================================================

describe("F. IMAGE QUALITY PRECONDITION", () => {
  it("QUALIFIED is accepted", () => {
    expect(translate(realRequest({ visualReferenceQualification: "QUALIFIED" })).status).toBe("TRANSLATED");
  });

  it("NOT_QUALIFIED is rejected", () => {
    expect(translate(realRequest({ visualReferenceQualification: "NOT_QUALIFIED" })).status).toBe("UNRESOLVED");
  });

  it("missing/unknown qualification is rejected", () => {
    const request = realRequest();
    delete (request as { visualReferenceQualification?: unknown }).visualReferenceQualification;
    expect(translate(request).status).toBe("UNRESOLVED");
  });
});

// ===========================================================================
// SECTION G -- FAIL-CLOSED: unresolved WET / missing shearOrientation /
// conflicting values -- proven via the GENERIC source-consistency
// mechanism, never a hardcoded cutting-specific rule (see file header).
// ===========================================================================

describe("G. FAIL-CLOSED: generic reference-integrity mechanism", () => {
  it("unresolved hairState -- EXECUTE references a real WET requirement id absent from a truncated set", () => {
    const withoutWet = napeExecuteReqs.filter((r) => r.category !== "SUBJECT_CONDITION_STATE");
    const result = translate(realRequest({ demonstrationRequirements: [...napePositionReqs, ...napeControlReqs, ...withoutWet] }));
    expect(result.status).toBe("UNRESOLVED");
  });

  it("missing shearOrientation -- EXECUTE references a real HORIZONTAL requirement id absent from a truncated set", () => {
    const withoutOrientation = napeExecuteReqs.filter((r) => r.subjectValue !== "horizontal");
    const result = translate(realRequest({ demonstrationRequirements: [...napePositionReqs, ...napeControlReqs, ...withoutOrientation] }));
    expect(result.status).toBe("UNRESOLVED");
  });

  it("no missing-requirement fallback -- an UNRESOLVED result never carries a partial output", () => {
    const withoutWet = napeExecuteReqs.filter((r) => r.category !== "SUBJECT_CONDITION_STATE");
    const result = translate(realRequest({ demonstrationRequirements: [...napePositionReqs, ...napeControlReqs, ...withoutWet] }));
    expect(result.status).toBe("UNRESOLVED");
    expect("output" in result).toBe(false);
  });
});

// ===========================================================================
// SECTION H -- NON-REGRESSION
// ===========================================================================

describe("H. NON-REGRESSION", () => {
  it("i.13 sequence validation unaffected -- the real Nape sequence still validates directly", () => {
    expect(isValidVideoInstructionSequence(napeSequence)).toBe(true);
  });

  it("i.14 real VideoInstruction compiler unaffected -- all three real actions still compile", () => {
    expect(compileAtomicActionToVideoInstruction(napePosition, napePositionReqs, napePositionVP, isEstablishCentralNapeGuideFact, COMPILED_AT).status).toBe("COMPILED");
    expect(compileAtomicActionToVideoInstruction(napeControl, napeControlReqs, napeControlVP, isEstablishCentralNapeGuideFact, COMPILED_AT).status).toBe("COMPILED");
    expect(compileAtomicActionToVideoInstruction(napeExecute, napeExecuteReqs, napeExecuteVP, isEstablishCentralNapeGuideFact, COMPILED_AT).status).toBe("COMPILED");
  });

  it("i.19 8/8 matrix unaffected -- all 8 real facts still present in the raw Demonstration Requirement set", () => {
    expect(napeExecuteReqs.some((r) => r.category === "SUBJECT_CONDITION_STATE" && r.subjectValue === "wet")).toBe(true);
    expect(napeExecuteReqs.some((r) => r.category === "TOOL_TO_SUBJECT_RELATIONSHIP" && r.subjectValue === "horizontal")).toBe(true);
  });

  it("Occipital lower COMB and Occipital upper FINGERS remain distinguishable through the NEW translator too", () => {
    function fullOccipitalRequest(euIndex: 0 | 1): ProviderAdapterTranslationRequest {
      const actions = compileOccipitalActions(euIndex);
      const position = findByKind(actions, "POSITION");
      const control = findByKind(actions, "CONTROL");
      const execute = findByKind(actions, "EXECUTE");

      const positionReqs = occipitalRequirementsFor(position, euIndex);
      const controlReqs = occipitalRequirementsFor(control, euIndex);
      const executeReqs = occipitalRequirementsFor(execute, euIndex);
      const allReqs = [...positionReqs, ...controlReqs, ...executeReqs];

      const positionVP = occipitalVP(positionReqs);
      const controlVP = occipitalVP(controlReqs);
      const executeVP = occipitalVP(executeReqs);
      const allConstraints = [
        ...(positionVP.status === "COVERED" ? positionVP.constraints : []),
        ...(controlVP.status === "COVERED" ? controlVP.constraints : []),
        ...(executeVP.status === "COVERED" ? executeVP.constraints : []),
      ];

      const positionInstruction = compiledInstruction(compileAtomicActionToVideoInstruction(position, positionReqs, positionVP, isOccipitalTransitionFact, COMPILED_AT));
      const controlInstruction = compiledInstruction(compileAtomicActionToVideoInstruction(control, controlReqs, controlVP, isOccipitalTransitionFact, COMPILED_AT));
      const executeInstruction = compiledInstruction(compileAtomicActionToVideoInstruction(execute, executeReqs, executeVP, isOccipitalTransitionFact, COMPILED_AT));

      return {
        videoInstructions: [positionInstruction, controlInstruction, executeInstruction],
        demonstrationRequirements: allReqs,
        viewpointConstraints: allConstraints,
        visualReference: REAL_VISUAL_REFERENCE,
        authorizationStatus: "VALIDATED",
        visualReferenceQualification: "QUALIFIED",
        sealedRequestId: SEALED_REQUEST_ID,
      };
    }

    const lowerResult = translateVideoInstructionSequenceToProviderAdapterOutput(fullOccipitalRequest(0), isOccipitalTransitionFact);
    const upperResult = translateVideoInstructionSequenceToProviderAdapterOutput(fullOccipitalRequest(1), isOccipitalTransitionFact);

    expect(lowerResult.status === "UNRESOLVED" ? lowerResult.reason : "ok").toBe("ok");
    expect(upperResult.status === "UNRESOLVED" ? upperResult.reason : "ok").toBe("ok");
    const lowerFacts = (lowerResult as ProviderAdapterTranslationSuccess).output.segments.flatMap((s) => s.requiredVisibleFacts);
    const upperFacts = (upperResult as ProviderAdapterTranslationSuccess).output.segments.flatMap((s) => s.requiredVisibleFacts);
    expect(lowerFacts.some((f) => f.value === "comb")).toBe(true);
    expect(upperFacts.some((f) => f.value === "fingers")).toBe(true);
    expect(lowerFacts.some((f) => f.value === "fingers")).toBe(false);
    expect(upperFacts.some((f) => f.value === "comb")).toBe(false);
  });
});

// ===========================================================================
// SECTION I -- DETERMINISM
// ===========================================================================

describe("I. DETERMINISM", () => {
  it("the same structured input produces a deep-equal translation output", () => {
    const first = translate();
    const second = translate();
    expect(second).toEqual(first);
  });
});

// ===========================================================================
// SECTION J -- PROVIDER/DOMAIN BOUNDARY (source-level scan)
// ===========================================================================

const SOURCE_TEXT = readFileSync(fileURLToPath(new URL("./cutting-skill-provider-adapter-compiler.ts", import.meta.url)), "utf8");
const IMPORT_LINES = SOURCE_TEXT.split("\n").filter((line) => /^\s*import\s/.test(line));

describe("J. PROVIDER/DOMAIN BOUNDARY", () => {
  it("no Veo/Gemini/OpenAI/provider vocabulary anywhere in the compiler's imports or exports", () => {
    for (const line of IMPORT_LINES) {
      expect(/\bveo\b/i.test(line)).toBe(false);
      expect(/gemini/i.test(line)).toBe(false);
      expect(/openai/i.test(line)).toBe(false);
    }
    const exported = Object.keys(compilerModule).join(" ").toLowerCase();
    expect(exported.includes("veo")).toBe(false);
    expect(exported.includes("provider") && exported.includes("veo")).toBe(false);
  });

  it("no Technical Visual Map / Spatial Map / Photo Preview / Result Video dependency", () => {
    for (const line of IMPORT_LINES) {
      expect(line.toLowerCase().includes("technical-visual-map")).toBe(false);
      expect(line.toLowerCase().includes("spatial")).toBe(false);
      expect(line.toLowerCase().includes("photo-preview")).toBe(false);
      expect(line.toLowerCase().includes("result-video")).toBe(false);
    }
  });

  it("the module implements no compiler beyond this pilot's own translation function -- no provider adapter concrete implementation", () => {
    const exported = Object.keys(compilerModule);
    for (const forbidden of ["ProviderAdapterImplementation", "VeoAdapter", "generateVideo", "callProvider"]) {
      expect(exported.some((name) => name.includes(forbidden))).toBe(false);
    }
  });
});
