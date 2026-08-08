import { NextResponse } from "next/server";

import type { AnalysisClarifyRequest, AnalysisResponse } from "@/lib/contracts";
import { analyzeWithClarifications } from "@/lib/analysis-engine";
import {
  AnalysisConcurrencyError,
  analysisPersistenceUnavailableResponse,
  clarifyAnalysisForOwner,
  isAnalysisPersistenceError
} from "@/lib/analysis-repository";
import { sanitize } from "@/lib/milestone1-store";
import { authenticateSessionRequest } from "@/lib/session-request-auth";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const sessionUser = await authenticateSessionRequest();

  if (!sessionUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as Partial<AnalysisClarifyRequest>;
  const answers = Array.isArray(body.answers) ? body.answers.map((entry) => sanitize(entry)).filter(Boolean) : [];

  if (answers.length === 0) {
    return NextResponse.json({ error: "answers[] is required." }, { status: 400 });
  }

  const { id } = await context.params;
  let updated;
  try {
    updated = await clarifyAnalysisForOwner(
      sessionUser.id,
      id,
      (current) => analyzeWithClarifications(current, { answers })
    );
  } catch (error) {
    if (error instanceof AnalysisConcurrencyError) {
      return NextResponse.json({ error: error.message }, { status: error.httpStatus });
    }
    if (isAnalysisPersistenceError(error)) {
      return analysisPersistenceUnavailableResponse();
    }
    throw error;
  }

  if (!updated) {
    return NextResponse.json({ error: "Analysis not found." }, { status: 404 });
  }

  const response: AnalysisResponse = {
    analysisId: updated.id,
    phase: updated.phase,
    clarificationRound: updated.clarificationRound,
    confidenceScore: updated.confidenceScore,
    uncertaintyReasons: updated.uncertaintyReasons,
    followUpQuestions: updated.followUpQuestions,
    recommendations: updated.recommendations,
    safetyNotes: updated.safetyNotes,
    technicalCutPlan: updated.technicalCutPlan,
    colorPlan: updated.colorPlan,
    treatmentPlan: updated.treatmentPlan
  };

  return NextResponse.json(response, { status: 200 });
}
