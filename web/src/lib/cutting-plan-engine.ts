import type {
  FaceShape,
  GrowthPattern,
  HairCondition,
  HairDensity,
  HairLength,
  HairTexture,
  HeadShape,
  TargetShape,
  TechnicalCutDistribution,
  TechnicalCutElevation,
  TechnicalCutGuideline,
  TechnicalCutPlan,
  TechnicalCutSectioning,
  CuttingTechnique,
  StructuralTechnique,
  TexturizingTechnique
} from "./contracts";
import type { AnalysisEngineInput } from "./milestone2-types";
import { calculateRecommendationConfidence, dedupe, readable } from "./recommendation-engine-shared";

const TECHNICAL_PLAN_VERSION = "1.0.0-m8";
const STYLIST_VALIDATION_DISCLAIMER =
  "Professional warning: this technical recommendation assists planning but must be validated by a licensed hairstylist at chair-side before the first cut.";

interface TechnicalProfile {
  faceShape?: FaceShape;
  headShape?: HeadShape;
  hairLength?: HairLength;
  hairTexture?: HairTexture;
  hairDensity?: HairDensity;
  hairCondition?: HairCondition;
  growthPattern?: GrowthPattern;
  targetShape?: TargetShape;
}

interface TechniqueSelection {
  structuralTechnique: StructuralTechnique;
  cuttingTechnique: CuttingTechnique;
  texturizingTechnique?: TexturizingTechnique;
}

export function shouldGenerateTechnicalCutPlan(input: AnalysisEngineInput): boolean {
  return (
    input.goal === "reshape" ||
    Boolean(
      input.faceShape ||
      input.headShape ||
      input.hairLength ||
      input.hairTexture ||
      input.hairCondition ||
      input.growthPattern ||
      input.targetShape
    )
  );
}

