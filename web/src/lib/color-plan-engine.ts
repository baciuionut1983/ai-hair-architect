import type {
  AnalysisGoal,
  ColorApplicationTechnique,
  ColorDeveloperVolume,
  ColorFormulaDirection,
  ColorPlan,
  ColorStep,
  ColorToneDirection,
  DensityLevel,
  DesiredColorResult,
  GrayPercentage,
  HairCondition,
  HairType,
  PorosityLevel
} from "./contracts";
import { calculateRecommendationConfidence, dedupe, readable } from "./recommendation-engine-shared";

const COLOR_PLAN_VERSION = "1.0.0-m27";
const STYLIST_VALIDATION_DISCLAIMER =
  "Professional warning: this is a technical color direction, not an exact salon formula -- final proportions, exact developer mix, and timing must be validated by a licensed colorist at chair-side, including a strand test where indicated.";

/**
 * M27 GO-2: self-contained, not yet part of AnalysisEngineInput -- this
 * engine is deliberately isolated and unconnected to analyzeInitial until
 * GO-3. hairType/density are accepted for future parity with
 * AnalysisEngineInput but are not yet consumed by any rule below.
 */
export interface ColorEngineInput {
  goal: AnalysisGoal;
  hairType: HairType;
  density: DensityLevel;
  porosity: PorosityLevel;
  hairCondition?: HairCondition;
  desiredColorResult?: DesiredColorResult;
  grayPercentage?: GrayPercentage;
}

interface ColorProfile {
  hairCondition?: HairCondition;
  porosity: PorosityLevel;
  desiredColorResult?: DesiredColorResult;
  grayPercentage?: GrayPercentage;
}

export function shouldGenerateColorPlan(input: ColorEngineInput): boolean {
  return (
    input.goal === "cover" ||
    input.goal === "lighten" ||
    Boolean(input.desiredColorResult || input.grayPercentage)
  );
}

