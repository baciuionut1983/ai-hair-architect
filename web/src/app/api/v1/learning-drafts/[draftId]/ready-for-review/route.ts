import { NextResponse } from "next/server";

import {
  isProfessionalLearningDraftPersistenceError,
  professionalLearningDraftPersistenceUnavailableResponse,
  ProfessionalLearningDraftStateError,
  transitionDraftStatus,
} from "@/lib/professional-learning-draft-repository";
import { authenticateSessionRequest } from "@/lib/session-request-auth";

// Professional Skill Engine, Stage 8.5L4 -- Part 28/29 ("mark ready for
// review"). Purely a status transition -- never touches extraction
// content, comparisonOutcome, or the skill registry.
export async function POST(request: Request, context: { params: Promise<{ draftId: string }> }) {
  const user = await authenticateSessionRequest();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { draftId } = await context.params;

  try {
    const draft = await transitionDraftStatus(user.id, draftId, "READY_FOR_REVIEW");
    return NextResponse.json({ draft });
  } catch (error) {
    if (error instanceof ProfessionalLearningDraftStateError) {
      return NextResponse.json({ error: error.code, message: error.message }, { status: error.fromStatus === "NOT_FOUND" ? 404 : error.httpStatus });
    }
    if (isProfessionalLearningDraftPersistenceError(error)) return professionalLearningDraftPersistenceUnavailableResponse();
    throw error;
  }
}
