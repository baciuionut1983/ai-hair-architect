import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { assembleTechnicalExecutionVeoInstruction } from "@/lib/technical-execution-video-veo-serializer";
import { compileContinueCentralNapeConstructionProviderAdapterOutput } from "@/lib/cutting-skill-continue-central-nape-construction-provider-request";
import { translateVideoInstructionSequenceToProviderAdapterOutput } from "@/lib/cutting-skill-provider-adapter-compiler";
import type { ProviderAdapterTranslationOutput, ProviderAdapterTranslationRequest } from "@/lib/professional-skill-provider-adapter-contracts";

import { compileExecutionUnitToAtomicActions, type AtomicActionCompilationSuccess } from "@/lib/cutting-skill-atomic-action-compiler";
import {
  ESTABLISH_CENTRAL_NAPE_GUIDE_EXECUTION_UNITS,
  ESTABLISH_CENTRAL_NAPE_GUIDE_SKILL,
  ESTABLISH_CENTRAL_NAPE_GUIDE_SKILL_INSTANCE,
  isEstablishCentralNapeGuideFact,
} from "@/lib/cutting-skill-establish-central-nape-guide";
import { deriveDemonstrationRequirementsFromAtomicAction } from "@/lib/cutting-skill-demonstration-requirement-deriver";
import type { DemonstrationRequirement } from "@/lib/professional-skill-demonstration-requirement-contracts";
import { deriveViewpointConstraintsFromDemonstrationRequirements } from "@/lib/cutting-skill-viewpoint-constraint-deriver";
import type { AtomicAction, AtomicActionKind } from "@/lib/professional-skill-atomic-action-contracts";
import { compileAtomicActionToVideoInstruction } from "@/lib/cutting-skill-video-instruction-compiler";
import type { VideoInstruction } from "@/lib/professional-skill-video-instruction-contracts";

// AI Hair Architect, Stage 2.5.i.23 -- TECHNICAL EXECUTION VIDEO, VEO
// PROVIDER SERIALIZER TESTS. The real ProviderAdapterTranslationOutput
// fixture below is compiled through the ACTUAL Stage 2.5.i.6 real Skill ->
// ACTUAL Stage 2.5.i.8/i.10/i.12/i.14/i.21 compiler/deriver chain (mirrors
// cutting-skill-provider-adapter-compiler.test.ts's own "REAL" fixtures
// exactly). Calling any of this has ZERO effect anywhere in the application
// today -- no DB, no provider, no network call, no runtime wiring.

const COMPILED_AT = "2026-09-08T00:00:00.000Z";
const DERIVED_AT = "2026-09-08T00:00:00.000Z";
const SEALED_REQUEST_ID = "sealed-request-real-pilot-1";
const REAL_VISUAL_REFERENCE = { imageAssetId: "image-asset-real-fixture-1", classification: "VISUAL_REFERENCE_ONLY" as const };

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

function napeGuideRequirementsFor(action: AtomicAction): readonly DemonstrationRequirement[] {
  const result = deriveDemonstrationRequirementsFromAtomicAction(action, ESTABLISH_CENTRAL_NAPE_GUIDE_SKILL_INSTANCE, ESTABLISH_CENTRAL_NAPE_GUIDE_EXECUTION_UNITS[0], isEstablishCentralNapeGuideFact, DERIVED_AT);
  return result.status === "DERIVED" ? result.requirements : [];
}

function napeGuideVP(requirements: readonly DemonstrationRequirement[]) {
  return deriveViewpointConstraintsFromDemonstrationRequirements(requirements, isEstablishCentralNapeGuideFact, DERIVED_AT);
}

function findByKind(actions: readonly AtomicAction[], kind: AtomicActionKind): AtomicAction {
  const action = actions.find((a) => a.actionKind === kind);
  if (!action) throw new Error(`fixture setup error: no real ${kind} action found`);
  return action;
}

function compiledInstruction(result: ReturnType<typeof compileAtomicActionToVideoInstruction>): VideoInstruction {
  if (result.status !== "COMPILED") throw new Error(`fixture setup error: expected COMPILED, got ${result.status}`);
  return result.instruction;
}

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

function realOutput(): ProviderAdapterTranslationOutput {
  const result = translateVideoInstructionSequenceToProviderAdapterOutput(realRequest(), isEstablishCentralNapeGuideFact);
  if (result.status !== "TRANSLATED") throw new Error("fixture setup error: expected TRANSLATED");
  return result.output;
}

