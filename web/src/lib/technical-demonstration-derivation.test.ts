import { describe, expect, it } from "vitest";

import type { TechnicalCutPlan } from "@/lib/contracts";
import { deriveCuttingDemonstrationSteps } from "@/lib/technical-demonstration-derivation";
import { isValidCuttingDemonstrationStepPayload } from "@/lib/technical-demonstration-cutting-contracts";

// Technical Demonstration, Stage 1 -- pure derivation tests. No I/O, no
// database, mirrors this codebase's own established convention for a pure
// transform (e.g. photo-preview-instruction-assembler.test.ts).

function cuttingPlan(overrides: Partial<TechnicalCutPlan> = {}): TechnicalCutPlan {
  return {
    structuralTechnique: "graduation",
    cuttingTechnique: "slice_cutting",
    texturizingTechnique: "point_cutting",
    sectioning: "diagonal_back",
    elevation: "45_deg_graduation",
    distribution: "overdirected_back",
    guideline: "stationary",
    cuttingSteps: [
      { stepNumber: 1, zone: "nape", action: "Establish the guideline low in the nape.", elevationAngle: "0_deg_blunt", toolRequired: "shears" },
      { stepNumber: 2, zone: "sides", action: "Blend the sides into the guideline.", elevationAngle: "45_deg_graduation", toolRequired: "shears" },
      { stepNumber: 3, zone: "crown", action: "Connect the crown to the sides.", elevationAngle: "90_deg_uniform_layer", toolRequired: "shears" },
    ],
    stylistExplanation: "x",
    clientExplanation: "x",
    professionalReason: "x",
    warnings: ["Perform a strand test before texturizing."],
    contraindications: ["Client reports a sensitive scalp."],
    assumptions: [],
    missingData: [],
    confidence: 0.9,
    stylistValidationDisclaimer: "x",
    version: "1.0.0-m8",
    ...overrides,
  };
}

