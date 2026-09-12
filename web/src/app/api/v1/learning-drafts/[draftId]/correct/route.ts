import { randomUUID } from "crypto";

import { NextResponse } from "next/server";

import { findDraftForOwner, isProfessionalLearningDraftPersistenceError, professionalLearningDraftPersistenceUnavailableResponse, ProfessionalLearningDraftStateError } from "@/lib/professional-learning-draft-repository";
import { submitProfessionalCorrection, ProfessionalLearningDraftServiceError } from "@/lib/professional-learning-draft-service";
import { authenticateSessionRequest } from "@/lib/session-request-auth";

// Professional Skill Engine, Stage 8.5L4 -- Part 15/28. A professional
// correction is an explicit, professional-initiated action distinguishable
// from AI inference -- the caller must name the exact evidence backing
// the correction (correctionEvidenceId) and the specific field(s) being
// corrected. Never a destructive rewrite: the prior draft is transitioned
// to SUPERSEDED, never deleted or edited in place.
export async function POST(request: Request, context: { params: Promise<{ draftId: string }> }) {
  const user = await authenticateSessionRequest();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { draftId } = await context.params;
  const body = (await request.json().catch(() => ({}))) as {
    correctionEvidenceId?: string;
    correctedFields?: Record<string, { value?: unknown; previousValue?: unknown }>;
  };

  if (typeof body.correctionEvidenceId !== "string" || !body.correctionEvidenceId) {
    return NextResponse.json({ error: "INVALID_REQUEST", message: "correctionEvidenceId is required." }, { status: 400 });
  }
  if (!body.correctedFields || typeof body.correctedFields !== "object" || Object.keys(body.correctedFields).length === 0) {
    return NextResponse.json({ error: "INVALID_REQUEST", message: "At least one corrected field is required." }, { status: 400 });
  }

  try {
    const prior = await findDraftForOwner(user.id, draftId);
    if (!prior) {
      return NextResponse.json({ error: "DRAFT_NOT_FOUND", message: "Draft not found." }, { status: 404 });
    }

    const correctedFields = Object.fromEntries(
      Object.entries(body.correctedFields).map(([field, entry]) => [field, { value: entry?.value ?? null, previousValue: entry?.previousValue ?? null }]),
    );

    const draft = await submitProfessionalCorrection({
      ownerUserId: user.id,
      priorDraftId: draftId,
      correctionEvidenceId: body.correctionEvidenceId,
      newDraftId: randomUUID(),
      correctedFields,
      correctedByUserId: user.id,
    });
    return NextResponse.json({ draft }, { status: 201 });
  } catch (error) {
    if (error instanceof ProfessionalLearningDraftServiceError) {
      return NextResponse.json({ error: error.code, message: error.message }, { status: error.httpStatus });
    }
    if (error instanceof ProfessionalLearningDraftStateError) {
      return NextResponse.json({ error: error.code, message: error.message }, { status: error.fromStatus === "NOT_FOUND" ? 404 : error.httpStatus });
    }
    if (isProfessionalLearningDraftPersistenceError(error)) return professionalLearningDraftPersistenceUnavailableResponse();
    throw error;
  }
}