describe("technical-execution-video-veo-serializer (real Central Nape Guide pilot)", () => {
  const instruction = assembleTechnicalExecutionVeoInstruction(realOutput());

  it("A. produces a non-empty string", () => {
    expect(typeof instruction).toBe("string");
    expect(instruction.length).toBeGreaterThan(0);
  });

  it("B. mentions all 8 real facts, humanized", () => {
    expect(instruction).toMatch(/Wet/i);
    expect(instruction).toMatch(/Center Nape/i);
    expect(instruction).toMatch(/Tilted Forward Down/i);
    expect(instruction).toMatch(/\bComb\b/i);
    expect(instruction).toMatch(/0 Deg Blunt/i);
    expect(instruction).toMatch(/Straight Shear/i);
    expect(instruction).toMatch(/Horizontal/i);
    expect(instruction).toMatch(/Straight/i);
  });

  it("C. mentions POSTERIOR framing wording, and only ever negates front/profile/overhead/orbit -- never requests one", () => {
    expect(instruction).toMatch(/posterior/i);
    // "front"/"profile"/"overhead"/"orbit" may appear ONLY inside the exact
    // negation clause every segment repeats verbatim ("never a front,
    // side-profile, overhead, or orbiting camera") -- proven by counting:
    // exactly one occurrence per segment (3 segments), never a positive
    // framing request elsewhere in the text.
    const negationClause = "never a front, side-profile, overhead, or orbiting camera";
    const negationCount = instruction.split(negationClause).length - 1;
    expect(negationCount).toBe(3);
    expect(instruction.match(/\bfront\b/gi)?.length).toBe(negationCount);
    expect(instruction.match(/profile/gi)?.length).toBe(negationCount);
    expect(instruction.match(/overhead/gi)?.length).toBe(negationCount);
    expect(instruction.match(/orbit/gi)?.length).toBe(negationCount);
  });

  it("D. exactly 3 numbered sequence steps, in POSITION -> CONTROL -> EXECUTE order", () => {
    const stepLines = instruction.split("\n").filter((line) => /^\d+\.\s/.test(line));
    expect(stepLines.length).toBe(3);
    expect(stepLines[0].startsWith("1.")).toBe(true);
    expect(stepLines[1].startsWith("2.")).toBe(true);
    expect(stepLines[2].startsWith("3.")).toBe(true);
  });

  it("E. never mentions wetting/spraying/shampooing/preparing as an action -- WET only ever appears as a state word", () => {
    expect(instruction).not.toMatch(/spray/i);
    expect(instruction).not.toMatch(/shampoo/i);
    expect(instruction).not.toMatch(/wetting/i);
    expect(instruction).not.toMatch(/wet the hair/i);
    expect(instruction).not.toMatch(/apply water/i);
  });

  it("F. instructs the provider to show, not narrate, and forbids on-screen text/invented content", () => {
    expect(instruction).toMatch(/do not narrate/i);
    expect(instruction).toMatch(/no text overlays/i);
    expect(instruction).toMatch(/do not add, invent, or substitute/i);
  });

  it("G. deterministic: the same output always produces byte-identical instruction text", () => {
    const again = assembleTechnicalExecutionVeoInstruction(realOutput());
    expect(again).toBe(instruction);
  });

  it("H. stale/unrelated free text cannot affect the output -- the function has exactly two parameters, both strictly typed (ProviderAdapterTranslationOutput, and an optional, closed-shape demonstration-hints object with only subsectionSizeHint/repeatCountHint -- never a free-text channel), and omitting the second parameter is byte-identical to a prior call", () => {
    expect(assembleTechnicalExecutionVeoInstruction.length).toBe(2);
    expect(instruction).toBe(assembleTechnicalExecutionVeoInstruction(realOutput()));
  });

  it("I. static import boundary: this file never imports any forbidden stale-prose source", () => {
    const sourcePath = fileURLToPath(new URL("./technical-execution-video-veo-serializer.ts", import.meta.url));
    const source = readFileSync(sourcePath, "utf8");
    const forbiddenImports = [
      "video-generation-instruction-assembler",
      "video-generation-contracts",
      "photo-preview-contracts",
      "analysis-proposal",
      "technical-demonstration-plan",
      "@google/genai",
    ];
    for (const forbidden of forbiddenImports) {
      expect(source.includes(forbidden)).toBe(false);
    }
  });

  it("J. does not embed the visual reference image id into the instruction text -- the image is a separate attachment, never re-described in prose", () => {
    expect(instruction.includes(REAL_VISUAL_REFERENCE.imageAssetId)).toBe(false);
  });
});

