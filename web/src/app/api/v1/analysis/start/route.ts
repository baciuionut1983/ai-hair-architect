import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import type {
  AnalysisRequest,
  AnalysisResponse,
  FaceShape,
  GrowthPattern,
  HairCondition,
  HairLength,
  HairTexture,
  HeadShape,
  TargetShape
} from "@/lib/contracts";
import { enrichTechnicalPlanExplanations } from "@/lib/ai-explainer";
import { analyzeInitial } from "@/lib/analysis-engine";
import { upsertPersistedAnalysis } from "@/lib/analysis-persistence";
import { resolveOwnedClient } from "@/lib/client-repository";
import { createAnalysis, getSession } from "@/lib/milestone1-store";

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

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const token = cookieStore.get("aha_session")?.value ?? null;
  const sessionUser = getSession(token);

  if (!sessionUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as Partial<AnalysisRequest>;

  if (!body.clientId || !body.goal || !body.hairType || !body.density || !body.porosity) {
    return NextResponse.json({ error: "Invalid analysis payload." }, { status: 400 });
  }

  if (
    !isOptionalEnumValue(body.faceShape, FACE_SHAPES) ||
    !isOptionalEnumValue(body.headShape, HEAD_SHAPES) ||
    !isOptionalEnumValue(body.hairLength, HAIR_LENGTHS) ||
    !isOptionalEnumValue(body.hairTexture, HAIR_TEXTURES) ||
    !isOptionalEnumValue(body.hairCondition, HAIR_CONDITIONS) ||
    !isOptionalEnumValue(body.growthPattern, GROWTH_PATTERNS) ||
    !isOptionalEnumValue(body.targetShape, TARGET_SHAPES)
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

  if (requestsTechnicalPlan && sessionUser.role === "consumer") {
    return NextResponse.json(
      { error: "Advanced technical cutting analysis is restricted to professional or salon roles." },
      { status: 403 }
    );
  }

  const ownedClient = await resolveOwnedClient(sessionUser.id, body.clientId);
  if (ownedClient instanceof Response) return ownedClient;
  if (!ownedClient) {
    return NextResponse.json({ error: "Client not found." }, { status: 404 });
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
    targetShape: body.targetShape
  });

  const technicalCutPlan = analysisSeed.technicalCutPlan
    ? await enrichTechnicalPlanExplanations(analysisSeed.technicalCutPlan)
    : undefined;

  const record = createAnalysis({
    clientId: ownedClient.id,
    createdByUserId: sessionUser.id,
    goal: analysisSeed.goal,
    hairType: analysisSeed.hairType,
    density: analysisSeed.density,
    porosity: analysisSeed.porosity,
    phase: analysisSeed.phase,
    clarificationRound: analysisSeed.clarificationRound,
    confidenceScore: analysisSeed.confidenceScore,
    uncertaintyReasons: analysisSeed.uncertaintyReasons,
    followUpQuestions: analysisSeed.followUpQuestions,
    recommendations: analysisSeed.recommendations,
    safetyNotes: analysisSeed.safetyNotes,
    faceShape: analysisSeed.faceShape,
    headShape: analysisSeed.headShape,
    hairLength: analysisSeed.hairLength,
    hairTexture: analysisSeed.hairTexture,
    hairCondition: analysisSeed.hairCondition,
    growthPattern: analysisSeed.growthPattern,
    targetShape: analysisSeed.targetShape,
    technicalCutPlan,
    clarificationAnswers: []
  });

  await upsertPersistedAnalysis({
    id: record.id,
    clientId: record.clientId,
    ownerUserId: record.createdByUserId,
    goal: record.goal,
    hairType: record.hairType,
    density: record.density,
    porosity: record.porosity,
    phase: record.phase,
    clarificationRound: record.clarificationRound,
    confidenceScore: record.confidenceScore,
    uncertaintyReasons: record.uncertaintyReasons,
    followUpQuestions: record.followUpQuestions,
    recommendations: record.recommendations,
    safetyNotes: record.safetyNotes,
    faceShape: record.faceShape,
    headShape: record.headShape,
    hairLength: record.hairLength,
    hairTexture: record.hairTexture,
    hairCondition: record.hairCondition,
    growthPattern: record.growthPattern,
    targetShape: record.targetShape,
    technicalCutPlan: record.technicalCutPlan ?? null,
    clarificationAnswers: record.clarificationAnswers,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt
  });

  const response: AnalysisResponse = {
    analysisId: record.id,
    phase: record.phase,
    clarificationRound: record.clarificationRound,
    confidenceScore: record.confidenceScore,
    uncertaintyReasons: record.uncertaintyReasons,
    followUpQuestions: record.followUpQuestions,
    recommendations: record.recommendations,
    safetyNotes: record.safetyNotes,
    technicalCutPlan: record.technicalCutPlan
  };

  return NextResponse.json(response, { status: 200 });
}

function isOptionalEnumValue<T extends string>(value: unknown, allowed: readonly T[]): value is T | undefined {
  if (value === undefined) {
    return true;
  }

  return typeof value === "string" && (allowed as readonly string[]).includes(value);
}
