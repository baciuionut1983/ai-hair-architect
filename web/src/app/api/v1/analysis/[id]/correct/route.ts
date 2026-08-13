import { NextResponse } from "next/server";

import type { AnalysisCorrectionApplyResponse, AnalysisCorrectionRequest, AnalysisResponse } from "@/lib/contracts";
import {
  AnalysisConcurrencyError,
  AnalysisCorrectionValidationError,
  analysisPersistenceUnavailableResponse,
  applyAnalysisCorrection,
  isAnalysisPersistenceError,
  isCorrectableAnalysisField,
  listAnalysisCorrections,
} from "@/lib/analysis-repository";
import { authenticateSessionRequest } from "@/lib/session-request-auth";

const VALID_SOURCES = new Set(["stylist_confirmed", "client_reported"]);

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const sessionUser = await authenticateSessionRequest();

  if (!sessionUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as Partial<AnalysisCorrectionRequest>;

  const field = typeof body.field === "string" ? body.field.trim() : "";
  const value = typeof body.value === "string" ? body.value.trim() : "";
  const source = typeof body.source === "string" ? body.source : "";
  const reason = typeof body.reason === "string" ? body.reason.trim() : undefined;

  if (!field || !value || !VALID_SOURCES.has(source)) {
    return NextResponse.json(
      { error: "field, value, and a valid source (stylist_confirmed or client_reported) are required." },
      { status: 400 }
    );
  }

  if (!isCorrectableAnalysisField(field)) {
    return NextResponse.json({ error: "ANALYSIS_CORRECTION_INVALID_FIELD" }, { status: 400 });
  }

  const { id } = await context.params;
  let updated;
  try {
    updated = await applyAnalysisCorrection(sessionUser.id, id, {
      field,
      value,
      source: source as "stylist_confirmed" | "client_reported",
      reason
    });
  } catch (error) {
    if (error instanceof AnalysisCorrectionValidationError) {
      return NextResponse.json({ error: error.code, message: error.message }, { status: 400 });
    }
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

  const corrections = await listAnalysisCorrections(sessionUser.id, id);
  const latestCorrection = corrections[corrections.length - 1];

  const analysis: AnalysisResponse = {
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
    treatmentPlan: updated.treatmentPlan,
    imageAssetId: updated.imageAssetId ?? null
  };

  const response: AnalysisCorrectionApplyResponse = {
    analysis,
    correction: latestCorrection
  };

  return NextResponse.json(response, { status: 200 });
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const sessionUser = await authenticateSessionRequest();

  if (!sessionUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  let corrections;
  try {
    corrections = await listAnalysisCorrections(sessionUser.id, id);
  } catch (error) {
    if (isAnalysisPersistenceError(error)) {
      return analysisPersistenceUnavailableResponse();
    }
    throw error;
  }

  return NextResponse.json({ corrections }, { status: 200 });
}