describe("deriveCuttingDemonstrationSteps", () => {
  it("derives one step per source cuttingStep, every one a structurally valid payload", () => {
    const steps = deriveCuttingDemonstrationSteps(cuttingPlan());
    expect(steps).toHaveLength(3);
    for (const step of steps) {
      expect(isValidCuttingDemonstrationStepPayload(step.payload)).toBe(true);
    }
  });

  // Required test 3: correct ordered steps.
  it("orders steps by the source's own stepNumber, then renumbers cleanly 1..N regardless of source gaps/order", () => {
    const plan = cuttingPlan({
      cuttingSteps: [
        { stepNumber: 30, zone: "crown", action: "third", elevationAngle: "90_deg_uniform_layer", toolRequired: "shears" },
        { stepNumber: 5, zone: "nape", action: "first", elevationAngle: "0_deg_blunt", toolRequired: "shears" },
        { stepNumber: 17, zone: "sides", action: "second", elevationAngle: "45_deg_graduation", toolRequired: "shears" },
      ],
    });
    const steps = deriveCuttingDemonstrationSteps(plan);
    expect(steps.map((s) => s.stepNumber)).toEqual([1, 2, 3]);
    expect(steps.map((s) => s.explanation)).toEqual(["first", "second", "third"]);
  });

  it("never invents a step beyond what the source plan itself itemized -- zero cuttingSteps produces zero demonstration steps", () => {
    const steps = deriveCuttingDemonstrationSteps(cuttingPlan({ cuttingSteps: [] }));
    expect(steps).toEqual([]);
  });

  // Required test 6: missing technical information is not hallucinated.
  it("represents fields with no Stage 1 source data as honestly UNKNOWN, never fabricated", () => {
    const [step] = deriveCuttingDemonstrationSteps(cuttingPlan());
    const alwaysUnknown = [
      step.payload.headBodyPositioning,
      step.payload.fingerPosition,
      step.payload.cuttingAngle,
      step.payload.cuttingLine,
      step.payload.subsectioning,
      step.payload.zoneConnection,
      step.payload.crossCheck,
      step.payload.styling,
    ];
    for (const field of alwaysUnknown) {
      expect(field).toEqual({ value: null, provenance: "UNKNOWN" });
    }
  });

  it("tags directly-copied source fields as OBSERVED, with the exact source values", () => {
    const [step] = deriveCuttingDemonstrationSteps(cuttingPlan());
    expect(step.payload.zones).toEqual({ value: ["nape"], provenance: "OBSERVED" });
    expect(step.payload.elevation).toEqual({ value: "0_deg_blunt", provenance: "OBSERVED" });
    expect(step.payload.tool).toEqual({ value: "shears", provenance: "OBSERVED" });
  });

  it("tags plan-level-propagated fields as INFERRED, applied uniformly to every step", () => {
    const plan = cuttingPlan();
    const steps = deriveCuttingDemonstrationSteps(plan);
    for (const step of steps) {
      expect(step.payload.sectioning).toEqual({ value: plan.sectioning, provenance: "INFERRED" });
      expect(step.payload.guideType).toEqual({ value: plan.guideline, provenance: "INFERRED" });
      expect(step.payload.structuralTechnique).toEqual({ value: plan.structuralTechnique, provenance: "INFERRED" });
      expect(step.payload.cuttingTechnique).toEqual({ value: plan.cuttingTechnique, provenance: "INFERRED" });
    }
  });

  it("derives combingDirection and overdirection deterministically from distribution -- overdirected values", () => {
    const [step] = deriveCuttingDemonstrationSteps(cuttingPlan({ distribution: "overdirected_forward" }));
    expect(step.payload.combingDirection).toEqual({
      value: "Comb the section overdirected toward the front of the head.",
      provenance: "INFERRED",
    });
    expect(step.payload.overdirection).toEqual({ value: true, provenance: "INFERRED" });
  });

  it("derives combingDirection and overdirection deterministically from distribution -- non-overdirected values", () => {
    const [step] = deriveCuttingDemonstrationSteps(cuttingPlan({ distribution: "natural_fall" }));
    expect(step.payload.combingDirection).toEqual({
      value: "Comb the section to fall naturally, with no directional pull.",
      provenance: "INFERRED",
    });
    expect(step.payload.overdirection).toEqual({ value: false, provenance: "INFERRED" });
  });

  it("handles the optional texturizingTechnique correctly -- present becomes INFERRED, absent becomes UNKNOWN", () => {
    const withTexturizing = deriveCuttingDemonstrationSteps(cuttingPlan({ texturizingTechnique: "razor_texturizing" }))[0];
    expect(withTexturizing.payload.texturizingTechnique).toEqual({ value: "razor_texturizing", provenance: "INFERRED" });

    const withoutTexturizing = deriveCuttingDemonstrationSteps(cuttingPlan({ texturizingTechnique: undefined }))[0];
    expect(withoutTexturizing.payload.texturizingTechnique).toEqual({ value: null, provenance: "UNKNOWN" });
  });

  it("copies the full confirmed warnings+contraindications onto every step's own constraints, verbatim", () => {
    const plan = cuttingPlan({ warnings: ["w1"], contraindications: ["c1", "c2"] });
    const steps = deriveCuttingDemonstrationSteps(plan);
    for (const step of steps) {
      expect(step.payload.constraints).toEqual(["w1", "c1", "c2"]);
    }
  });

  it("falls back honestly to UNKNOWN zones for an out-of-vocabulary zone string, never smuggling an unvalidated value into a typed slot", () => {
    const plan = cuttingPlan({
      cuttingSteps: [{ stepNumber: 1, zone: "not_a_real_zone", action: "x", elevationAngle: "0_deg_blunt", toolRequired: "shears" }],
    });
    const [step] = deriveCuttingDemonstrationSteps(plan);
    expect(step.payload.zones).toEqual({ value: null, provenance: "UNKNOWN" });
    // Still a structurally valid payload overall -- an unknown zone never
    // crashes derivation or produces a malformed record.
    expect(isValidCuttingDemonstrationStepPayload(step.payload)).toBe(true);
  });

  it("keeps the human-readable explanation structurally separate from the structured payload -- never parsed, never validated as an enum", () => {
    const [step] = deriveCuttingDemonstrationSteps(cuttingPlan());
    expect(step.explanation).toBe("Establish the guideline low in the nape.");
    expect(step.payload).not.toHaveProperty("explanation");
  });
});

