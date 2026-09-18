import { NextResponse } from "next/server";

import {
  isProfessionalLearningDraftPersistenceError,
  professionalLearningDraftPersistenceUnavailableResponse,
  ProfessionalLearningDraftStateError,
  transitionDraftStatus,
} from "@/lib/professional-learning-draft-repository";
import { authenticateSessionRequest } from "@/lib/session-request-auth";
import { buildProceduralInterpretation } from "@/lib/professional-learning-video-temporal-to-procedural-adapter";

// Professional Skill Engine, Stage 8.5L4 -- Part 28/29 ("record
// professional review decision"). APPROVED here means PROFESSIONAL REVIEW
// APPROVED ONLY -- it never creates, updates, or activates a
// ProfessionalSkillDefinition row (Part 28's own explicit distinction:
// "If approval is implemented in L4, it records PROFESSIONAL REVIEW
// APPROVED, not REGISTRY ACTIVATED. Those are separate gates."). Registry
// promotion is an explicitly later, separately-authorized stage.
export async function POST(request: Request, context: { params: Promise<{ draftId: string }> }) {
  const user = await authenticateSessionRequest();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { draftId } = await context.params;
  const body = (await request.json().catch(() => ({}))) as { decision?: string };

  if (body.decision !== "APPROVED" && body.decision !== "REJECTED") {
    return NextResponse.json({ error: "INVALID_REQUEST", message: "decision must be APPROVED or REJECTED." }, { status: 400 });
  }

  try {
    const draft = await transitionDraftStatus(user.id, draftId, body.decision, { reviewedByUserId: user.id, reviewedAt: new Date() });
    // Stage 8.5T1.4.a -- see the drafts route's own identical comment:
    // computed at response time only, never persisted.
    const proceduralInterpretation = buildProceduralInterpretation(draft.id, draft.temporalEvidence);
    return NextResponse.json({
      draft: { ...draft, proceduralInterpretation },
      note: "This records professional review approval of the INTERPRETATION only -- it does not activate any ProfessionalSkillDefinition.",
    });
  } catch (error) {
    if (error instanceof ProfessionalLearningDraftStateError) {
      return NextResponse.json({ error: error.code, message: error.message }, { status: error.fromStatus === "NOT_FOUND" ? 404 : error.httpStatus });
    }
    if (isProfessionalLearningDraftPersistenceError(error)) return professionalLearningDraftPersistenceUnavailableResponse();
    throw error;
  }
}