export function generateColorPlan(input: ColorEngineInput): ColorPlan {
  const profile: ColorProfile = {
    hairCondition: input.hairCondition,
    porosity: input.porosity,
    desiredColorResult: input.desiredColorResult,
    grayPercentage: input.grayPercentage
  };

  const missingData = collectMissingData(profile);
  const assumptions = buildAssumptions(profile);

  const warnings: string[] = [];
  const contraindications: string[] = [];
  const notes: string[] = [];
  const professionalReasonParts: string[] = [];

  // Start from the safest possible baseline; branches below only move away
  // from it when a specific desired result justifies it.
  let formulaDirection: ColorFormulaDirection = "gloss_demi_permanent";
  let developerVolume: ColorDeveloperVolume = "10vol";
  let liftLevels = 0;
  let toneDirection: ColorToneDirection = "neutral";
  let applicationTechnique: ColorApplicationTechnique = "global_application";

  if (profile.desiredColorResult === "gray_coverage") {
    formulaDirection = "single_process_gray_coverage";
    developerVolume = "20vol";
    applicationTechnique = "global_application";
    toneDirection = profile.grayPercentage === "high" ? "warm_gold" : "neutral";
    professionalReasonParts.push("Single-process global application provides uniform gray coverage.");
    if (profile.grayPercentage === "high") {
      notes.push("High gray percentage resists warmth -- compensate with a warmer base direction.");
    }
  }

  if (profile.desiredColorResult === "gloss_refresh") {
    formulaDirection = "gloss_demi_permanent";
    developerVolume = "10vol";
    applicationTechnique = "global_application";
    professionalReasonParts.push("Demi-permanent gloss refreshes tone without structural lift.");
  }

  if (profile.desiredColorResult === "root_shadow") {
    formulaDirection = "root_shadow_melt";
    developerVolume = "20vol";
    applicationTechnique = "color_melt";
    professionalReasonParts.push("Root shadow melt softens regrowth demarcation.");
  }

  if (profile.desiredColorResult === "balayage_highlights") {
    formulaDirection = "balayage_freehand";
    developerVolume = "30vol";
    applicationTechnique = "balayage_freehand";
    liftLevels = 2;
    professionalReasonParts.push("Freehand balayage lifts selectively while preserving a soft grow-out.");
  }

  if (profile.desiredColorResult === "full_lightening") {
    formulaDirection = "double_process_lightening";
    developerVolume = "30vol";
    applicationTechnique = "foils";
    liftLevels = 3;
    warnings.push("Full lightening requires sectioned, monitored processing with regular strand checks.");
    if (profile.hairCondition === "virgin_healthy" && profile.porosity !== "high") {
      developerVolume = "40vol";
      professionalReasonParts.push(
        "Virgin, healthy hair with typical porosity supports maximum lift in a controlled session."
      );
    } else {
      professionalReasonParts.push("Double-process lightening staged conservatively given the current hair profile.");
    }
  }

  if (profile.desiredColorResult === "color_correction") {
    formulaDirection = "color_correction_neutralize";
    developerVolume = "10vol";
    applicationTechnique = "global_application";
    professionalReasonParts.push("Neutralizing correction addresses unwanted tone before any further lift is attempted.");
    warnings.push("Color correction outcome depends heavily on prior color history; in-person strand analysis is mandatory.");
  }

  // Mandatory safety clamp -- applied last, unconditionally, regardless of
  // which branch above set formulaDirection/developerVolume/liftLevels. This
  // is the single place the "no 40vol on fragile, damaged, or chemically
  // treated hair" rule is enforced, so a future branch can never bypass it
  // by forgetting to check it. Can only ever lower risk, never raise it.
  const isCompromised = profile.hairCondition === "fragile_breakage" || profile.hairCondition === "high_porosity_damaged";
  const isChemicallyTreated = profile.hairCondition === "chemically_treated";
  const hairConditionUnknown = !profile.hairCondition;

  if (isCompromised) {
    if (developerVolume === "40vol" || developerVolume === "30vol") {
      developerVolume = "20vol";
    }
    liftLevels = Math.min(liftLevels, 1);
    contraindications.push("Do not perform double-process lightening on compromised hair in this session.");
    warnings.push(
      "Hair condition indicates fragility or damage -- a Treatment plan is recommended before any chemical lightening service."
    );
    notes.push("Reassess with a fresh strand test once hair condition improves.");
  } else if (isChemicallyTreated) {
    if (developerVolume === "40vol") {
      developerVolume = "30vol";
    }
    warnings.push("Previous chemical treatment detected -- verify compatibility before combining services.");
  } else if (hairConditionUnknown) {
    if (developerVolume === "40vol" || developerVolume === "30vol") {
      developerVolume = "20vol";
    }
    warnings.push("Hair condition unknown -- a conservative developer strength was assumed; confirm chemical history before service.");
  }

  if (profile.porosity === "high") {
    warnings.push("High porosity absorbs color faster and unevenly -- reduce processing time and monitor closely.");
    if (developerVolume === "40vol") {
      developerVolume = "30vol";
    }
  }

  const professionalReason =
    professionalReasonParts.length > 0
      ? professionalReasonParts.join(" ")
      : "Conservative color direction selected from limited profile data.";

  const strandTestRequired =
    isCompromised ||
    isChemicallyTreated ||
    hairConditionUnknown ||
    profile.porosity === "high" ||
    developerVolume === "30vol" ||
    developerVolume === "40vol" ||
    profile.desiredColorResult === "full_lightening" ||
    profile.desiredColorResult === "balayage_highlights" ||
    profile.desiredColorResult === "color_correction";

  const confidence = calculateRecommendationConfidence(missingData, warnings, contraindications);

  const processingSteps: ColorStep[] = [
    {
      stepNumber: 1,
      zone: "Consultation and strand test",
      action: strandTestRequired
        ? `Perform a strand test to confirm ${readable(developerVolume)} developer compatibility before full application.`
        : "Confirm hair history verbally and visually before proceeding.",
      toolRequired: "strand-test-kit"
    },
    {
      stepNumber: 2,
      zone: "Application",
      action: `Apply using ${readable(applicationTechnique)} with ${readable(formulaDirection)} direction.`,
      toolRequired: "tint-brush"
    },
    {
      stepNumber: 3,
      zone: "Processing and monitoring",
      action: `Process with ${readable(developerVolume)} developer, checking color development at regular intervals.`,
      toolRequired: "timer"
    },
    {
      stepNumber: 4,
      zone: "Tone and finish",
      action: `Finish toward a ${readable(toneDirection)} result, then rinse and apply a post-color bond sealant.`,
      toolRequired: "finishing-comb"
    }
  ];

  const maintenancePlan = [
    "Recommend a toning or gloss refresh every 4-6 weeks to maintain tone.",
    "Suggest a bond-building or hydrating treatment between color services."
  ];

  const stylistExplanation =
    `Formula direction: ${readable(formulaDirection)}. Developer: ${readable(developerVolume)}.` +
    ` Application: ${readable(applicationTechnique)}, tone direction: ${readable(toneDirection)}.` +
    ` Reason: ${professionalReason}`;

  const clientExplanation =
    "This color plan is an orientative technical direction personalized to your hair's condition and your desired result, to be confirmed by your colorist.";

  return {
    formulaDirection,
    developerVolume,
    liftLevels,
    toneDirection,
    applicationTechnique,
    processingSteps,
    maintenancePlan,
    strandTestRequired,
    stylistExplanation,
    clientExplanation,
    professionalReason,
    warnings: dedupe(warnings),
    contraindications: dedupe(contraindications),
    assumptions,
    missingData,
    confidence,
    notes: dedupe(notes),
    stylistValidationDisclaimer: STYLIST_VALIDATION_DISCLAIMER,
    version: COLOR_PLAN_VERSION
  };
}

function collectMissingData(profile: ColorProfile): string[] {
  const missing: string[] = [];
  if (!profile.hairCondition) {
    missing.push("hairCondition");
  }
  if (!profile.desiredColorResult) {
    missing.push("desiredColorResult");
  }
  if (!profile.grayPercentage) {
    missing.push("grayPercentage");
  }
  return missing;
}

function buildAssumptions(profile: ColorProfile): string[] {
  const assumptions: string[] = [];
  if (!profile.hairCondition) {
    assumptions.push("Assumed unknown/unverified chemical history -- treated conservatively.");
  }
  if (!profile.desiredColorResult) {
    assumptions.push("Assumed a general gloss/refresh direction in the absence of a specific desired result.");
  }
  return assumptions;
}