// RELEASE-BLOCKER FIX -- professional edit provenance / effective payload.
// `plan` is expected to already be the EFFECTIVE plan (baseline + edits
// merged, via technical-visual-map-assembler.ts's own
// computeEffectiveTechnicalCutPlan) by the time it reaches this function --
// these tests exercise ONLY the provenance-tagging half of the fix (the
// VALUE-merging half is proven separately, at the real-DB level, in
// technical-demonstration-repository.test.ts, since the merge itself
// happens in the repository, not here).
describe("deriveCuttingDemonstrationSteps -- editedFields provenance", () => {
  // Required test 1: unedited derivation is unaffected -- the default
  // (omitted) editedFields argument keeps every existing call site and
  // every genuinely unedited proposal deriving exactly as before.
  it("1. defaults to INFERRED for every plan-level field when no editedFields are supplied -- unchanged from before this fix", () => {
    const [step] = deriveCuttingDemonstrationSteps(cuttingPlan());
    expect(step.payload.sectioning.provenance).toBe("INFERRED");
    expect(step.payload.guideType.provenance).toBe("INFERRED");
    expect(step.payload.structuralTechnique.provenance).toBe("INFERRED");
    expect(step.payload.cuttingTechnique.provenance).toBe("INFERRED");
    expect(step.payload.texturizingTechnique.provenance).toBe("INFERRED");
    expect(step.payload.combingDirection.provenance).toBe("INFERRED");
    expect(step.payload.overdirection.provenance).toBe("INFERRED");
  });

  it("an explicitly empty editedFields set behaves identically to the default", () => {
    const withDefault = deriveCuttingDemonstrationSteps(cuttingPlan());
    const withEmptySet = deriveCuttingDemonstrationSteps(cuttingPlan(), new Set());
    expect(withEmptySet).toEqual(withDefault);
  });

  // Required test 5: professional edit provenance is retained/distinguishable.
  it("5. tags a specifically-edited field PROFESSIONAL_OVERRIDE, and every non-edited field stays INFERRED", () => {
    const plan = cuttingPlan({ sectioning: "horseshoe_crown" }); // the caller already merged this value in
    const [step] = deriveCuttingDemonstrationSteps(plan, new Set(["sectioning"]));

    expect(step.payload.sectioning).toEqual({ value: "horseshoe_crown", provenance: "PROFESSIONAL_OVERRIDE" });
    // Untouched fields are unaffected by an edit to a DIFFERENT field.
    expect(step.payload.guideType.provenance).toBe("INFERRED");
    expect(step.payload.structuralTechnique.provenance).toBe("INFERRED");
    expect(step.payload.cuttingTechnique.provenance).toBe("INFERRED");
  });

  // Required test 4: multiple supported edits.
  it("4. tags MULTIPLE edited fields PROFESSIONAL_OVERRIDE simultaneously, independently of each other", () => {
    const plan = cuttingPlan({ structuralTechnique: "one_length", cuttingTechnique: "blunt_line", guideline: "multiple_reference" });
    const [step] = deriveCuttingDemonstrationSteps(plan, new Set(["structuralTechnique", "cuttingTechnique", "guideline"]));

    expect(step.payload.structuralTechnique).toEqual({ value: "one_length", provenance: "PROFESSIONAL_OVERRIDE" });
    expect(step.payload.cuttingTechnique).toEqual({ value: "blunt_line", provenance: "PROFESSIONAL_OVERRIDE" });
    expect(step.payload.guideType).toEqual({ value: "multiple_reference", provenance: "PROFESSIONAL_OVERRIDE" });
    // sectioning was NOT edited -- stays INFERRED.
    expect(step.payload.sectioning.provenance).toBe("INFERRED");
  });

  it("an edit to `distribution` marks BOTH derived fields (combingDirection and overdirection) PROFESSIONAL_OVERRIDE -- both are functions of the same one input", () => {
    const plan = cuttingPlan({ distribution: "natural_fall" });
    const [step] = deriveCuttingDemonstrationSteps(plan, new Set(["distribution"]));

    expect(step.payload.combingDirection).toEqual({
      value: "Comb the section to fall naturally, with no directional pull.",
      provenance: "PROFESSIONAL_OVERRIDE",
    });
    expect(step.payload.overdirection).toEqual({ value: false, provenance: "PROFESSIONAL_OVERRIDE" });
  });

  it("an edited texturizingTechnique is PROFESSIONAL_OVERRIDE; an edit to an UNRELATED field never turns an absent texturizingTechnique into a fabricated value", () => {
    const withTexturizing = deriveCuttingDemonstrationSteps(cuttingPlan({ texturizingTechnique: "channel_cutting" }), new Set(["texturizingTechnique"]))[0];
    expect(withTexturizing.payload.texturizingTechnique).toEqual({ value: "channel_cutting", provenance: "PROFESSIONAL_OVERRIDE" });

    const stillAbsent = deriveCuttingDemonstrationSteps(cuttingPlan({ texturizingTechnique: undefined }), new Set(["sectioning"]))[0];
    expect(stillAbsent.payload.texturizingTechnique).toEqual({ value: null, provenance: "UNKNOWN" });
  });

  it("editedFields naming an unrelated/unsupported field name never affects any real field -- fails closed, never crashes", () => {
    const [step] = deriveCuttingDemonstrationSteps(cuttingPlan(), new Set(["not_a_real_field", "cuttingSteps"]));
    expect(step.payload.sectioning.provenance).toBe("INFERRED");
    expect(step.payload.structuralTechnique.provenance).toBe("INFERRED");
  });

  it("every PROFESSIONAL_OVERRIDE-tagged step payload is still structurally valid", () => {
    const plan = cuttingPlan({ sectioning: "pivot_radial", distribution: "shifting_line" });
    const steps = deriveCuttingDemonstrationSteps(plan, new Set(["sectioning", "distribution"]));
    for (const step of steps) {
      expect(isValidCuttingDemonstrationStepPayload(step.payload)).toBe(true);
    }
  });
});
