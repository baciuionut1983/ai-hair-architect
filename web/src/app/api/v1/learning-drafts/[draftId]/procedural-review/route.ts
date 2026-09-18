import { NextResponse } from "next/server";

import {
  isProfessionalLearningDraftPersistenceError,
  professionalLearningDraftPersistenceUnavailableResponse,
  ProfessionalLearningProceduralReviewStateError,
} from "@/lib/professional-learning-draft-repository";
import { ProfessionalLearningProceduralReviewServiceError, submitProceduralClaimReview } from "@/lib/professional-learning-procedural-review-service";
import { authenticateSessionRequest } from "@/lib/session-request-auth";
import { isExpectedProceduralReviewRevision } from "@/lib/professional-learning-procedural-read";

// AI Hair Architect, Professional Skill Engine Stage 8.5T1.4.b.1 --
// PROFESSIONAL PROCEDURAL REVIEW. Records exactly ONE professional
// decision (CONFIRM/CORRECT/REJECT/UNKNOWN) about exactly ONE
// procedural pattern claim derived by the T1.4.a bridge. Never creates
// active Professional Knowledge, never activates a Skill, never
// creates an ExecutionPlan -- see professional-learning-procedural-
// review-service.ts's own header for the full authority argument.
//
// REVIEWER IDENTITY IS SERVER-SESSION-ONLY (the T1.4.b audit's own
// explicit requirement): `user.id` is the ONLY source of
// reviewedByUserId/ownerUserId passed downstream. The request body is
// never read for any identity field -- a client sending
// reviewedByUserId/reviewerUserId/ownerUserId in the body has no way
// to influence who this action is attributed to.
export async function POST(request: Request, context: { params: Promise<{ draftId: string }> }) {
  const user = await authenticateSessionRequest();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { draftId } = await context.params;
  const body = (await request.json().catch(() => null)) as { claimId?: unknown; decision?: unknown; correctedValue?: unknown; note?: unknown; expectedProceduralReviewRevision?: unknown } | null;

  if (typeof body?.claimId !== "string" || body.claimId.length === 0) {
    return NextResponse.json({ error: "INVALID_REQUEST", message: "claimId is required." }, { status: 400 });
  }
  if (typeof body?.decision !== "string") {
    return NextResponse.json({ error: "INVALID_REQUEST", message: "decision is required." }, { status: 400 });
  }

  if (!isExpectedProceduralReviewRevision(body.expectedProceduralReviewRevision)) {
    return NextResponse.json({ error: "INVALID_EXPECTED_REVISION", message: "A valid expectedProceduralReviewRevision is required." }, { status: 400 });
  }

  try {
    const draft = await submitProceduralClaimReview({
      ownerUserId: user.id,
      draftId,
      claimId: body.claimId,
      decision: body.decision,
      expectedProceduralReviewRevision: body.expectedProceduralReviewRevision,
      ...(typeof body.correctedValue === "string" ? { correctedValue: body.correctedValue } : {}),
      ...(typeof body.note === "string" ? { note: body.note } : {}),
      // Stage 8.5T1.4.b audit, Part 2 -- ALWAYS the authenticated
      // session's own id. Never body.reviewedByUserId/reviewerUserId,
      // which do not even exist as recognized fields above.
      reviewedByUserId: user.id,
    });
    return NextResponse.json({ draft });
  } catch (error) {
    if (error instanceof ProfessionalLearningProceduralReviewServiceError) {
      return NextResponse.json({ error: error.code, message: error.message }, { status: error.httpStatus });
    }
    if (error instanceof ProfessionalLearningProceduralReviewStateError) {
      return NextResponse.json({ error: error.code, message: error.message }, { status: error.httpStatus });
    }
    if (isProfessionalLearningDraftPersistenceError(error)) return professionalLearningDraftPersistenceUnavailableResponse();
    throw error;
  }
}
