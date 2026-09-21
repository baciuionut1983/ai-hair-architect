import { authenticateSessionRequest } from "@/lib/session-request-auth";
import { checkRateLimit } from "@/lib/hardening";
import { PROFESSIONAL_FIELD_DECISION_FIELDS, submitProfessionalFieldClaimDecision, toProfessionalFieldDecisionDto } from "@/lib/professional-field-claim-decision-service";
import { decisionJson, decisionErrorResponse, isSameOriginDecisionRequest, readDecisionBody } from "@/lib/professional-field-decision-http";

export async function POST(request: Request, context: { params: Promise<{ draftId: string; field: string }> }) {
  try {
    const user = await authenticateSessionRequest();
    if (!user) return decisionJson({ error: "Unauthorized" }, 401);
    if (!checkRateLimit(`professional-field-decision:${user.id}`, 30, 60_000).allowed) return decisionJson({ error: "Rate limit exceeded." }, 429);
    if (!isSameOriginDecisionRequest(request)) return decisionJson({ error: "CROSS_ORIGIN_REJECTED" }, 403);
    if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") return decisionJson({ error: "UNSUPPORTED_MEDIA_TYPE" }, 415);
    const body = await readDecisionBody(request);
    const { draftId, field } = await context.params;
    if (!PROFESSIONAL_FIELD_DECISION_FIELDS.includes(field)) return decisionJson({ error: "FIELD_NOT_FOUND" }, 404);
    const result = await submitProfessionalFieldClaimDecision(user.id, { ...body, draftId, field });
    return decisionJson({ outcome: result.outcome, decision: toProfessionalFieldDecisionDto(result.decision) }, result.httpStatus);
  } catch (error) { return decisionErrorResponse(error); }
}
