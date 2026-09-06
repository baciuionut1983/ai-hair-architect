import { describe, expect, it } from "vitest";

import { buildCuttingSteps, generateTechnicalCutPlan, shouldGenerateTechnicalCutPlan } from "./cutting-plan-engine";

describe("cutting-plan-engine", () => {
  it("decides when to generate technical plan", () => {
    expect(
      shouldGenerateTechnicalCutPlan({
        goal: "refresh",
        hairType: "medium",
        density: "medium",
        porosity: "medium"
      })
    ).toBe(false);

    expect(
      shouldGenerateTechnicalCutPlan({
        goal: "reshape",
        hairType: "medium",
        density: "medium",
        porosity: "medium"
      })
    ).toBe(true);
  });

  it("returns deterministic technical coordinates and safety metadata", () => {
    const plan = generateTechnicalCutPlan({
      goal: "reshape",
      hairType: "fine",
      density: "low",
      porosity: "high",
      faceShape: "oval",
      headShape: "balanced",
      hairLength: "short",
      hairTexture: "curly",
      hairCondition: "fragile_breakage",
      growthPattern: "double_crown",
      targetShape: "graduated_bob"
    });

    expect(plan.structuralTechnique).toBe("graduation");
    expect(plan.cuttingTechnique).toBe("slice_cutting");
    expect(plan.texturizingTechnique).toBe("point_cutting");
    expect(plan.elevation).toBe("45_deg_graduation");
    expect(plan.guideline).toBe("multiple_reference");
    expect(plan.cuttingSteps.length).toBeGreaterThan(0);
    expect(plan.warnings.length).toBeGreaterThan(0);
    expect(plan.contraindications.length).toBeGreaterThan(0);
    expect(plan.assumptions.length).toBeGreaterThanOrEqual(0);
    expect(plan.notes?.some((note) => note.includes("point cutting"))).toBe(true);
    expect(plan.confidence).toBeLessThanOrEqual(0.96);
    expect(plan.version).toBe("1.1.0-m8");
  });

  // Regression coverage for the production complaint: real, provider-supplied
  // visual attributes must actually reach the plan and stop being reported
  // as missing/assumed -- this is the engine-side half of that fix (the
  // Gemini-side half is in image-analysis-provider-gemini.test.ts).
  it("does not flag faceShape/headShape/hairLength/growthPattern as missing, and does not fall back to their neutral assumptions, once real values are supplied", () => {
    const plan = generateTechnicalCutPlan({
      goal: "reshape",
      hairType: "medium",
      density: "medium",
      porosity: "medium",
      faceShape: "heart",
      headShape: "flat_occipital",
      hairLength: "long",
      growthPattern: "front_cowlick"
    });

    expect(plan.missingData).not.toContain("faceShape");
    expect(plan.missingData).not.toContain("headShape");
    expect(plan.missingData).not.toContain("hairLength");
    expect(plan.missingData).not.toContain("growthPattern");
    expect(plan.assumptions.some((assumption) => assumption.includes("neutral face balance"))).toBe(false);
    expect(plan.assumptions.some((assumption) => assumption.includes("balanced occipital"))).toBe(false);
    expect(plan.assumptions.some((assumption) => assumption.includes("regular growth pattern"))).toBe(false);
  });

  // Regression (AI Proposed Look Apply-consistency audit): a live production
  // report showed applying "Blunt Perimeter Texturized" leave the displayed
  // haircut plan unchanged (still Internal Layering/Scissor Over Comb/4
  // Quadrant Profile Radial/90 Deg Uniform Layer/Perpendicular/Traveling --
  // this function's own neutral defaults). Root cause: three of the seven
  // TargetShape enum values (blunt_perimeter_texturized, shag_mullet,
  // pixie_crop) had no branch here, so recomputation genuinely ran but
  // produced the same defaults as "no targetShape at all." Each of these
  // must now produce coordinates distinct from the neutral defaults and
  // from each other.
  it("gives blunt_perimeter_texturized, shag_mullet, and pixie_crop each their own distinct technical coordinates instead of falling through to the neutral defaults", () => {
    const NEUTRAL_DEFAULTS = {
      structuralTechnique: "internal_layering",
      cuttingTechnique: "scissor_over_comb",
      sectioning: "4_quadrant_profile_radial",
      elevation: "90_deg_uniform_layer",
      distribution: "perpendicular",
      guideline: "traveling",
    };

    const blunt = generateTechnicalCutPlan({
      goal: "reshape",
      hairType: "medium",
      density: "medium",
      porosity: "medium",
      targetShape: "blunt_perimeter_texturized",
    });
    expect(blunt).not.toMatchObject(NEUTRAL_DEFAULTS);
    expect(blunt.structuralTechnique).toBe("one_length");
    expect(blunt.cuttingTechnique).toBe("blunt_line");
    expect(blunt.texturizingTechnique).toBe("slice_and_slide");
    expect(blunt.elevation).toBe("0_deg_blunt");
    expect(blunt.distribution).toBe("natural_fall");
    expect(blunt.guideline).toBe("visual_perimeter");

    const shag = generateTechnicalCutPlan({
      goal: "reshape",
      hairType: "medium",
      density: "medium",
      porosity: "medium",
      targetShape: "shag_mullet",
    });
    expect(shag).not.toMatchObject(NEUTRAL_DEFAULTS);
    expect(shag.structuralTechnique).toBe("precision_layering");
    expect(shag.cuttingTechnique).toBe("elevation_cutting");
    expect(shag.texturizingTechnique).toBe("razor_texturizing");
    expect(shag.elevation).toBe("180_deg_overdirection");
    expect(shag.distribution).toBe("shifting_line");
    expect(shag.guideline).toBe("multiple_reference");
    expect(shag.sectioning).toBe("horseshoe_crown");

    const pixie = generateTechnicalCutPlan({
      goal: "reshape",
      hairType: "medium",
      density: "medium",
      porosity: "medium",
      targetShape: "pixie_crop",
    });
    expect(pixie).not.toMatchObject(NEUTRAL_DEFAULTS);
    expect(pixie.structuralTechnique).toBe("compact_graduation");
    expect(pixie.cuttingTechnique).toBe("scissor_over_comb");
    expect(pixie.texturizingTechnique).toBe("channel_cutting");
    expect(pixie.elevation).toBe("45_deg_graduation");
    expect(pixie.distribution).toBe("overdirected_back");
    expect(pixie.guideline).toBe("stationary");
    expect(pixie.sectioning).toBe("horseshoe_fringe");

    // Also distinct from one another, not just from the neutral defaults.
    expect(blunt.structuralTechnique).not.toBe(shag.structuralTechnique);
    expect(shag.cuttingTechnique).not.toBe(pixie.cuttingTechnique);
  });

  it("flags faceShape/headShape/hairLength/growthPattern as missing and falls back to professional assumptions -- but targetShape is always missing too, never invented, when nothing supplied it", () => {
    const plan = generateTechnicalCutPlan({
      goal: "reshape",
      hairType: "medium",
      density: "medium",
      porosity: "medium"
    });

    expect(plan.missingData).toEqual(
      expect.arrayContaining([
        "faceShape",
        "headShape",
        "hairLength",
        "hairTexture",
        "hairCondition",
        "growthPattern",
        "targetShape"
      ])
    );
    expect(plan.assumptions.some((assumption) => assumption.includes("neutral face balance"))).toBe(true);
    expect(plan.assumptions.some((assumption) => assumption.includes("balanced occipital"))).toBe(true);
    expect(plan.assumptions.some((assumption) => assumption.includes("regular growth pattern"))).toBe(true);
  });

  // Stage 2.5.e -- atomic execution steps. The final "Cross-check and
  // finish" step's own action text must never mix a real cutting/
  // texturizing action with the observation action, in EITHER branch (with
  // or without a texturizing technique selected).
  describe("Stage 2.5.e -- atomic final step (no mixed cutting + observation semantics)", () => {
    function lastStep(plan: ReturnType<typeof generateTechnicalCutPlan>) {
      return plan.cuttingSteps[plan.cuttingSteps.length - 1];
    }

    it("a plan WITH a texturizing technique: the final step never mentions the texturizing technique -- it already has its own dedicated Texture refinement step", () => {
      const plan = generateTechnicalCutPlan({
        goal: "reshape",
        hairType: "medium",
        density: "medium",
        porosity: "medium",
        targetShape: "blunt_perimeter_texturized", // selects slice_and_slide texturizing
      });

      expect(plan.texturizingTechnique).toBe("slice_and_slide");
      const final = lastStep(plan);
      expect(final.zone).toBe("Cross-check and finish");
      expect(final.action).not.toMatch(/slice and slide/i);
      expect(final.action).not.toMatch(/soften line weight/i);

      // The texturizing action is represented exactly once, in its own
      // dedicated step -- never duplicated into the final step too.
      const texturizingSteps = plan.cuttingSteps.filter((s) => s.action.toLowerCase().includes("slice and slide"));
      expect(texturizingSteps).toHaveLength(1);
      expect(texturizingSteps[0].zone).toBe("Texture refinement");
    });

    it("the final step is pure observation language, for a texturizing plan", () => {
      const plan = generateTechnicalCutPlan({
        goal: "reshape",
        hairType: "medium",
        density: "medium",
        porosity: "medium",
        targetShape: "shag_mullet", // selects razor_texturizing
      });
      const final = lastStep(plan);
      expect(final.action).toMatch(/cross-check/i);
      expect(final.action).not.toMatch(/razor/i);
      expect(final.action).not.toMatch(/\bcut\b/i);
    });

    it("a plan WITHOUT a texturizing technique also gets a pure-observation final step -- no cutting-adjacent language like 'refine perimeter' either", () => {
      const plan = generateTechnicalCutPlan({
        goal: "reshape",
        hairType: "medium",
        density: "medium",
        porosity: "medium",
      });
      expect(plan.texturizingTechnique).toBeUndefined();
      const final = lastStep(plan);
      expect(final.zone).toBe("Cross-check and finish");
      expect(final.action).not.toMatch(/refine/i);
      expect(final.action).toMatch(/cross-check/i);
    });

    it("the final step's own action text is byte-identical whether or not a texturizing technique was selected -- one universal observation sentence, not a branch", () => {
      const withTexturizing = lastStep(
        generateTechnicalCutPlan({ goal: "reshape", hairType: "medium", density: "medium", porosity: "medium", targetShape: "pixie_crop" }),
      );
      const withoutTexturizing = lastStep(
        generateTechnicalCutPlan({ goal: "reshape", hairType: "medium", density: "medium", porosity: "medium" }),
      );
      expect(withTexturizing.action).toBe(withoutTexturizing.action);
    });

    it("variable step count remains supported -- 4 steps without texturizing, 5 with it, and the final step is always last regardless of count", () => {
      const withoutTexturizing = generateTechnicalCutPlan({ goal: "reshape", hairType: "medium", density: "medium", porosity: "medium" });
      const withTexturizing = generateTechnicalCutPlan({
        goal: "reshape",
        hairType: "medium",
        density: "medium",
        porosity: "medium",
        targetShape: "blunt_perimeter_texturized",
      });
      expect(withoutTexturizing.cuttingSteps).toHaveLength(4);
      expect(withTexturizing.cuttingSteps).toHaveLength(5);
      expect(lastStep(withoutTexturizing).zone).toBe("Cross-check and finish");
      expect(lastStep(withTexturizing).zone).toBe("Cross-check and finish");
      // stepNumbers stay contiguous/sequential regardless of count.
      expect(withoutTexturizing.cuttingSteps.map((s) => s.stepNumber)).toEqual([1, 2, 3, 4]);
      expect(withTexturizing.cuttingSteps.map((s) => s.stepNumber)).toEqual([1, 2, 3, 4, 5]);
    });
  });

  // Stage 2.5.f.1 -- buildCuttingSteps extraction characterization tests.
  // Called DIRECTLY (no AnalysisEngineInput/profile involved at all), to
  // prove the extracted function is genuinely independently unit-testable,
  // and that its output is byte-identical to what the former inline logic
  // produced. Deep-equality fixtures, not just isolated field checks, per
  // this stage's own explicit requirement.
  describe("Stage 2.5.f.1 -- buildCuttingSteps extraction (deep-equality characterization)", () => {
    it("WITH a texturizing technique: exact 5-step fixture, deep-equal -- matches real production combo (One Length / Blunt Line / Slice And Slide / 0 Deg Blunt / Natural Fall / Visual Perimeter)", () => {
      const steps = buildCuttingSteps({
        structuralTechnique: "one_length",
        cuttingTechnique: "blunt_line",
        texturizingTechnique: "slice_and_slide",
        sectioning: "4_quadrant_profile_radial",
        elevation: "0_deg_blunt",
        distribution: "natural_fall",
        guideline: "visual_perimeter"
      });

      expect(steps).toEqual([
        {
          stepNumber: 1,
          zone: "Mapping and sectioning",
          action: "Partition using 4 quadrant profile radial with visual balance checkpoints.",
          elevationAngle: "0_deg_blunt",
          toolRequired: "tail-comb"
        },
        {
          stepNumber: 2,
          zone: "Baseline guideline",
          action: "Set a visual perimeter guideline and establish the structural shape with one length.",
          elevationAngle: "0_deg_blunt",
          toolRequired: "straight-shear"
        },
        {
          stepNumber: 3,
          zone: "Bulk and shape control",
          action: "Use blunt line for perimeter control and natural fall distribution for silhouette correction.",
          elevationAngle: "0_deg_blunt",
          toolRequired: "texturizer-shear"
        },
        {
          stepNumber: 4,
          zone: "Texture refinement",
          action: "Apply slice and slide only after the structural form is established.",
          elevationAngle: "0_deg_blunt",
          toolRequired: "texturizer-shear"
        },
        {
          stepNumber: 5,
          zone: "Cross-check and finish",
          action: "Cross-check symmetry, inspect perimeter balance and silhouette, and compare frontal and profile views to confirm natural fall.",
          elevationAngle: "0_deg_blunt",
          toolRequired: "finishing-comb"
        }
      ]);

      // Cross-check: the full integrated pipeline (generateTechnicalCutPlan,
      // which now calls this same function internally) produces the exact
      // SAME steps for the real profile that yields this identical
      // technique combination -- proving the extraction integrates
      // correctly, not just that the standalone function is internally
      // consistent.
      const plan = generateTechnicalCutPlan({
        goal: "reshape",
        hairType: "medium",
        density: "medium",
        porosity: "medium",
        targetShape: "blunt_perimeter_texturized"
      });
      expect(plan.cuttingSteps).toEqual(steps);
    });

    it("WITHOUT a texturizing technique: exact 4-step fixture, deep-equal", () => {
      const steps = buildCuttingSteps({
        structuralTechnique: "graduation",
        cuttingTechnique: "slice_cutting",
        texturizingTechnique: undefined,
        sectioning: "diagonal_back",
        elevation: "45_deg_graduation",
        distribution: "overdirected_back",
        guideline: "stationary"
      });

      expect(steps).toEqual([
        {
          stepNumber: 1,
          zone: "Mapping and sectioning",
          action: "Partition using diagonal back with visual balance checkpoints.",
          elevationAngle: "45_deg_graduation",
          toolRequired: "tail-comb"
        },
        {
          stepNumber: 2,
          zone: "Baseline guideline",
          action: "Set a stationary guideline and establish the structural shape with graduation.",
          elevationAngle: "45_deg_graduation",
          toolRequired: "straight-shear"
        },
        {
          stepNumber: 3,
          zone: "Bulk and shape control",
          action: "Use slice cutting for perimeter control and overdirected back distribution for silhouette correction.",
          elevationAngle: "45_deg_graduation",
          toolRequired: "straight-shear"
        },
        {
          stepNumber: 4,
          zone: "Cross-check and finish",
          action: "Cross-check symmetry, inspect perimeter balance and silhouette, and compare frontal and profile views to confirm natural fall.",
          elevationAngle: "45_deg_graduation",
          toolRequired: "finishing-comb"
        }
      ]);

      // Cross-check against the integrated pipeline for the equivalent
      // minimal profile (targetShape alone selects this exact combo, with
      // no other profile field present to trigger a further override).
      const plan = generateTechnicalCutPlan({
        goal: "reshape",
        hairType: "medium",
        density: "medium",
        porosity: "medium",
        targetShape: "graduated_bob"
      });
      expect(plan.cuttingSteps).toEqual(steps);
    });

    it("individual step identity: sectioning / guide / structural cutting / texturizing / final observation, each independently addressable", () => {
      const steps = buildCuttingSteps({
        structuralTechnique: "one_length",
        cuttingTechnique: "blunt_line",
        texturizingTechnique: "slice_and_slide",
        sectioning: "4_quadrant_profile_radial",
        elevation: "0_deg_blunt",
        distribution: "natural_fall",
        guideline: "visual_perimeter"
      });

      const [sectioningStep, guideStep, structuralStep, texturizingStep, finalStep] = steps;
      expect(sectioningStep.zone).toBe("Mapping and sectioning");
      expect(guideStep.zone).toBe("Baseline guideline");
      expect(structuralStep.zone).toBe("Bulk and shape control");
      expect(texturizingStep.zone).toBe("Texture refinement");
      expect(finalStep.zone).toBe("Cross-check and finish");
      expect(finalStep.action).toMatch(/cross-check/i);
      expect(finalStep.action).not.toMatch(/slice and slide|blunt line|cut\b/i);
    });

    it("step order/count is a plain contiguous 1..N sequence, with and without texturizing", () => {
      const withTexturizing = buildCuttingSteps({
        structuralTechnique: "one_length",
        cuttingTechnique: "blunt_line",
        texturizingTechnique: "slice_and_slide",
        sectioning: "4_quadrant_profile_radial",
        elevation: "0_deg_blunt",
        distribution: "natural_fall",
        guideline: "visual_perimeter"
      });
      const withoutTexturizing = buildCuttingSteps({
        structuralTechnique: "graduation",
        cuttingTechnique: "slice_cutting",
        texturizingTechnique: undefined,
        sectioning: "diagonal_back",
        elevation: "45_deg_graduation",
        distribution: "overdirected_back",
        guideline: "stationary"
      });

      expect(withTexturizing.map((s) => s.stepNumber)).toEqual([1, 2, 3, 4, 5]);
      expect(withoutTexturizing.map((s) => s.stepNumber)).toEqual([1, 2, 3, 4]);
    });

    it("is a pure function -- calling it twice with the same input produces deep-equal (though distinct array instance) output", () => {
      const input = {
        structuralTechnique: "precision_layering" as const,
        cuttingTechnique: "elevation_cutting" as const,
        texturizingTechnique: "razor_texturizing" as const,
        sectioning: "horseshoe_crown" as const,
        elevation: "180_deg_overdirection" as const,
        distribution: "shifting_line" as const,
        guideline: "multiple_reference" as const
      };
      const first = buildCuttingSteps(input);
      const second = buildCuttingSteps(input);
      expect(first).toEqual(second);
      expect(first).not.toBe(second);
    });
  });
});
