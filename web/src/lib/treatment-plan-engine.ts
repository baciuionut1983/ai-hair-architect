import type {
  AnalysisGoal,
  DensityLevel,
  HairCondition,
  HairType,
  PorosityLevel,
  ScalpCondition,
  TreatmentCategory,
  TreatmentFrequency,
  TreatmentGoalDetail,
  TreatmentPlan,
  TreatmentStep
} from "./contracts";
import { calculateRecommendationConfidence, dedupe, readable } from "./recommendation-engine-shared";

const TREATMENT_PLAN_VERSION = "1.0.0-m27";
const STYLIST_VALIDATION_DISCLAIMER =
  "Professional warning: this is a technical treatment direction, not a guaranteed outcome -- protocol, product selection, and frequency must be validated by a licensed professional at chair-side.";

/**
 * M27 GO-3: self-contained input, mirroring ColorEngineInput. hairType/density
 * accepted for parity with AnalysisEngineInput but not yet consumed by any
 * rule below.
 */
export interface TreatmentEngineInput {
  goal: AnalysisGoal;
  hairType: HairType;
  density: DensityLevel;
  porosity: PorosityLevel;
  hairCondition?: HairCondition;
  scalpCondition?: ScalpCondition;
  treatmentGoalDetail?: TreatmentGoalDetail;
}

interface TreatmentProfile {
  hairCondition?: HairCondition;
  porosity: PorosityLevel;
  scalpCondition?: ScalpCondition;
  treatmentGoalDetail?: TreatmentGoalDetail;
}

export function shouldGenerateTreatmentPlan(input: TreatmentEngineInput): boolean {
  return input.goal === "treat" || Boolean(input.treatmentGoalDetail || input.scalpCondition);
}

