import { describe, expect, it } from "vitest";

import { generateTechnicalCutPlan, shouldGenerateTechnicalCutPlan } from "./cutting-plan-engine";

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
    expect(plan.version).toBe("1.0.0-m8");
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
});