export function generateTechnicalCutPlan(input: AnalysisEngineInput): TechnicalCutPlan {
  const profile: TechnicalProfile = {
    faceShape: input.faceShape,
    headShape: input.headShape,
    hairLength: input.hairLength,
    hairTexture: input.hairTexture,
    hairDensity: input.density,
    hairCondition: input.hairCondition,
    growthPattern: input.growthPattern,
    targetShape: input.targetShape
  };

  const missingData = collectMissingData(profile);
  const assumptions = buildAssumptions(profile);
  const selection = selectTechnique(profile);

  let sectioning: TechnicalCutSectioning = "4_quadrant_profile_radial";
  let elevation: TechnicalCutElevation = "90_deg_uniform_layer";
  let distribution: TechnicalCutDistribution = "perpendicular";
  let guideline: TechnicalCutGuideline = "traveling";

  const warnings: string[] = [];
  const contraindications: string[] = [];
  const notes: string[] = [];
  const professionalReasonParts: string[] = [];

  if (profile.targetShape === "precision_bob") {
    selection.structuralTechnique = "one_length";
    selection.cuttingTechnique = "blunt_line";
    elevation = "0_deg_blunt";
    distribution = "natural_fall";
    guideline = "visual_perimeter";
    professionalReasonParts.push("One-length structure preserves compact geometry and visual weight.");
    notes.push("Use blunt perimeter to keep the silhouette visually dense.");
  }

  if (profile.targetShape === "graduated_bob") {
    selection.structuralTechnique = "graduation";
    selection.cuttingTechnique = "slice_cutting";
    elevation = "45_deg_graduation";
    distribution = "overdirected_back";
    guideline = "stationary";
    sectioning = "diagonal_back";
    professionalReasonParts.push("Graduation creates internal support and controlled nape build-up.");
    notes.push("Graduation builds weight in the lower back while keeping the line controlled.");
  }

  if (profile.targetShape === "long_layers" || profile.targetShape === "face_framing_cascade") {
    selection.structuralTechnique = "precision_layering";
    selection.cuttingTechnique = "slice_cutting";
    elevation = "135_deg_long_layer";
    distribution = "overdirected_forward";
    guideline = "traveling";
    sectioning = "pivot_radial";
    professionalReasonParts.push("Long layering reduces perimeter heaviness while preserving movement.");
    notes.push("Layered perimeter keeps the silhouette mobile without collapsing length.");
  }

  if (profile.faceShape === "round" || profile.faceShape === "square") {
    elevation = "135_deg_long_layer";
    distribution = "overdirected_forward";
    warnings.push("Avoid heavy horizontal perimeter lines around jaw level.");
    professionalReasonParts.push("Vertical layering elongates the silhouette and softens lateral width.");
  }

  if (profile.faceShape === "oblong") {
    elevation = "90_deg_uniform_layer";
    distribution = "natural_fall";
    professionalReasonParts.push("Uniform layering avoids excessive vertical elongation for oblong profiles.");
  }

  if (profile.headShape === "flat_occipital") {
    selection.structuralTechnique = "compact_graduation";
    selection.cuttingTechnique = "scissor_over_comb";
    sectioning = "diagonal_back";
    elevation = "45_deg_graduation";
    guideline = "stationary";
    professionalReasonParts.push("Nape graduation compensates flat occipital projection.");
    notes.push("Scissor-over-comb refines density without removing too much support at the nape.");
  }

  if (profile.headShape === "prominent_crown") {
    sectioning = "horseshoe_crown";
    distribution = "shifting_line";
    warnings.push("Control crown tension to avoid spring-back and short collapse.");
    professionalReasonParts.push("Crown isolation reduces imbalance on high-parietal apex areas.");
  }

  if (profile.hairTexture === "curly" || profile.hairTexture === "coily") {
    selection.texturizingTechnique = "point_cutting";
    guideline = "multiple_reference";
    warnings.push("Cut curls in controlled low-tension subsections to limit shrinkage shocks.");
    contraindications.push("Do not execute aggressive thinning on high-frizz curl patterns.");
    professionalReasonParts.push("Point-cut architecture respects curl spring and avoids blocky bulk lines.");
    notes.push("Use point cutting only as a finishing texture step, not as the main structural builder.");
  }

  if (profile.hairDensity === "high") {
    sectioning = "horseshoe_crown";
    if (selection.structuralTechnique === "one_length") {
      selection.cuttingTechnique = "scissor_over_comb";
    }
    professionalReasonParts.push("Density management through horseshoe partition balances mass distribution.");
  }

  if (profile.hairDensity === "low") {
    contraindications.push("Avoid deep interior texturizing that can collapse perimeter fullness.");
    professionalReasonParts.push("Perimeter preservation protects visual fullness on low-density hair.");
  }

  if (profile.hairCondition === "fragile_breakage" || profile.hairCondition === "high_porosity_damaged") {
    warnings.push("Use low-manipulation sectioning and reduce over-direction tension.");
    contraindications.push("Avoid razor-based carving on fragile or highly damaged hair fiber.");
  }

  if (profile.growthPattern === "double_crown" || profile.growthPattern === "front_cowlick") {
    warnings.push("Establish natural-fall cross-check before final perimeter refinement.");
    professionalReasonParts.push("Growth mapping before refinement reduces rebound asymmetry.");
  }

  if (input.goal !== "reshape") {
    warnings.push("Primary objective is not reshape; validate that cutting plan aligns with service intent.");
  }

  const professionalReason =
    professionalReasonParts.length > 0
      ? professionalReasonParts.join(" ")
      : "Balanced technical architecture selected from neutral face/head assumptions.";

  const confidence = calculateRecommendationConfidence(missingData, warnings, contraindications);

  const cuttingSteps = [
    {
      stepNumber: 1,
      zone: "Mapping and sectioning",
      action: `Partition using ${readable(sectioning)} with visual balance checkpoints.`,
      elevationAngle: elevation,
      toolRequired: "tail-comb"
    },
    {
      stepNumber: 2,
      zone: "Baseline guideline",
      action: `Set a ${readable(guideline)} guideline and establish the structural shape with ${readable(selection.structuralTechnique)}.`,
      elevationAngle: elevation,
      toolRequired: "straight-shear"
    },
    {
      stepNumber: 3,
      zone: "Bulk and shape control",
      action: `Use ${readable(selection.cuttingTechnique)} for perimeter control and ${readable(distribution)} distribution for silhouette correction.`,
      elevationAngle: elevation,
      toolRequired: selection.texturizingTechnique ? "texturizer-shear" : "straight-shear"
    },
    {
      stepNumber: 4,
      zone: "Cross-check and finish",
      action: selection.texturizingTechnique
        ? `Finish with ${readable(selection.texturizingTechnique)} to soften line weight, then cross-check symmetry at profile and frontal view.`
        : "Cross-check dry and wet, refine perimeter, then validate symmetry at profile and frontal view.",
      elevationAngle: elevation,
      toolRequired: "finishing-comb"
    }
  ];

  if (selection.texturizingTechnique) {
    cuttingSteps.splice(3, 0, {
      stepNumber: 4,
      zone: "Texture refinement",
      action: `Apply ${readable(selection.texturizingTechnique)} only after the structural form is established.`,
      elevationAngle: elevation,
      toolRequired: "texturizer-shear"
    });
    cuttingSteps.forEach((step, index) => {
      step.stepNumber = index + 1;
    });
  }

  const stylistExplanation =
    `Structural technique: ${readable(selection.structuralTechnique)}. Cutting technique: ${readable(selection.cuttingTechnique)}.` +
    (selection.texturizingTechnique ? ` Texturizing technique: ${readable(selection.texturizingTechnique)}.` : "") +
    ` Sectioning: ${readable(sectioning)}, ${readable(elevation)} elevation, ` +
    `${readable(distribution)} distribution, ${readable(guideline)} guideline. ` +
    `Reason: ${professionalReason}`;

  const clientExplanation =
    "This haircut plan is personalized to your face/head profile and hair behavior to improve balance, movement, and easier home styling.";

  return {
    structuralTechnique: selection.structuralTechnique,
    cuttingTechnique: selection.cuttingTechnique,
    texturizingTechnique: selection.texturizingTechnique,
    sectioning,
    elevation,
    distribution,
    guideline,
    cuttingSteps,
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
    version: TECHNICAL_PLAN_VERSION
  };
}

