import { describe, expect, it } from "vitest";

import { compileEstablishCentralNapeGuideProviderAdapterOutput } from "@/lib/cutting-skill-establish-central-nape-guide-provider-request";

// AI Hair Architect, Stage 2.5.i.23 -- proves the pilot-scoped real chain
// compiler produces exactly the same real output the i.21 compiler test's
// own hand-assembled fixture proves (cutting-skill-provider-adapter-compiler.test.ts) --
// this is the promotion of that same recipe into real, callable code.

const COMPILED_AT = "2026-09-08T00:00:00.000Z";
const VISUAL_REFERENCE = { imageAssetId: "image-asset-real-pilot-1", classification: "VISUAL_REFERENCE_ONLY" as const };

function realOutput() {
  const result = compileEstablishCentralNapeGuideProviderAdapterOutput({
    sealedRequestId: "sealed-request-1",
    visualReference: VISUAL_REFERENCE,
    authorizationStatus: "VALIDATED",
    visualReferenceQualification: "QUALIFIED",
    compiledAt: COMPILED_AT,
  });
  if (result.status !== "TRANSLATED") throw new Error(`fixture setup error: expected TRANSLATED, got ${result.status}: ${result.status === "UNRESOLVED" ? result.reason : ""}`);
  return result.output;
}

describe("cutting-skill-establish-central-nape-guide-provider-request (pilot real chain compiler)", () => {
  it("A. TRANSLATED with authorization/qualification VALIDATED/QUALIFIED", () => {
    const result = compileEstablishCentralNapeGuideProviderAdapterOutput({
      sealedRequestId: "sealed-request-1",
      visualReference: VISUAL_REFERENCE,
      authorizationStatus: "VALIDATED",
      visualReferenceQualification: "QUALIFIED",
      compiledAt: COMPILED_AT,
    });
    expect(result.status).toBe("TRANSLATED");
  });

  it("B. UNRESOLVED when authorizationStatus is NOT_VALIDATED (fail-closed passthrough)", () => {
    const result = compileEstablishCentralNapeGuideProviderAdapterOutput({
      sealedRequestId: "sealed-request-1",
      visualReference: VISUAL_REFERENCE,
      authorizationStatus: "NOT_VALIDATED",
      visualReferenceQualification: "QUALIFIED",
      compiledAt: COMPILED_AT,
    });
    expect(result.status).toBe("UNRESOLVED");
  });

  it("C. UNRESOLVED when visualReferenceQualification is NOT_QUALIFIED (fail-closed passthrough)", () => {
    const result = compileEstablishCentralNapeGuideProviderAdapterOutput({
      sealedRequestId: "sealed-request-1",
      visualReference: VISUAL_REFERENCE,
      authorizationStatus: "VALIDATED",
      visualReferenceQualification: "NOT_QUALIFIED",
      compiledAt: COMPILED_AT,
    });
    expect(result.status).toBe("UNRESOLVED");
  });

  it("D. exactly 3 segments, POSITION -> CONTROL -> EXECUTE order", () => {
    const output = realOutput();
    expect(output.segments.length).toBe(3);
    expect(output.segments.map((s) => s.order)).toEqual([1, 2, 3]);
  });

  it("E. visual reference passes through unchanged -- never substituted", () => {
    expect(realOutput().visualReference).toEqual(VISUAL_REFERENCE);
  });

  it("F. sealedRequestId passes through unchanged", () => {
    expect(realOutput().sealedRequestId).toBe("sealed-request-1");
  });

  it("G. POSTERIOR viewpoint family on every segment", () => {
    for (const segment of realOutput().segments) {
      expect(segment.viewpointFamily).toBe("POSTERIOR");
    }
  });

  it("H. 8/8 real facts reachable", () => {
    const allFacts = realOutput().segments.flatMap((s) => s.requiredVisibleFacts);
    expect(allFacts.some((f) => f.category === "SUBJECT_CONDITION_STATE" && f.value === "wet")).toBe(true);
    expect(allFacts.some((f) => f.category === "TOOL_TO_SUBJECT_RELATIONSHIP" && f.value === "comb")).toBe(true);
    expect(allFacts.some((f) => f.category === "SUBJECT_TO_REFERENCE_GEOMETRY" && f.value === "0_deg_blunt")).toBe(true);
    expect(allFacts.some((f) => f.category === "TOOL_TO_SUBJECT_RELATIONSHIP" && f.value === "horizontal")).toBe(true);
    expect(allFacts.some((f) => f.category === "RESULTING_LINE_OR_FORM" && f.value === "straight")).toBe(true);
  });

  it("I. deterministic: two calls with the same input produce structurally equal output", () => {
    const a = realOutput();
    const b = realOutput();
    expect(a).toEqual(b);
  });
});
