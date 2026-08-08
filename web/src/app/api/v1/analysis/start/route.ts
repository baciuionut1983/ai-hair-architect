import { NextResponse } from "next/server";

import type {
  AnalysisRequest,
  AnalysisResponse,
  DesiredColorResult,
  FaceShape,
  GrayPercentage,
  GrowthPattern,
  HairCondition,
  HairLength,
  HairTexture,
  HeadShape,
  ScalpCondition,
  TargetShape,
  TreatmentGoalDetail
} from "@/lib/contracts";
import { enrichTechnicalPlanExplanations } from "@/lib/ai-explainer";
import { analyzeInitial } from "@/lib/analysis-engine";
import {
  DENSITY_OPTIONS,
  GOAL_OPTIONS,
  HAIR_TYPE_OPTIONS,
  POROSITY_OPTIONS
} from "@/lib/analysis-field-options";
import {
  AnalysisConcurrencyError,
  AnalysisDependencyError,
  analysisPersistenceUnavailableResponse,
  createAnalysisForOwner,
  isAnalysisPersistenceError
} from "@/lib/analysis-repository";
import { shouldGenerateColorPlan } from "@/lib/color-plan-engine";
import { authenticateSessionRequest } from "@/lib/session-request-auth";
import { shouldGenerateTreatmentPlan } from "@/lib/treatment-plan-engine";

// GO-3A: reuse the GO-2 field-option lists (already verified to match this
// route's accepted values) instead of declaring a fifth independent copy.
const VALID_GOALS = GOAL_OPTIONS.map((option) => option.value);
const VALID_HAIR_TYPES = HAIR_TYPE_OPTIONS.map((option) => option.value);
const VALID_DENSITIES = DENSITY_OPTIONS.map((option) => option.value);
const VALID_POROSITIES = POROSITY_OPTIONS.map((option) => option.value);

const FACE_SHAPES: FaceShape[] = ["oval", "round", "square", "heart", "diamond", "oblong"];
const HEAD_SHAPES: HeadShape[] = [
  "balanced",
  "flat_occipital",
  "prominent_crown",
  "wide_parietal",
  "irregular_occipital"
];
const HAIR_LENGTHS: HairLength[] = ["pixie", "short", "medium", "long", "extra_long"];
const HAIR_TEXTURES: HairTexture[] = ["straight", "wavy", "curly", "coily"];
const HAIR_CONDITIONS: HairCondition[] = [
  "virgin_healthy",
  "chemically_treated",
  "high_porosity_damaged",
  "fragile_breakage"
];
const GROWTH_PATTERNS: GrowthPattern[] = [
  "regular",
  "double_crown",
  "front_cowlick",
  "nape_whorl",
  "strong_widow_peak"
];
const TARGET_SHAPES: TargetShape[] = [
  "precision_bob",
  "graduated_bob",
  "long_layers",
  "shag_mullet",
  "pixie_crop",
  "face_framing_cascade",
  "blunt_perimeter_texturized"
];
const DESIRED_COLOR_RESULTS: DesiredColorResult[] = [
  "gray_coverage",
  "gloss_refresh",
  "root_shadow",
  "balayage_highlights",
  "full_lightening",
  "color_correction"
];
const GRAY_PERCENTAGES: GrayPercentage[] = ["none", "low", "medium", "high"];
const SCALP_CONDITIONS: ScalpCondition[] = ["normal", "oily", "dry", "sensitive", "flaking"];
const TREATMENT_GOAL_DETAILS: TreatmentGoalDetail[] = [
  "hydration",
  "repair",
  "detox_scalp",
  "bonding_repair",
  "post_color_recovery"
];

