import { NextResponse } from "next/server";

import { guardBusinessPersistence } from "@/lib/business-persistence-guards";
import type { ConsultationCreateRequest } from "@/lib/contracts";
import {
  ConsultationDependencyError,
  ConsultationValidationError,
  consultationPersistenceUnavailableResponse,
  createConsultationForOwner,
  isConsultationPersistenceError,
  normalizeConsultationNextSteps,
  normalizeConsultationSummary,
} from "@/lib/consultation-repository";
import { authenticateSessionRequest } from "@/lib/session-request-auth";

export async function POST(request: Request) {
  const blockedResponse = guardBusinessPersistence("consultations", request);
  if (blockedResponse) {
    return blockedResponse;
  }

  const sessionUser = await authenticateSessionRequest();

  if (!sessionUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Partial<ConsultationCreateRequest>;
  try {
    body = (await request.json()) as Partial<ConsultationCreateRequest>;
  } catch {
    return NextResponse.json({ error: "Invalid consultation payload." }, { status: 400 });
  }

  if (typeof body.clientId !== "string" || !body.clientId || typeof body.analysisId !== "string" || !body.analysisId) {
    return NextResponse.json({ error: "Invalid consultation payload." }, { status: 400 });
  }

  try {
    const consultation = await createConsultationForOwner(sessionUser.id, {
      clientId: body.clientId,
      analysisId: body.analysisId,
      summary: normalizeConsultationSummary(body.summary),
      nextSteps: normalizeConsultationNextSteps(body.nextSteps),
    });
    return NextResponse.json({ consultation }, { status: 201 });
  } catch (error) {
    if (error instanceof ConsultationValidationError) {
      return NextResponse.json({ error: error.code, message: error.message }, { status: error.httpStatus });
    }
    if (error instanceof ConsultationDependencyError) {
      return NextResponse.json({ error: error.message }, { status: error.httpStatus });
    }
    if (isConsultationPersistenceError(error)) return consultationPersistenceUnavailableResponse();
    throw error;
  }
}
