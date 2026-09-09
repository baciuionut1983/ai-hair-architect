import { describe, expect, it } from "vitest";

import { compileContinueCentralNapeConstructionProviderAdapterOutput } from "@/lib/cutting-skill-continue-central-nape-construction-provider-request";
import { compileEstablishCentralNapeGuideProviderAdapterOutput } from "@/lib/cutting-skill-establish-central-nape-guide-provider-request";

// AI Hair Architect, Stage 2.5.i.25 -- PROCEDURAL PROGRESSION REACHABILITY
// PROOF. Proves that `AtomicAction.iteration` (Stage 2.5.i.4's own
// already-existing, previously-unpropagated concept), now populated by the
// real "Continue Central Nape Construction" content, survives the FULL
// real compile chain: Skill -> Atomic Action -> Demonstration Requirement
// -> Viewpoint Constraint -> VideoInstruction -> Provider Adapter output.
// No provider call anywhere in this file -- purely offline compilation.

const COMPILED_AT = "2026-09-09T00:00:00.000Z";
const VISUAL_REFERENCE = { imageAssetId: "image-asset-real-pilot-progression-1", classification: "VISUAL_REFERENCE_ONLY" as const };

function realOutput() {
  const result = compileContinueCentralNapeConstructionProviderAdapterOutput({
    sealedRequestId: "sealed-request-progression-1",
    visualReference: VISUAL_REFERENCE,
    authorizationStatus: "VALIDATED",
    visualReferenceQualification: "QUALIFIED",
    compiledAt: COMPILED_AT,
  });
  if (result.status !== "TRANSLATED") throw new Error(`fixture setup error: expected TRANSLATED, got ${result.status}: ${result.status === "UNRESOLVED" ? result.reason : ""}`);
  return result.output;
}

describe("cutting-skill-continue-central-nape-construction-provider-request (real progression pilot, full chain reachability)", () => {
  it("A/B. compiles successfully -- iteration does not die at Atomic Action", () => {
    const result = compileContinueCentralNapeConstructionProviderAdapterOutput({
      sealedRequestId: "s1",
      visualReference: VISUAL_REFERENCE,
      authorizationStatus: "VALIDATED",
      visualReferenceQualification: "QUALIFIED",
      compiledAt: COMPILED_AT,
    });
    expect(result.status).toBe("TRANSLATED");
  });

  it("exactly 3 segments (POSITION/CONTROL/EXECUTE), in order", () => {
    const output = realOutput();
    expect(output.segments.length).toBe(3);
    expect(output.segments.map((s) => s.order)).toEqual([1, 2, 3]);
  });

  it("D. iteration reaches the Provider Adapter output, present on CONTROL and EXECUTE segments, absent on POSITION", () => {
    const output = realOutput();
    const [position, control, execute] = output.segments;
    expect(position.iteration).toBeUndefined();
    expect(control.iteration).toBeDefined();
    expect(execute.iteration).toBeDefined();
    expect(control.iteration?.mode).toBe("UNTIL_EXECUTION_UNIT_COMPLETE");
    expect(execute.iteration?.mode).toBe("UNTIL_EXECUTION_UNIT_COMPLETE");
    expect(control.iteration?.count).toBeUndefined();
  });

  it("H/I. the guide-reference fact is the RELATIVE 'previous_subsection' rule -- never the original central guide", () => {
    const output = realOutput();
    const allFacts = output.segments.flatMap((s) => s.requiredVisibleFacts);
    const guideReferenceFact = allFacts.find((f) => f.value === "previous_subsection");
    expect(guideReferenceFact).toBeDefined();
    expect(guideReferenceFact?.category).toBe("SUBJECT_TO_REFERENCE_GEOMETRY");
    expect(allFacts.some((f) => f.value === "center_nape" && f.category === "SUBJECT_TO_REFERENCE_GEOMETRY")).toBe(false);
  });

  it("G. guide identifiability is a SEPARATE fact from the guide-reference rule", () => {
    const output = realOutput();
    const allFacts = output.segments.flatMap((s) => s.requiredVisibleFacts);
    const identifiability = allFacts.find((f) => f.value === "must_remain_visually_identifiable");
    const reference = allFacts.find((f) => f.value === "previous_subsection");
    expect(identifiability).toBeDefined();
    expect(identifiability?.sourceDemonstrationRequirementId).not.toBe(reference?.sourceDemonstrationRequirementId);
  });

  it("J-Q. every stable professional fact reachable: natural fall, 0deg, no overdirection (structurally implied by never appearing), comb, wet, straight shear, horizontal, straight line", () => {
    const allFacts = realOutput().segments.flatMap((s) => s.requiredVisibleFacts);
    expect(allFacts.some((f) => f.category === "SUBJECT_TO_REFERENCE_GEOMETRY" && f.value === "natural_fall")).toBe(true);
    expect(allFacts.some((f) => f.category === "SUBJECT_TO_REFERENCE_GEOMETRY" && f.value === "0_deg_blunt")).toBe(true);
    expect(allFacts.some((f) => f.category === "TOOL_TO_SUBJECT_RELATIONSHIP" && f.value === "comb")).toBe(true);
    expect(allFacts.some((f) => f.category === "SUBJECT_CONDITION_STATE" && f.value === "wet")).toBe(true);
    expect(allFacts.some((f) => f.category === "TOOL_TO_SUBJECT_RELATIONSHIP" && f.value === "straight_shear")).toBe(true);
    expect(allFacts.some((f) => f.category === "TOOL_TO_SUBJECT_RELATIONSHIP" && f.value === "horizontal")).toBe(true);
    expect(allFacts.some((f) => f.category === "RESULTING_LINE_OR_FORM" && f.value === "straight")).toBe(true);
  });

  it("T/U/V/W. no fingers/graduation/Slice And Slide/texturizing anywhere in the compiled output", () => {
    const output = realOutput();
    const haystack = JSON.stringify(output).toLowerCase();
    expect(haystack.includes("fingers")).toBe(false);
    expect(haystack.includes("graduat")).toBe(false);
    expect(haystack.includes("slice_and_slide")).toBe(false);
    expect(haystack.includes("texturiz")).toBe(false);
  });

  it("R. POSTERIOR viewpoint preserved on every segment -- progression advances anatomically, never a new viewpoint", () => {
    for (const segment of realOutput().segments) {
      expect(segment.viewpointFamily).toBe("POSTERIOR");
    }
  });

  it("Y. Central Nape Guide's own i.23 single-action pilot is completely unaffected -- no iteration field on its own output", () => {
    const result = compileEstablishCentralNapeGuideProviderAdapterOutput({
      sealedRequestId: "sealed-request-y-regression",
      visualReference: VISUAL_REFERENCE,
      authorizationStatus: "VALIDATED",
      visualReferenceQualification: "QUALIFIED",
      compiledAt: COMPILED_AT,
    });
    if (result.status !== "TRANSLATED") throw new Error("expected TRANSLATED");
    for (const segment of result.output.segments) {
      expect(segment.iteration).toBeUndefined();
    }
    expect(result.output.segments.length).toBe(3);
  });

  it("deterministic: two calls produce structurally equal output", () => {
    expect(realOutput()).toEqual(realOutput());
  });
});