export function generateTreatmentPlan(input: TreatmentEngineInput): TreatmentPlan {
  const profile: TreatmentProfile = {
    hairCondition: input.hairCondition,
    porosity: input.porosity,
    scalpCondition: input.scalpCondition,
    treatmentGoalDetail: input.treatmentGoalDetail
  };

  const missingData = collectMissingData(profile);
  const assumptions = buildAssumptions(profile);

  const warnings: string[] = [];
  const contraindications: string[] = [];
  const notes: string[] = [];
  const professionalReasonParts: string[] = [];

  // Safest possible baseline; branches below only move away from it when a
  // specific goal detail justifies it.
  let treatmentCategory: TreatmentCategory = "deep_hydration";
  let recommendedFrequency: TreatmentFrequency = "monthly_maintenance";
  let followUpReviewWeeks = 6;

  if (profile.treatmentGoalDetail === "hydration") {
    treatmentCategory = "deep_hydration";
    recommendedFrequency = "weekly_for_4_weeks";
    followUpReviewWeeks = 4;
    professionalReasonParts.push("Deep hydration protocol addresses moisture deficit in the hair fiber.");
  }

  if (profile.treatmentGoalDetail === "repair") {
    treatmentCategory = "bond_repair";
    recommendedFrequency = "biweekly_for_6_weeks";
    followUpReviewWeeks = 6;
    professionalReasonParts.push("Bond-building repair addresses structural weakness before further chemical work.");
  }

  if (profile.treatmentGoalDetail === "detox_scalp") {
    treatmentCategory = "scalp_therapy";
    recommendedFrequency = "weekly_for_4_weeks";
    followUpReviewWeeks = 4;
    professionalReasonParts.push("Scalp therapy clears buildup and supports a healthier growth environment.");
  }

  if (profile.treatmentGoalDetail === "bonding_repair") {
    treatmentCategory = "bond_repair";
    recommendedFrequency = "biweekly_for_6_weeks";
    followUpReviewWeeks = 6;
    professionalReasonParts.push("Bond-repair protocol rebuilds internal structure after chemical or mechanical stress.");
  }

  if (profile.treatmentGoalDetail === "post_color_recovery") {
    treatmentCategory = "post_color_recovery";
    recommendedFrequency = "weekly_for_4_weeks";
    followUpReviewWeeks = 4;
    professionalReasonParts.push("Post-color recovery protocol stabilizes the fiber after a recent chemical service.");
    notes.push("Recommended starting 3-7 days after the chemical service, to avoid interfering with color deposit.");
  }

  // Hair-condition-driven overrides -- can escalate the category toward a
  // more targeted repair protocol, but never toward a more aggressive one
  // than the profile justifies.
  const isCompromised = profile.hairCondition === "fragile_breakage" || profile.hairCondition === "high_porosity_damaged";

  if (profile.hairCondition === "fragile_breakage") {
    treatmentCategory = "protein_reconstruction";
    recommendedFrequency = "weekly_for_4_weeks";
    followUpReviewWeeks = 4;
    contraindications.push("Avoid heat styling for the duration of the reconstruction protocol.");
    warnings.push("Fragile hair requires low-manipulation handling throughout the protocol.");
    professionalReasonParts.push("Protein reconstruction targets fiber breakage directly.");
  } else if (profile.hairCondition === "high_porosity_damaged" && profile.porosity === "high") {
    treatmentCategory = "deep_hydration";
    recommendedFrequency = "weekly_for_4_weeks";
    followUpReviewWeeks = 4;
    notes.push("Combine with a bond-building follow-up once moisture balance is restored.");
    professionalReasonParts.push("High porosity with visible damage responds best to moisture-first sequencing.");
  }

  if (profile.scalpCondition === "sensitive" || profile.scalpCondition === "flaking") {
    contraindications.push("Avoid high-fragrance or high-sulfate products on a sensitive or flaking scalp.");
    warnings.push("Patch test any new scalp-focused product before full application.");
  }

  const professionalReason =
    professionalReasonParts.length > 0
      ? professionalReasonParts.join(" ")
      : "Conservative hydration protocol selected from limited profile data.";

  const confidence = calculateRecommendationConfidence(missingData, warnings, contraindications);

  const protocolSteps: TreatmentStep[] = [
    {
      stepNumber: 1,
      zone: "Consultation",
      action: "Assess hair and scalp condition, and confirm recent chemical service history.",
      toolRequired: "consultation-form"
    },
    {
      stepNumber: 2,
      zone: "Application",
      action: `Apply a ${readable(treatmentCategory)} treatment following the manufacturer's contact time.`,
      toolRequired: "applicator-brush"
    },
    {
      stepNumber: 3,
      zone: "Processing",
      action: isCompromised
        ? "Process under low heat or ambient conditions to avoid further stressing the fiber."
        : "Process under standard heat as indicated by the product.",
      toolRequired: "processing-cap"
    },
    {
      stepNumber: 4,
      zone: "Rinse and finish",
      action: "Rinse thoroughly and seal with a pH-balancing finisher.",
      toolRequired: "finishing-comb"
    }
  ];

  const aftercareSteps = [
    `Repeat every cycle per the ${readable(recommendedFrequency)} schedule.`,
    "Avoid additional chemical services until the follow-up review."
  ];

  const stylistExplanation =
    `Treatment category: ${readable(treatmentCategory)}. Frequency: ${readable(recommendedFrequency)}.` +
    ` Follow-up review in ${followUpReviewWeeks} weeks. Reason: ${professionalReason}`;

  const clientExplanation =
    "This treatment plan is an orientative technical direction personalized to your hair and scalp condition, to be confirmed by your stylist.";

  return {
    treatmentCategory,
    protocolSteps,
    aftercareSteps,
    recommendedFrequency,
    followUpReviewWeeks,
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
    version: TREATMENT_PLAN_VERSION
  };
}

function collectMissingData(profile: TreatmentProfile): string[] {
  const missing: string[] = [];
  if (!profile.hairCondition) {
    missing.push("hairCondition");
  }
  if (!profile.scalpCondition) {
    missing.push("scalpCondition");
  }
  if (!profile.treatmentGoalDetail) {
    missing.push("treatmentGoalDetail");
  }
  return missing;
}

function buildAssumptions(profile: TreatmentProfile): string[] {
  const assumptions: string[] = [];
  if (!profile.hairCondition) {
    assumptions.push("Assumed unknown hair condition -- treated conservatively with a hydration-first approach.");
  }
  if (!profile.scalpCondition) {
    assumptions.push("Assumed a normal scalp condition in the absence of a specific assessment.");
  }
  if (!profile.treatmentGoalDetail) {
    assumptions.push("Assumed a general hydration goal in the absence of a specific treatment detail.");
  }
  return assumptions;
}