export async function POST(request: Request) {
  const sessionUser = await authenticateSessionRequest();

  if (!sessionUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as Partial<AnalysisRequest>;

  if (!body.clientId || !body.goal || !body.hairType || !body.density || !body.porosity) {
    return NextResponse.json({ error: "Invalid analysis payload." }, { status: 400 });
  }

  if (
    !isOptionalEnumValue(body.goal, VALID_GOALS) ||
    !isOptionalEnumValue(body.hairType, VALID_HAIR_TYPES) ||
    !isOptionalEnumValue(body.density, VALID_DENSITIES) ||
    !isOptionalEnumValue(body.porosity, VALID_POROSITIES)
  ) {
    return NextResponse.json({ error: "Invalid analysis payload." }, { status: 400 });
  }

  if (
    !isOptionalEnumValue(body.faceShape, FACE_SHAPES) ||
    !isOptionalEnumValue(body.headShape, HEAD_SHAPES) ||
    !isOptionalEnumValue(body.hairLength, HAIR_LENGTHS) ||
    !isOptionalEnumValue(body.hairTexture, HAIR_TEXTURES) ||
    !isOptionalEnumValue(body.hairCondition, HAIR_CONDITIONS) ||
    !isOptionalEnumValue(body.growthPattern, GROWTH_PATTERNS) ||
    !isOptionalEnumValue(body.targetShape, TARGET_SHAPES) ||
    !isOptionalEnumValue(body.desiredColorResult, DESIRED_COLOR_RESULTS) ||
    !isOptionalEnumValue(body.grayPercentage, GRAY_PERCENTAGES) ||
    !isOptionalEnumValue(body.scalpCondition, SCALP_CONDITIONS) ||
    !isOptionalEnumValue(body.treatmentGoalDetail, TREATMENT_GOAL_DETAILS)
  ) {
    return NextResponse.json({ error: "Invalid milestone8 analysis payload." }, { status: 400 });
  }

  const requestsTechnicalPlan =
    body.goal === "reshape" ||
    Boolean(
      body.faceShape ||
      body.headShape ||
      body.hairLength ||
      body.hairTexture ||
      body.hairCondition ||
      body.growthPattern ||
      body.targetShape
    );
  // M27: the same professional/salon-only gate extends to color and
  // treatment plans -- reusing each engine's own shouldGenerate check
  // directly so the gate can never drift out of sync with what
  // analyzeInitial will actually generate below.
  const requestsColorPlan = shouldGenerateColorPlan(body as AnalysisRequest);
  const requestsTreatmentPlan = shouldGenerateTreatmentPlan(body as AnalysisRequest);

  if ((requestsTechnicalPlan || requestsColorPlan || requestsTreatmentPlan) && sessionUser.role === "consumer") {
    return NextResponse.json(
      { error: "Advanced technical analysis (cutting, color, or treatment) is restricted to professional or salon roles." },
      { status: 403 }
    );
  }

  const analysisSeed = analyzeInitial({
    goal: body.goal,
    hairType: body.hairType,
    density: body.density,
    porosity: body.porosity,
    faceShape: body.faceShape,
    headShape: body.headShape,
    hairLength: body.hairLength,
    hairTexture: body.hairTexture,
    hairCondition: body.hairCondition,
    growthPattern: body.growthPattern,
    targetShape: body.targetShape,
    desiredColorResult: body.desiredColorResult,
    grayPercentage: body.grayPercentage,
    scalpCondition: body.scalpCondition,
    treatmentGoalDetail: body.treatmentGoalDetail
  });

  const technicalCutPlan = analysisSeed.technicalCutPlan
    ? await enrichTechnicalPlanExplanations(analysisSeed.technicalCutPlan)
    : undefined;

  let record;
  try {
    record = await createAnalysisForOwner(sessionUser.id, body.clientId, {
      ...analysisSeed,
      technicalCutPlan
    });
  } catch (error) {
    if (error instanceof AnalysisConcurrencyError) {
      return NextResponse.json({ error: error.message }, { status: error.httpStatus });
    }
    if (error instanceof AnalysisDependencyError) {
      return NextResponse.json({ error: error.message }, { status: error.httpStatus });
    }
    if (isAnalysisPersistenceError(error)) {
      return analysisPersistenceUnavailableResponse();
    }
    throw error;
  }

  const response: AnalysisResponse = {
    analysisId: record.id,
    phase: record.phase,
    clarificationRound: record.clarificationRound,
    confidenceScore: record.confidenceScore,
    uncertaintyReasons: record.uncertaintyReasons,
    followUpQuestions: record.followUpQuestions,
    recommendations: record.recommendations,
    safetyNotes: record.safetyNotes,
    technicalCutPlan: record.technicalCutPlan,
    colorPlan: record.colorPlan,
    treatmentPlan: record.treatmentPlan
  };

  return NextResponse.json(response, { status: 200 });
}

function isOptionalEnumValue<T extends string>(value: unknown, allowed: readonly T[]): value is T | undefined {
  if (value === undefined) {
    return true;
  }

  return typeof value === "string" && (allowed as readonly string[]).includes(value);
}
