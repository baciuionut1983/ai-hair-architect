import { describe, expect, it } from "vitest";

import type { CuttingStep, TechnicalCutPlan } from "@/lib/contracts";
import { deriveCuttingDemonstrationSteps } from "@/lib/technical-demonstration-derivation";
import { isValidCuttingDemonstrationStepPayload } from "@/lib/technical-demonstration-cutting-contracts";

// Technical Demonstration, Stage 1 (+ Stage 2.5.a) -- pure derivation
// tests. No I/O, no database, mirrors this codebase's own established
// convention for a pure transform (e.g. photo-preview-instruction-
// assembler.test.ts).
//
// Stage 2.5.a fixture note: `realisticCuttingSteps` below uses the EXACT
// step "zone" label strings cutting-plan-engine.ts's own
// generateTechnicalCutPlan really emits ("Mapping and sectioning", ...) --
// this is what lets these tests exercise the real phase-detection/
// phase-scoped-propagation logic honestly, matching real production shape,
// rather than the arbitrary HeadZone-named fixture Stage 1's own tests
// used (kept below, explicitly, only for the couple of tests that are
// specifically about the zones-from-a-real-HeadZone-string mechanism in
// isolation -- a mechanism that is real and correct, but that Stage 2.5.a's
// own audit proved never actually fires against this codebase's one real
// producer).

