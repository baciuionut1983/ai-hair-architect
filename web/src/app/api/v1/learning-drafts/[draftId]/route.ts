import { NextResponse } from "next/server";

import { findDraftForOwner, isProfessionalLearningDraftPersistenceError, professionalLearningDraftPersistenceUnavailableResponse } from "@/lib/professional-learning-draft-repository";
import { authenticateSessionRequest } from "@/lib/session-request-auth";
import { hydrateProceduralDraft } from "@/lib/professional-learning-procedural-read";

// Professional Skill Engine, Stage 8.5L4 -- draft detail (Part 28: "read
// draft," "inspect field provenance," "inspect comparison to registry").
// Owner-scoped: another user's draft is indistinguishable from a
// nonexistent one (404), never a 403 that would confirm its existence.
export async function GET(request: Request, context: { params: Promise<{ draftId: string }> }) {
  const user = await authenticateSessionRequest();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { draftId } = await context.params;

  try {
    const draft = await findDraftForOwner(user.id, draftId);
    if (!draft) {
      return NextResponse.json({ error: "DRAFT_NOT_FOUND", message: "Draft not found." }, { status: 404 });
    }
    return NextResponse.json({ draft: hydrateProceduralDraft(draft) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (isProfessionalLearningDraftPersistenceError(error)) return professionalLearningDraftPersistenceUnavailableResponse();
    throw error;
  }
}