// ===========================================================================
// Stage 2.5.i.25 -- PROCEDURAL PROGRESSION REACHABILITY: the serializer
// correctly renders an iteration-bearing ProviderAdapterTranslationOutput
// (real "Continue Central Nape Construction" content) as an explicit
// repeated step, and demonstration hints (repeat count, subsection size)
// remain a separate, optional, non-authority parameter.
// ===========================================================================

function realProgressionOutput() {
  const result = compileContinueCentralNapeConstructionProviderAdapterOutput({
    sealedRequestId: "sealed-request-progression-serializer-1",
    visualReference: REAL_VISUAL_REFERENCE,
    authorizationStatus: "VALIDATED",
    visualReferenceQualification: "QUALIFIED",
    compiledAt: COMPILED_AT,
  });
  if (result.status !== "TRANSLATED") throw new Error(`fixture setup error: expected TRANSLATED, got ${result.status}`);
  return result.output;
}

describe("technical-execution-video-veo-serializer -- procedural progression (real Continue Central Nape Construction pilot)", () => {
  const progressionInstruction = assembleTechnicalExecutionVeoInstruction(realProgressionOutput());

  it("E. the iteration signal reaches the serializer: repeated steps are phrased as explicit repetition, never a single flat action", () => {
    expect(progressionInstruction).toMatch(/repeatedly/i);
    expect(progressionInstruction).toMatch(/while the current professional conditions remain true/i);
  });

  it("the one-shot POSITION step is NOT phrased as repeated", () => {
    const stepLines = progressionInstruction.split("\n").filter((line) => /^\d+\.\s/.test(line));
    expect(stepLines.length).toBe(3);
    expect(stepLines[0]).not.toMatch(/repeatedly/i);
    expect(stepLines[1]).toMatch(/repeatedly/i);
    expect(stepLines[2]).toMatch(/repeatedly/i);
  });

  it("mentions the progressive guide reference and identifiability facts, both present and phrased", () => {
    expect(progressionInstruction).toMatch(/previous subsection/i);
    expect(progressionInstruction).toMatch(/must remain visually identifiable/i);
  });

  it("F. omitting demonstrationHints entirely never invents a subsection size or repeat count -- structurally absent from the output", () => {
    expect(progressionInstruction).not.toMatch(/\bcm\b/i);
    expect(progressionInstruction).not.toMatch(/repetitions/i);
    expect(progressionInstruction).not.toMatch(/for this demonstration/i);
  });

  it("F/G. supplying demonstrationHints renders them as a SEPARATE sentence, distinct from the structured guide-identifiability fact", () => {
    const withHints = assembleTechnicalExecutionVeoInstruction(realProgressionOutput(), { subsectionSizeHint: "1cm", repeatCountHint: 3 });
    expect(withHints).toMatch(/for this demonstration, render approximately 3 repetitions, each subsection approximately 1cm/i);
    // The structured, authority-derived fact is untouched by the hint text.
    expect(withHints).toMatch(/must remain visually identifiable/i);
    // The hint sentence and the structured fact are genuinely different
    // substrings -- proving they were not merged into one.
    const lowered = withHints.toLowerCase();
    const hintSentenceIndex = lowered.indexOf("for this demonstration");
    const identifiabilityIndex = lowered.indexOf("must remain visually identifiable");
    expect(hintSentenceIndex).toBeGreaterThan(-1);
    expect(identifiabilityIndex).toBeGreaterThan(-1);
    expect(hintSentenceIndex).not.toBe(identifiabilityIndex);
  });

  it("AA. no provider-specific duration (seconds) ever appears in the instruction text -- rendering-layer only, never authority text", () => {
    expect(progressionInstruction).not.toMatch(/\bseconds?\b/i);
    expect(progressionInstruction).not.toMatch(/\b8s\b/i);
    expect(progressionInstruction).not.toMatch(/veo|gemini|google/i);
  });

  it("X. deterministic and immune to stale free text: two independent compilations of the same real content produce byte-identical instructions", () => {
    expect(assembleTechnicalExecutionVeoInstruction(realProgressionOutput())).toBe(progressionInstruction);
  });
});
