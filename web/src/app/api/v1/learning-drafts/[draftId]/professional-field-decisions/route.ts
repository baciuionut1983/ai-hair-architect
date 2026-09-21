import { authenticateSessionRequest } from "@/lib/session-request-auth";
import { readProfessionalFieldDecisionReview } from "@/lib/professional-field-claim-decision-service";
import { decisionJson, decisionErrorResponse } from "@/lib/professional-field-decision-http";

export async function GET(_request: Request, context: { params: Promise<{ draftId: string }> }) {
  try {
    const user = await authenticateSessionRequest();
    if (!user) return decisionJson({ error: "Unauthorized" }, 401);
    const { draftId } = await context.params;
    return decisionJson(await readProfessionalFieldDecisionReview(user.id, draftId));
  } catch (error) { return decisionErrorResponse(error); }
}
