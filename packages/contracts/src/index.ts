export type UserRole = "professional" | "salon" | "consumer";

export type Locale = "en" | "ro";

export interface AuthRegisterRequest {
  email: string;
  password: string;
  role: UserRole;
  locale: Locale;
}

export interface AuthLoginRequest {
  email: string;
  password: string;
}

export interface AuthSessionResponse {
  token: string;
  user: {
    id: string;
    email: string;
    role: UserRole;
    locale: Locale;
    createdAt: string;
  };
}

export interface ClientCreateRequest {
  fullName: string;
  email?: string;
  phone?: string;
  notes?: string;
}

export interface ClientUpdateRequest {
  fullName?: string;
  email?: string;
  phone?: string;
  notes?: string;
}

export interface ClientRecord {
  id: string;
  ownerUserId: string;
  fullName: string;
  email: string;
  phone: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export type FaceShape = "oval" | "round" | "square" | "heart" | "diamond" | "oblong";
export type HeadShape = "balanced" | "flat_occipital" | "prominent_crown" | "wide_parietal" | "irregular_occipital";
export type HairLength = "pixie" | "short" | "medium" | "long" | "extra_long";
export type HairTexture = "straight" | "wavy" | "curly" | "coily";
export type HairDensity = "low" | "medium" | "high";
export type HairCondition = "virgin_healthy" | "chemically_treated" | "high_porosity_damaged" | "fragile_breakage";
export type GrowthPattern = "regular" | "double_crown" | "front_cowlick" | "nape_whorl" | "strong_widow_peak";
export type TargetShape = "precision_bob" | "graduated_bob" | "long_layers" | "shag_mullet" | "pixie_crop" | "face_framing_cascade" | "blunt_perimeter_texturized";

export type StructuralTechnique = "precision_layering" | "graduation" | "one_length" | "internal_layering" | "compact_graduation";
export type CuttingTechnique = "blunt_line" | "scissor_over_comb" | "slice_cutting" | "elevation_cutting";
export type TexturizingTechnique = "point_cutting" | "slice_and_slide" | "razor_texturizing" | "channel_cutting" | "debulking";
export type TechnicalCutSectioning = "4_quadrant_profile_radial" | "horseshoe_crown" | "diagonal_back" | "pivot_radial" | "horseshoe_fringe";
export type TechnicalCutElevation = "0_deg_blunt" | "45_deg_graduation" | "90_deg_uniform_layer" | "135_deg_long_layer" | "180_deg_overdirection";
export type TechnicalCutDistribution = "natural_fall" | "perpendicular" | "overdirected_back" | "overdirected_forward" | "shifting_line";
export type TechnicalCutGuideline = "stationary" | "traveling" | "visual_perimeter" | "multiple_reference";

export interface CuttingStep {
  stepNumber: number;
  zone: string;
  action: string;
  elevationAngle: TechnicalCutElevation;
  toolRequired: string;
}

export interface TechnicalCutPlan {
  structuralTechnique: StructuralTechnique;
  cuttingTechnique: CuttingTechnique;
  texturizingTechnique?: TexturizingTechnique;
  sectioning: TechnicalCutSectioning;
  elevation: TechnicalCutElevation;
  distribution: TechnicalCutDistribution;
  guideline: TechnicalCutGuideline;
  cuttingSteps: CuttingStep[];
  stylistExplanation: string;
  clientExplanation: string;
  professionalReason: string;
  warnings: string[];
  contraindications: string[];
  assumptions: string[];
  missingData: string[];
  confidence: number;
  notes?: string[];
  stylistValidationDisclaimer: string;
  version: string;
}

export interface AnalysisRequest {
  clientId: string;
  goal: "refresh" | "cover" | "lighten" | "correct" | "reshape" | "treat";
  hairType: "fine" | "medium" | "coarse";
  density: "low" | "medium" | "high";
  porosity: "low" | "medium" | "high";
  faceShape?: FaceShape;
  headShape?: HeadShape;
  hairLength?: HairLength;
  hairTexture?: HairTexture;
  hairCondition?: HairCondition;
  growthPattern?: GrowthPattern;
  targetShape?: TargetShape;
}

export interface AnalysisResponse {
  analysisId: string;
  confidenceScore: number;
  uncertaintyReasons: string[];
  followUpQuestions: string[];
  recommendations: string[];
  safetyNotes: string[];
  technicalCutPlan?: TechnicalCutPlan;
}

export interface ConsultationCreateRequest {
  clientId: string;
  analysisId: string;
  summary: string;
  nextSteps: string[];
}

export interface ConsultationRecord {
  id: string;
  clientId: string;
  analysisId: string;
  summary: string;
  nextSteps: string[];
  createdAt: string;
}
