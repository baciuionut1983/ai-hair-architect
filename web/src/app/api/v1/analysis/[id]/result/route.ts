import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import type {
  AnalysisGoal,
  AnalysisPhase,
  AnalysisResultResponse,
  DensityLevel,
  FaceShape,
  GrowthPattern,
  HairCondition,
  HairLength,
  HairTexture,
  HairType,
  HeadShape,
  PorosityLevel,
  TargetShape
} from "@/lib/contracts";
import { findPersistedAnalysisById } from "@/lib/analysis-persistence";
import { getAnalysisOwnedByUser, getSession } from "@/lib/milestone1-store";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const cookieStore = await cookies();
  const token = cookieStore.get("aha_session")?.value ?? null;
  const sessionUser = getSession(token);

  if (!sessionUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  const persisted = await findPersistedAnalysisById(id, sessionUser.id);
  const analysis = persisted ?? getAnalysisOwnedByUser(id, sessionUser.id);
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
    phase: analysis.phase as AnalysisPhase,
    clarificationRound: analysis.clarificationRound,
    confidenceScore: analysis.confidenceScore,
    uncertaintyReasons: analysis.uncertaintyReasons,
    followUpQuestions: analysis.followUpQuestions,
    recommendations: analysis.recommendations,
    safetyNotes: analysis.safetyNotes,
    technicalCutPlan: analysis.technicalCutPlan ?? undefined,
    clarificationAnswers: analysis.clarificationAnswers,
    createdAt: analysis.createdAt,
    updatedAt: analysis.updatedAt
  };

  return NextResponse.json(response, { status: 200 });
}