function selectTechnique(profile: TechnicalProfile): TechniqueSelection {
  if (profile.targetShape === "precision_bob") {
    return { structuralTechnique: "one_length", cuttingTechnique: "blunt_line" };
  }

  if (profile.targetShape === "graduated_bob") {
    return { structuralTechnique: "graduation", cuttingTechnique: "slice_cutting" };
  }

  if (profile.targetShape === "long_layers" || profile.targetShape === "face_framing_cascade") {
    return { structuralTechnique: "precision_layering", cuttingTechnique: "slice_cutting" };
  }

  return { structuralTechnique: "internal_layering", cuttingTechnique: "scissor_over_comb" };
}

function collectMissingData(profile: TechnicalProfile): string[] {
  const missing: string[] = [];
  if (!profile.faceShape) {
    missing.push("faceShape");
  }
  if (!profile.headShape) {
    missing.push("headShape");
  }
  if (!profile.hairLength) {
    missing.push("hairLength");
  }
  if (!profile.hairTexture) {
    missing.push("hairTexture");
  }
  if (!profile.hairCondition) {
    missing.push("hairCondition");
  }
  if (!profile.growthPattern) {
    missing.push("growthPattern");
  }
  if (!profile.targetShape) {
    missing.push("targetShape");
  }
  return missing;
}

function buildAssumptions(profile: TechnicalProfile): string[] {
  const assumptions: string[] = [];
  if (!profile.faceShape) {
    assumptions.push("Assumed neutral face balance similar to oval projection.");
  }
  if (!profile.headShape) {
    assumptions.push("Assumed balanced occipital projection with no cranial flattening.");
  }
  if (!profile.growthPattern) {
    assumptions.push("Assumed regular growth pattern without dominant cowlick displacement.");
  }
  if (!profile.targetShape) {
    assumptions.push("Assumed layered commercial shape suitable for maintenance cycles.");
  }
  return assumptions;
}

// calculateConfidence/readable/dedupe moved to recommendation-engine-shared.ts
// (M27) -- imported above as calculateRecommendationConfidence/readable/dedupe.
// Identical formula/behavior, extracted verbatim, zero logic change.
