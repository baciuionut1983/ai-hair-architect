import type {
  AnalysisGoal,
  DensityLevel,
  DesiredColorResult,
  FaceShape,
  GrayPercentage,
  GrowthPattern,
  HairCondition,
  HairLength,
  HairTexture,
  HairType,
  HeadShape,
  PorosityLevel,
  ScalpCondition,
  TargetShape,
  TreatmentGoalDetail
} from "@/lib/contracts";

// M31 GO-2: shared, hand-labeled option lists for every AnalysisRequest
// input field. Built once here so the manual wizard (GO-3) and the
// photo-review wizard (GO-4) render identical, human-readable choices
// instead of each hardcoding its own copy of these enums -- exactly the
// duplication the M31 GO-1 blueprint was told to avoid. Values match
// src/app/api/v1/analysis/start/route.ts's validation lists exactly.
export interface FieldOption<T extends string> {
  value: T;
  label: string;
}

export const GOAL_OPTIONS: FieldOption<AnalysisGoal>[] = [
  { value: "refresh", label: "Refresh / touch-up" },
  { value: "cover", label: "Cover gray" },
  { value: "lighten", label: "Lighten" },
  { value: "correct", label: "Correct" },
  { value: "reshape", label: "Reshape / haircut" },
  { value: "treat", label: "Treatment" }
];

export const HAIR_TYPE_OPTIONS: FieldOption<HairType>[] = [
  { value: "fine", label: "Fine" },
  { value: "medium", label: "Medium" },
  { value: "coarse", label: "Coarse" }
];

export const DENSITY_OPTIONS: FieldOption<DensityLevel>[] = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" }
];

export const POROSITY_OPTIONS: FieldOption<PorosityLevel>[] = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" }
];

export const FACE_SHAPE_OPTIONS: FieldOption<FaceShape>[] = [
  { value: "oval", label: "Oval" },
  { value: "round", label: "Round" },
  { value: "square", label: "Square" },
  { value: "heart", label: "Heart" },
  { value: "diamond", label: "Diamond" },
  { value: "oblong", label: "Oblong" }
];

export const HEAD_SHAPE_OPTIONS: FieldOption<HeadShape>[] = [
  { value: "balanced", label: "Balanced" },
  { value: "flat_occipital", label: "Flat occipital" },
  { value: "prominent_crown", label: "Prominent crown" },
  { value: "wide_parietal", label: "Wide parietal" },
  { value: "irregular_occipital", label: "Irregular occipital" }
];

export const HAIR_LENGTH_OPTIONS: FieldOption<HairLength>[] = [
  { value: "pixie", label: "Pixie" },
  { value: "short", label: "Short" },
  { value: "medium", label: "Medium" },
  { value: "long", label: "Long" },
  { value: "extra_long", label: "Extra long" }
];

export const HAIR_TEXTURE_OPTIONS: FieldOption<HairTexture>[] = [
  { value: "straight", label: "Straight" },
  { value: "wavy", label: "Wavy" },
  { value: "curly", label: "Curly" },
  { value: "coily", label: "Coily" }
];

export const HAIR_CONDITION_OPTIONS: FieldOption<HairCondition>[] = [
  { value: "virgin_healthy", label: "Virgin / healthy" },
  { value: "chemically_treated", label: "Chemically treated" },
  { value: "high_porosity_damaged", label: "High porosity / damaged" },
  { value: "fragile_breakage", label: "Fragile / breakage-prone" }
];

export const GROWTH_PATTERN_OPTIONS: FieldOption<GrowthPattern>[] = [
  { value: "regular", label: "Regular" },
  { value: "double_crown", label: "Double crown" },
  { value: "front_cowlick", label: "Front cowlick" },
  { value: "nape_whorl", label: "Nape whorl" },
  { value: "strong_widow_peak", label: "Strong widow's peak" }
];

export const TARGET_SHAPE_OPTIONS: FieldOption<TargetShape>[] = [
  { value: "precision_bob", label: "Precision bob" },
  { value: "graduated_bob", label: "Graduated bob" },
  { value: "long_layers", label: "Long layers" },
  { value: "shag_mullet", label: "Shag / mullet" },
  { value: "pixie_crop", label: "Pixie crop" },
  { value: "face_framing_cascade", label: "Face-framing cascade" },
  { value: "blunt_perimeter_texturized", label: "Blunt perimeter, texturized" }
];

export const DESIRED_COLOR_RESULT_OPTIONS: FieldOption<DesiredColorResult>[] = [
  { value: "gray_coverage", label: "Gray coverage" },
  { value: "gloss_refresh", label: "Gloss refresh" },
  { value: "root_shadow", label: "Root shadow" },
  { value: "balayage_highlights", label: "Balayage highlights" },
  { value: "full_lightening", label: "Full lightening" },
  { value: "color_correction", label: "Color correction" }
];

export const GRAY_PERCENTAGE_OPTIONS: FieldOption<GrayPercentage>[] = [
  { value: "none", label: "None" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" }
];

export const SCALP_CONDITION_OPTIONS: FieldOption<ScalpCondition>[] = [
  { value: "normal", label: "Normal" },
  { value: "oily", label: "Oily" },
  { value: "dry", label: "Dry" },
  { value: "sensitive", label: "Sensitive" },
  { value: "flaking", label: "Flaking" }
];

export const TREATMENT_GOAL_DETAIL_OPTIONS: FieldOption<TreatmentGoalDetail>[] = [
  { value: "hydration", label: "Hydration" },
  { value: "repair", label: "Repair" },
  { value: "detox_scalp", label: "Scalp detox" },
  { value: "bonding_repair", label: "Bonding repair" },
  { value: "post_color_recovery", label: "Post-color recovery" }
];