function cuttingPlan(overrides: Partial<TechnicalCutPlan> = {}): TechnicalCutPlan {
  return {
    structuralTechnique: "one_length",
    cuttingTechnique: "blunt_line",
    texturizingTechnique: "slice_and_slide",
    sectioning: "4_quadrant_profile_radial",
    elevation: "0_deg_blunt",
    distribution: "natural_fall",
    guideline: "visual_perimeter",
    cuttingSteps: realisticCuttingSteps(),
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

// Mirrors cutting-plan-engine.ts's own generateTechnicalCutPlan output
// shape exactly (same 5 fixed "zone" label strings, same tool progression)
// -- the real production shape, not a synthetic stand-in.
function realisticCuttingSteps(includeTexturizing = true): CuttingStep[] {
  const steps: CuttingStep[] = [
    {
      stepNumber: 1,
      zone: "Mapping and sectioning",
      action: "Partition using 4 quadrant profile radial with visual balance checkpoints.",
      elevationAngle: "0_deg_blunt",
      toolRequired: "tail-comb",
    },
    {
      stepNumber: 2,
      zone: "Baseline guideline",
      action: "Set a visual perimeter guideline and establish the structural shape with one length.",
      elevationAngle: "0_deg_blunt",
      toolRequired: "straight-shear",
    },
    {
      stepNumber: 3,
      zone: "Bulk and shape control",
      action: "Use blunt line for perimeter control and natural fall distribution for silhouette correction.",
      elevationAngle: "0_deg_blunt",
      toolRequired: "straight-shear",
    },
  ];
  if (includeTexturizing) {
    steps.push({
      stepNumber: 4,
      zone: "Texture refinement",
      action: "Apply slice and slide only after the structural form is established.",
      elevationAngle: "0_deg_blunt",
      toolRequired: "texturizer-shear",
    });
  }
  steps.push({
    stepNumber: includeTexturizing ? 5 : 4,
    zone: "Cross-check and finish",
    action: "Finish with slice and slide to soften line weight, then cross-check symmetry at profile and frontal view.",
    elevationAngle: "0_deg_blunt",
    toolRequired: "finishing-comb",
  });
  return steps;
}

describe("deriveCuttingDemonstrationSteps", () => {
  it("derives one step per source cuttingStep, every one a structurally valid payload", () => {
    const steps = deriveCuttingDemonstrationSteps(cuttingPlan());
    expect(steps).toHaveLength(5);
    for (const step of steps) {
      expect(isValidCuttingDemonstrationStepPayload(step.payload)).toBe(true);
    }
  });

  // Required test 2: deterministic order.
  it("orders steps by the source's own stepNumber, then renumbers cleanly 1..N regardless of source gaps/order", () => {
    const plan = cuttingPlan({
      cuttingSteps: [
        { stepNumber: 30, zone: "Cross-check and finish", action: "third", elevationAngle: "90_deg_uniform_layer", toolRequired: "shears" },
        { stepNumber: 5, zone: "Mapping and sectioning", action: "first", elevationAngle: "0_deg_blunt", toolRequired: "shears" },
        { stepNumber: 17, zone: "Baseline guideline", action: "second", elevationAngle: "45_deg_graduation", toolRequired: "shears" },
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

  // Required tests 9-14 + 17: missing technical information is not
  // hallucinated, across every field with no Stage 2.5.a source data.
  it("represents fields with no source data as honestly UNKNOWN, never fabricated", () => {
    const [step] = deriveCuttingDemonstrationSteps(cuttingPlan());
    const alwaysUnknown = [
      step.payload.headBodyPositioning,
      step.payload.fingerPosition,
      step.payload.fingerAngle,
      step.payload.cuttingAngle,
      step.payload.cuttingLine,
      step.payload.subsectioning,
      step.payload.subsectionThickness,
      step.payload.toolOrientation,
      step.payload.progression,
      step.payload.zoneConnection,
      step.payload.crossCheck,
      step.payload.styling,
      step.payload.stateBefore,
      step.payload.stateAfter,
    ];
    for (const field of alwaysUnknown) {
      expect(field).toEqual({ value: null, provenance: "UNKNOWN" });
    }
  });

  // Required test 7: tool behavior remains unchanged and genuinely varies
  // per step.
  it("7. tags `tool` OBSERVED with the exact source value on EVERY step regardless of phase -- it genuinely varies per step in real engine output", () => {
    const steps = deriveCuttingDemonstrationSteps(cuttingPlan());
    expect(steps[0].payload.tool).toEqual({ value: "tail-comb", provenance: "OBSERVED" });
    expect(steps[1].payload.tool).toEqual({ value: "straight-shear", provenance: "OBSERVED" });
    expect(steps[2].payload.tool).toEqual({ value: "straight-shear", provenance: "OBSERVED" });
  });

  // RELEASE-BLOCKER FIX (Stage 2.5.a pre-push gate) -- required tests
  // 1-6: `elevation` is deliberately NOT the same as `tool` -- real
  // production testing proved it is the SAME uniform value on every step
  // (the engine's own single plan-wide variable), so it must be
  // phase-scoped just like the seven plan-level fields, tagged OBSERVED
  // only where it is genuine cutting geometry (STRUCTURAL_CUTTING),
  // UNKNOWN everywhere else.
  it("1-6. tags `elevation` OBSERVED ONLY on the STRUCTURAL_CUTTING-phase step, honestly UNKNOWN on every other phase -- never a global value smeared across unrelated steps", () => {
    const [sectioningStep, guideStep, structuralStep, refinementStep, crossCheckStep] = deriveCuttingDemonstrationSteps(cuttingPlan());

    // 3. STRUCTURAL_CUTTING may expose elevation when semantically supported.
    expect(structuralStep.payload.phase.value).toBe("STRUCTURAL_CUTTING");
    expect(structuralStep.payload.elevation).toEqual({ value: "0_deg_blunt", provenance: "OBSERVED" });

    // 1/2/4/5/6: every other phase does NOT inherit it -- honestly
    // UNKNOWN, never a fallback guess. The exact "unacceptable result"
    // the pre-push gate named -- a real, live trace of the actual engine
    // proved every one of these was previously OBSERVED "0_deg_blunt" too.
    expect(sectioningStep.payload.phase.value).toBe("PREPARATION_AND_SECTIONING");
    expect(sectioningStep.payload.elevation).toEqual({ value: null, provenance: "UNKNOWN" }); // 1
    expect(guideStep.payload.phase.value).toBe("GUIDE_AND_STRUCTURE");
    expect(guideStep.payload.elevation).toEqual({ value: null, provenance: "UNKNOWN" }); // 2
    expect(refinementStep.payload.phase.value).toBe("REFINEMENT_TEXTURIZING");
    expect(refinementStep.payload.elevation).toEqual({ value: null, provenance: "UNKNOWN" }); // 4
    expect(crossCheckStep.payload.phase.value).toBe("CROSS_CHECK_AND_FINISH");
    expect(crossCheckStep.payload.elevation).toEqual({ value: null, provenance: "UNKNOWN" }); // 5, 6
  });

  // The zones-from-a-real-HeadZone-string mechanism, tested in isolation:
  // real, correct, and defensive, even though Stage 2.5.a's own audit
  // proved this codebase's one real producer (cutting-plan-engine.ts)
  // never actually supplies a real HeadZone string here today (see the
  // "phase label cannot become a zone" test below for that honest,
  // production-shaped case).
  it("tags zones OBSERVED when the source step's own zone string is a real, recognized HeadZone", () => {
    const plan = cuttingPlan({
      cuttingSteps: [{ stepNumber: 1, zone: "nape", action: "x", elevationAngle: "0_deg_blunt", toolRequired: "shears" }],
    });
    const [step] = deriveCuttingDemonstrationSteps(plan);
    expect(step.payload.zones).toEqual({ value: ["nape"], provenance: "OBSERVED" });
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

  it("copies the full confirmed warnings+contraindications onto every step's own constraints, verbatim", () => {
    const plan = cuttingPlan({ warnings: ["w1"], contraindications: ["c1", "c2"] });
    const steps = deriveCuttingDemonstrationSteps(plan);
    for (const step of steps) {
      expect(step.payload.constraints).toEqual(["w1", "c1", "c2"]);
    }
  });

  it("keeps the human-readable explanation structurally separate from the structured payload -- never parsed, never validated as an enum", () => {
    const [step] = deriveCuttingDemonstrationSteps(cuttingPlan());
    expect(step.explanation).toBe("Partition using 4 quadrant profile radial with visual balance checkpoints.");
    expect(step.payload).not.toHaveProperty("explanation");
  });

  // -------------------------------------------------------------------------
  // Stage 2.5.a -- execution phase detection.
  // -------------------------------------------------------------------------
  describe("execution phase detection", () => {
    // Required test 3: steps are assigned to valid execution phases.
    it("3. resolves each of the 5 known engine phase labels to its own correct, distinct phase, as INFERRED", () => {
      const steps = deriveCuttingDemonstrationSteps(cuttingPlan());
      expect(steps.map((s) => s.payload.phase)).toEqual([
        { value: "PREPARATION_AND_SECTIONING", provenance: "INFERRED" },
        { value: "GUIDE_AND_STRUCTURE", provenance: "INFERRED" },
        { value: "STRUCTURAL_CUTTING", provenance: "INFERRED" },
        { value: "REFINEMENT_TEXTURIZING", provenance: "INFERRED" },
        { value: "CROSS_CHECK_AND_FINISH", provenance: "INFERRED" },
      ]);
    });

    // Required test 6: a phase label can never become an anatomical zone.
    it("6. a real phase label ('Mapping and sectioning') is correctly resolved as a PHASE, and never becomes an anatomical zone -- zones stays honestly UNKNOWN for it", () => {
      const [step] = deriveCuttingDemonstrationSteps(cuttingPlan());
      expect(step.payload.phase).toEqual({ value: "PREPARATION_AND_SECTIONING", provenance: "INFERRED" });
      expect(step.payload.zones).toEqual({ value: null, provenance: "UNKNOWN" });
    });

    it("resolves an unrecognized zone/phase-label string honestly to UNKNOWN phase, never a guess", () => {
      const plan = cuttingPlan({
        cuttingSteps: [{ stepNumber: 1, zone: "Some future phase nobody wrote a lookup entry for", action: "x", elevationAngle: "0_deg_blunt", toolRequired: "shears" }],
      });
      const [step] = deriveCuttingDemonstrationSteps(plan);
      expect(step.payload.phase).toEqual({ value: null, provenance: "UNKNOWN" });
    });
  });

  // -------------------------------------------------------------------------
  // Stage 2.5.a -- the granularity fix: plan-level fields are propagated
  // ONLY onto the step whose own phase is where that fact is genuinely
  // true, never blindly onto every step.
  // -------------------------------------------------------------------------
  describe("plan-level field propagation is phase-scoped, not uniform", () => {
    // Required test 4.
    it("4. plan-level values are NOT blindly copied into every step -- each field appears only on its own applicable-phase step", () => {
      const [sectioningStep, guideStep, structuralStep, refinementStep, crossCheckStep] = deriveCuttingDemonstrationSteps(cuttingPlan());

      expect(sectioningStep.payload.sectioning).toEqual({ value: "4_quadrant_profile_radial", provenance: "INFERRED" });
      expect(sectioningStep.payload.guideType).toEqual({ value: null, provenance: "UNKNOWN" });
      expect(sectioningStep.payload.structuralTechnique).toEqual({ value: null, provenance: "UNKNOWN" });

      expect(guideStep.payload.guideType).toEqual({ value: "visual_perimeter", provenance: "INFERRED" });
      expect(guideStep.payload.sectioning).toEqual({ value: null, provenance: "UNKNOWN" });
      expect(guideStep.payload.structuralTechnique).toEqual({ value: null, provenance: "UNKNOWN" });

      expect(structuralStep.payload.structuralTechnique).toEqual({ value: "one_length", provenance: "INFERRED" });
      expect(structuralStep.payload.cuttingTechnique).toEqual({ value: "blunt_line", provenance: "INFERRED" });
      expect(structuralStep.payload.combingDirection.provenance).toBe("INFERRED");
      expect(structuralStep.payload.overdirection.provenance).toBe("INFERRED");
      expect(structuralStep.payload.texturizingTechnique).toEqual({ value: null, provenance: "UNKNOWN" });
      expect(structuralStep.payload.sectioning).toEqual({ value: null, provenance: "UNKNOWN" });

      expect(refinementStep.payload.texturizingTechnique).toEqual({ value: "slice_and_slide", provenance: "INFERRED" });

      // Cross-check/finish is not any plan-level field's applicable phase.
      expect(crossCheckStep.payload.structuralTechnique).toEqual({ value: null, provenance: "UNKNOWN" });
      expect(crossCheckStep.payload.sectioning).toEqual({ value: null, provenance: "UNKNOWN" });
      expect(crossCheckStep.payload.guideType).toEqual({ value: null, provenance: "UNKNOWN" });
    });

    // Required test 5.
    it("5. a refinement step does not falsely inherit structural cutting geometry merely because the plan globally contains it", () => {
      const steps = deriveCuttingDemonstrationSteps(cuttingPlan());
      const refinementStep = steps.find((s) => s.payload.phase.value === "REFINEMENT_TEXTURIZING");
      expect(refinementStep).toBeDefined();
      expect(refinementStep!.payload.structuralTechnique).toEqual({ value: null, provenance: "UNKNOWN" });
      expect(refinementStep!.payload.cuttingTechnique).toEqual({ value: null, provenance: "UNKNOWN" });
      expect(refinementStep!.payload.combingDirection).toEqual({ value: null, provenance: "UNKNOWN" });
      expect(refinementStep!.payload.overdirection).toEqual({ value: null, provenance: "UNKNOWN" });
      // It DOES correctly carry its own genuinely-applicable field.
      expect(refinementStep!.payload.texturizingTechnique.provenance).toBe("INFERRED");
    });

    it("when a step's own phase cannot be determined (UNKNOWN), every phase-scoped plan-level field is honestly UNKNOWN too -- never a fallback guess", () => {
      const plan = cuttingPlan({
        cuttingSteps: [{ stepNumber: 1, zone: "an unrecognized label", action: "x", elevationAngle: "0_deg_blunt", toolRequired: "shears" }],
      });
      const [step] = deriveCuttingDemonstrationSteps(plan);
      expect(step.payload.phase).toEqual({ value: null, provenance: "UNKNOWN" });
      expect(step.payload.sectioning).toEqual({ value: null, provenance: "UNKNOWN" });
      expect(step.payload.guideType).toEqual({ value: null, provenance: "UNKNOWN" });
      expect(step.payload.structuralTechnique).toEqual({ value: null, provenance: "UNKNOWN" });
      expect(step.payload.cuttingTechnique).toEqual({ value: null, provenance: "UNKNOWN" });
      expect(step.payload.texturizingTechnique).toEqual({ value: null, provenance: "UNKNOWN" });
      expect(step.payload.combingDirection).toEqual({ value: null, provenance: "UNKNOWN" });
      expect(step.payload.overdirection).toEqual({ value: null, provenance: "UNKNOWN" });
      // `elevation` is ALSO phase-scoped (release-blocker fix) -- an
      // unknown phase means we cannot honestly claim this step's own
      // recorded elevationAngle is the real STRUCTURAL_CUTTING geometry.
      expect(step.payload.elevation).toEqual({ value: null, provenance: "UNKNOWN" });
      // `tool` is NOT phase-scoped -- read unconditionally from the
      // step's own record regardless of phase.
      expect(step.payload.tool).toEqual({ value: "shears", provenance: "OBSERVED" });
    });

    it("handles the optional texturizingTechnique correctly on its own applicable-phase step -- present becomes INFERRED, absent becomes UNKNOWN", () => {
      const withTexturizing = deriveCuttingDemonstrationSteps(cuttingPlan({ texturizingTechnique: "razor_texturizing" }));
      const refinementStep = withTexturizing.find((s) => s.payload.phase.value === "REFINEMENT_TEXTURIZING")!;
      expect(refinementStep.payload.texturizingTechnique).toEqual({ value: "razor_texturizing", provenance: "INFERRED" });

      const withoutTexturizing = deriveCuttingDemonstrationSteps(cuttingPlan({ texturizingTechnique: undefined, cuttingSteps: realisticCuttingSteps(false) }));
      for (const step of withoutTexturizing) {
        expect(step.payload.texturizingTechnique).toEqual({ value: null, provenance: "UNKNOWN" });
      }
    });

    it("derives combingDirection and overdirection deterministically from distribution, only on the STRUCTURAL_CUTTING-phase step -- overdirected values", () => {
      const steps = deriveCuttingDemonstrationSteps(cuttingPlan({ distribution: "overdirected_forward" }));
      const structuralStep = steps.find((s) => s.payload.phase.value === "STRUCTURAL_CUTTING")!;
      expect(structuralStep.payload.combingDirection).toEqual({
        value: "Comb the section overdirected toward the front of the head.",
        provenance: "INFERRED",
      });
      expect(structuralStep.payload.overdirection).toEqual({ value: true, provenance: "INFERRED" });
    });

    it("derives combingDirection and overdirection deterministically from distribution, only on the STRUCTURAL_CUTTING-phase step -- non-overdirected values", () => {
      const steps = deriveCuttingDemonstrationSteps(cuttingPlan({ distribution: "natural_fall" }));
      const structuralStep = steps.find((s) => s.payload.phase.value === "STRUCTURAL_CUTTING")!;
      expect(structuralStep.payload.combingDirection).toEqual({
        value: "Comb the section to fall naturally, with no directional pull.",
        provenance: "INFERRED",
      });
      expect(structuralStep.payload.overdirection).toEqual({ value: false, provenance: "INFERRED" });
    });
  });
});

// Stage 2.5.d -- actionType derivation. Deterministic and certain for the
// 3 phases where a real technique is always attached; honestly UNKNOWN for
// GUIDE_AND_STRUCTURE/CROSS_CHECK_AND_FINISH -- never guessed from the
// step's own free-text `action` or its `toolRequired`.
describe("deriveCuttingDemonstrationSteps -- actionType derivation", () => {
  it("PREPARATION_AND_SECTIONING -> SECTIONING_ACTION (INFERRED)", () => {
    const steps = deriveCuttingDemonstrationSteps(cuttingPlan());
    expect(steps[0].payload.actionType).toEqual({ value: "SECTIONING_ACTION", provenance: "INFERRED" });
  });

  it("STRUCTURAL_CUTTING -> STRUCTURAL_CUTTING (INFERRED)", () => {
    const steps = deriveCuttingDemonstrationSteps(cuttingPlan());
    expect(steps[2].payload.actionType).toEqual({ value: "STRUCTURAL_CUTTING", provenance: "INFERRED" });
  });

  it("REFINEMENT_TEXTURIZING -> TEXTURIZING_ACTION (INFERRED)", () => {
    const steps = deriveCuttingDemonstrationSteps(cuttingPlan());
    expect(steps[3].payload.actionType).toEqual({ value: "TEXTURIZING_ACTION", provenance: "INFERRED" });
  });

  it("GUIDE_AND_STRUCTURE -> UNKNOWN -- never guessed between GUIDE_OBSERVATION and GUIDE_CUTTING", () => {
    const steps = deriveCuttingDemonstrationSteps(cuttingPlan());
    expect(steps[1].payload.actionType).toEqual({ value: null, provenance: "UNKNOWN" });
  });

  it("CROSS_CHECK_AND_FINISH -> UNKNOWN -- never guessed between FINAL_OBSERVATION and CORRECTIVE_CUTTING", () => {
    const steps = deriveCuttingDemonstrationSteps(cuttingPlan());
    expect(steps[4].payload.actionType).toEqual({ value: null, provenance: "UNKNOWN" });
  });

  it("an unrecognized phase (null) also cascades to UNKNOWN actionType, same as every other phase-scoped field", () => {
    const badZoneSteps = realisticCuttingSteps().map((s) => (s.stepNumber === 1 ? { ...s, zone: "not_a_real_phase_label" } : s));
    const steps = deriveCuttingDemonstrationSteps(cuttingPlan({ cuttingSteps: badZoneSteps }));
    expect(steps[0].payload.phase).toEqual({ value: null, provenance: "UNKNOWN" });
    expect(steps[0].payload.actionType).toEqual({ value: null, provenance: "UNKNOWN" });
  });

  it("no text-based inference -- actionType is identical regardless of the step's own free-text action/explanation", () => {
    const stepsWithDifferentText = realisticCuttingSteps().map((s) => ({ ...s, action: "completely unrelated free text mentioning cutting, guiding, and observing" }));
    const steps = deriveCuttingDemonstrationSteps(cuttingPlan({ cuttingSteps: stepsWithDifferentText }));
    expect(steps[0].payload.actionType.value).toBe("SECTIONING_ACTION");
    expect(steps[1].payload.actionType).toEqual({ value: null, provenance: "UNKNOWN" }); // still UNKNOWN, text never overrides this
    expect(steps[4].payload.actionType).toEqual({ value: null, provenance: "UNKNOWN" }); // still UNKNOWN, text never overrides this
  });

  it("no tool-based inference -- actionType is identical regardless of which tool the step requires", () => {
    const stepsWithDifferentTools = realisticCuttingSteps().map((s) => ({ ...s, toolRequired: "straight-shear" }));
    const steps = deriveCuttingDemonstrationSteps(cuttingPlan({ cuttingSteps: stepsWithDifferentTools }));
    expect(steps[0].payload.actionType.value).toBe("SECTIONING_ACTION"); // still sectioning, even with a cutting tool listed
    expect(steps[1].payload.actionType).toEqual({ value: null, provenance: "UNKNOWN" }); // still UNKNOWN, tool never resolves the guide split
  });
});

// RELEASE-BLOCKER FIX -- professional edit provenance / effective payload.
// `plan` is expected to already be the EFFECTIVE plan (baseline + edits
// merged, via technical-visual-map-assembler.ts's own
// computeEffectiveTechnicalCutPlan) by the time it reaches this function --
// these tests exercise ONLY the provenance-tagging half of the fix (the
// VALUE-merging half is proven separately, at the real-DB level, in
// technical-demonstration-repository.test.ts, since the merge itself
// happens in the repository, not here). Stage 2.5.a note: these fixtures
// now use realistic phase-labeled cuttingSteps, so the field being
// exercised is always read from ITS OWN applicable-phase step -- an edit
// to a field never has a chance to prove anything on a step where that
// field is honestly UNKNOWN regardless of edit status.
describe("deriveCuttingDemonstrationSteps -- editedFields provenance", () => {
  // Required test 1: unedited derivation is unaffected -- the default
  // (omitted) editedFields argument keeps every existing call site and
  // every genuinely unedited proposal deriving exactly as before.
  it("1. defaults to INFERRED for every plan-level field (on its own applicable-phase step) when no editedFields are supplied", () => {
    const [sectioningStep, guideStep, structuralStep, refinementStep] = deriveCuttingDemonstrationSteps(cuttingPlan());
    expect(sectioningStep.payload.sectioning.provenance).toBe("INFERRED");
    expect(guideStep.payload.guideType.provenance).toBe("INFERRED");
    expect(structuralStep.payload.structuralTechnique.provenance).toBe("INFERRED");
    expect(structuralStep.payload.cuttingTechnique.provenance).toBe("INFERRED");
    expect(structuralStep.payload.combingDirection.provenance).toBe("INFERRED");
    expect(structuralStep.payload.overdirection.provenance).toBe("INFERRED");
    expect(refinementStep.payload.texturizingTechnique.provenance).toBe("INFERRED");
  });

  it("an explicitly empty editedFields set behaves identically to the default", () => {
    const withDefault = deriveCuttingDemonstrationSteps(cuttingPlan());
    const withEmptySet = deriveCuttingDemonstrationSteps(cuttingPlan(), new Set());
    expect(withEmptySet).toEqual(withDefault);
  });

  // Required test 5: professional edit provenance is retained/distinguishable.
  it("5. tags a specifically-edited field PROFESSIONAL_OVERRIDE on its own applicable-phase step, and every non-edited field stays INFERRED", () => {
    const plan = cuttingPlan({ sectioning: "horseshoe_crown" }); // the caller already merged this value in
    const [sectioningStep, guideStep, structuralStep] = deriveCuttingDemonstrationSteps(plan, new Set(["sectioning"]));

    expect(sectioningStep.payload.sectioning).toEqual({ value: "horseshoe_crown", provenance: "PROFESSIONAL_OVERRIDE" });
    // Untouched fields, on their own applicable-phase steps, are unaffected
    // by an edit to a DIFFERENT field.
    expect(guideStep.payload.guideType.provenance).toBe("INFERRED");
    expect(structuralStep.payload.structuralTechnique.provenance).toBe("INFERRED");
    expect(structuralStep.payload.cuttingTechnique.provenance).toBe("INFERRED");
  });

  // Required test 4: multiple supported edits.
  it("4. tags MULTIPLE edited fields PROFESSIONAL_OVERRIDE simultaneously, independently of each other, each on its own applicable-phase step", () => {
    const plan = cuttingPlan({ structuralTechnique: "one_length", cuttingTechnique: "blunt_line", guideline: "multiple_reference" });
    const [, guideStep, structuralStep] = deriveCuttingDemonstrationSteps(plan, new Set(["structuralTechnique", "cuttingTechnique", "guideline"]));

    expect(structuralStep.payload.structuralTechnique).toEqual({ value: "one_length", provenance: "PROFESSIONAL_OVERRIDE" });
    expect(structuralStep.payload.cuttingTechnique).toEqual({ value: "blunt_line", provenance: "PROFESSIONAL_OVERRIDE" });
    expect(guideStep.payload.guideType).toEqual({ value: "multiple_reference", provenance: "PROFESSIONAL_OVERRIDE" });
    // sectioning was NOT edited -- stays INFERRED on its own applicable step.
    const [sectioningStep] = deriveCuttingDemonstrationSteps(plan, new Set(["structuralTechnique", "cuttingTechnique", "guideline"]));
    expect(sectioningStep.payload.sectioning.provenance).toBe("INFERRED");
  });

  it("an edit to `distribution` marks BOTH derived fields (combingDirection and overdirection) PROFESSIONAL_OVERRIDE on the STRUCTURAL_CUTTING-phase step -- both are functions of the same one input", () => {
    const plan = cuttingPlan({ distribution: "natural_fall" });
    const steps = deriveCuttingDemonstrationSteps(plan, new Set(["distribution"]));
    const structuralStep = steps.find((s) => s.payload.phase.value === "STRUCTURAL_CUTTING")!;

    expect(structuralStep.payload.combingDirection).toEqual({
      value: "Comb the section to fall naturally, with no directional pull.",
      provenance: "PROFESSIONAL_OVERRIDE",
    });
    expect(structuralStep.payload.overdirection).toEqual({ value: false, provenance: "PROFESSIONAL_OVERRIDE" });
  });

  it("an edited texturizingTechnique is PROFESSIONAL_OVERRIDE on the REFINEMENT_TEXTURIZING-phase step; an edit to an UNRELATED field never turns an absent texturizingTechnique into a fabricated value", () => {
    const withTexturizing = deriveCuttingDemonstrationSteps(cuttingPlan({ texturizingTechnique: "channel_cutting" }), new Set(["texturizingTechnique"]));
    const refinementStep = withTexturizing.find((s) => s.payload.phase.value === "REFINEMENT_TEXTURIZING")!;
    expect(refinementStep.payload.texturizingTechnique).toEqual({ value: "channel_cutting", provenance: "PROFESSIONAL_OVERRIDE" });

    const stillAbsentSteps = deriveCuttingDemonstrationSteps(
      cuttingPlan({ texturizingTechnique: undefined, cuttingSteps: realisticCuttingSteps(false) }),
      new Set(["sectioning"]),
    );
    for (const step of stillAbsentSteps) {
      expect(step.payload.texturizingTechnique).toEqual({ value: null, provenance: "UNKNOWN" });
    }
  });

  it("editedFields naming an unrelated/unsupported field name never affects any real field -- fails closed, never crashes", () => {
    const [sectioningStep, , structuralStep] = deriveCuttingDemonstrationSteps(cuttingPlan(), new Set(["not_a_real_field", "cuttingSteps"]));
    expect(sectioningStep.payload.sectioning.provenance).toBe("INFERRED");
    expect(structuralStep.payload.structuralTechnique.provenance).toBe("INFERRED");
  });

  it("every PROFESSIONAL_OVERRIDE-tagged step payload is still structurally valid", () => {
    const plan = cuttingPlan({ sectioning: "pivot_radial", distribution: "shifting_line" });
    const steps = deriveCuttingDemonstrationSteps(plan, new Set(["sectioning", "distribution"]));
    for (const step of steps) {
      expect(isValidCuttingDemonstrationStepPayload(step.payload)).toBe(true);
    }
  });
});
