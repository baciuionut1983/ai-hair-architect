import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import type { AnalysisClarifyRequest, AnalysisResponse } from "@/lib/contracts";
import { analyzeWithClarifications } from "@/lib/analysis-engine";
import { upsertPersistedAnalysis } from "@/lib/analysis-persistence";
import { getAnalysisOwnedByUser, getSession, sanitize, updateAnalysis } from "@/lib/milestone1-store";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const cookieStore = await cookies();
  const token = cookieStore.get("aha_session")?.value ?? null;
  const sessionUser = getSession(token);

  if (!sessionUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  const analysis = getAnalysisOwnedByUser(id, sessionUser.id);
  if (!analysis) {
    return NextResponse.json({ error: "Analysis not found." }, { status: 404 });
  }

  const body = (await request.json()) as Partial<AnalysisClarifyRequest>;
  const answers = Array.isArray(body.answers) ? body.answers.map((entry) => sanitize(entry)).filter(Boolean) : [];

  if (answers.length === 0) {
    return NextResponse.json({ error: "answers[] is required." }, { status: 400 });
  }

  const nextState = analyzeWithClarifications(analysis, { answers });
  const updated = updateAnalysis(id, nextState);
  if (!updated) {
    return NextResponse.json({ error: "Unable to update analysis." }, { status: 500 });
  }

  await upsertPersistedAnalysis({
    id: updated.id,
    clientId: updated.clientId,
    ownerUserId: updated.createdByUserId,
    goal: updated.goal,
    hairType: updated.hairType,
    density: updated.density,
    porosity: updated.porosity,
    phase: updated.phase,
    clarificationRound: updated.clarificationRound,
    confidenceScore: updated.confidenceScore,
    uncertaintyReasons: updated.uncertaintyReasons,
    followUpQuestions: updated.followUpQuestions,
    recommendations: updated.recommendations,
    safetyNotes: updated.safetyNotes,
    faceShape: updated.faceShape,
    headShape: updated.headShape,
    hairLength: updated.hairLength,
    hairTexture: updated.hairTexture,
    hairCondition: updated.hairCondition,
    growthPattern: updated.growthPattern,
    targetShape: updated.targetShape,
    technicalCutPlan: updated.technicalCutPlan ?? null,
    clarificationAnswers: updated.clarificationAnswers,
    createdAt: updated.createdAt,
    updatedAt: updated.updatedAt
  });

  const response: AnalysisResponse = {
    analysisId: updated.id,
    phase: updated.phase,
    clarificationRound: updated.clarificationRound,
    confidenceScore: updated.confidenceScore,
    uncertaintyReasons: updated.uncertaintyReasons,
    followUpQuestions: updated.followUpQuestions,
    recommendations: updated.recommendations,
    safetyNotes: updated.safetyNotes,
    technicalCutPlan: updated.technicalCutPlan
  };

  return NextResponse.json(response, { status: 200 });
}
