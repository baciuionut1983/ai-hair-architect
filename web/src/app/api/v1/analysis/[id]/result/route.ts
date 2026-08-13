import { NextResponse } from "next/server";

import type {
  AnalysisGoal,
  AnalysisPhase,
  AnalysisResultResponse,
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
import {
  analysisPersistenceUnavailableResponse,
  findAnalysisForOwner,
  isAnalysisPersistenceError
} from "@/lib/analysis-repository";
import { authenticateSessionRequest } from "@/lib/session-request-auth";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const sessionUser = await authenticateSessionRequest();

  if (!sessionUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  let analysis;
  try {
    analysis = await findAnalysisForOwner(sessionUser.id, id);
  } catch (error) {
    if (isAnalysisPersistenceError(error)) {
      return analysisPersistenceUnavailableResponse();
    }
    throw error;
  }

  if (!analysis) {
    return NextResponse.json({ error: "Analysis not found." }, { status: 404 });
  }

  const response: AnalysisResultResponse = {
    analysisId: analysis.id,
    clientId: analysis.clientId,
    goal: analysis.goal as AnalysisGoal,
    hairType: analysis.hairType as HairType,
    density: analysis.density as DensityLevel,
    porosity: analysis.porosity as PorosityLevel,
    faceShape: (analysis.faceShape ?? undefined) as FaceShape | undefined,
    headShape: (analysis.headShape ?? undefined) as HeadShape | undefined,
    hairLength: (analysis.hairLength ?? undefined) as HairLength | undefined,
    hairTexture: (analysis.hairTexture ?? undefined) as HairTexture | undefined,
    hairCondition: (analysis.hairCondition ?? undefined) as HairCondition | undefined,
    growthPattern: (analysis.growthPattern ?? undefined) as GrowthPattern | undefined,
    targetShape: (analysis.targetShape ?? undefined) as TargetShape | undefined,
    desiredColorResult: (analysis.desiredColorResult ?? undefined) as DesiredColorResult | undefined,
    grayPercentage: (analysis.grayPercentage ?? undefined) as GrayPercentage | undefined,
    scalpCondition: (analysis.scalpCondition ?? undefined) as ScalpCondition | undefined,
    treatmentGoalDetail: (analysis.treatmentGoalDetail ?? undefined) as TreatmentGoalDetail | undefined,
    phase: analysis.phase as AnalysisPhase,
    clarificationRound: analysis.clarificationRound,
    confidenceScore: analysis.confidenceScore,
    uncertaintyReasons: analysis.uncertaintyReasons,
    followUpQuestions: analysis.followUpQuestions,
    recommendations: analysis.recommendations,
    safetyNotes: analysis.safetyNotes,
    technicalCutPlan: analysis.technicalCutPlan ?? undefined,
    colorPlan: analysis.colorPlan ?? undefined,
    treatmentPlan: analysis.treatmentPlan ?? undefined,
    clarificationAnswers: analysis.clarificationAnswers,
    imageAssetId: analysis.imageAssetId ?? null,
    createdAt: analysis.createdAt,
    updatedAt: analysis.updatedAt
  };

  return NextResponse.json(response, { status: 200 });
}
