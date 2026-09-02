import { NextResponse } from "next/server";

import { authenticateSessionRequest } from "@/lib/session-request-auth";
import { resolveOrchestratorDecisionAndPlan } from "@/lib/orchestrator-service";
import { resolveOrchestratorRoleClass } from "@/lib/orchestrator-contracts";
import { isRecord } from "@/lib/technical-visual-map-validators";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" } as const;
const MAX_MESSAGE_LENGTH = 2000;

// AI Concierge / Orchestrator -- the ONLY HTTP surface this feature
// exposes. Session-authenticated (task section 11/12: no path to any
// orchestration effect without a real, authenticated owner). Accepts
// EITHER a free-text message OR hasCompletedPhotoPreview:true (Stage 2:
// the system-triggered "a real Photo Preview just completed" check --
// see orchestrator-service.ts's own header comment on why this is never a
// fabricated message) -- at least one of the two is required. Also
// accepts OPTIONAL context ids the caller believes are current -- every
// one of those ids is re-verified server-side against real ownership by
// resolveOrchestratorDecision itself before ever influencing the
// response; this route never trusts them directly.
//
// Returns a validated OrchestratorDecision (never raw model/classifier
// output) -- see orchestrator-contracts.ts's own isOrchestratorDecision,
// which resolveOrchestratorDecision always runs the result through.
//
// This route NEVER calls into Video/Photo Preview/any other engine's own
// create/execute endpoints -- it only ever returns a decision describing
// where the client should navigate next (or, for OFFER_VIDEO, a
// presentational question with no navigation target at all). See
// orchestrator-action-registry.ts's own header comment for why that is
// true by construction in this stage.
export async function POST(request: Request) {
  const sessionUser = await authenticateSessionRequest();
  if (!sessionUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE_HEADERS });
  }

  let body: unknown;
  try {
    const text = await request.text();
    body = text.length > 0 ? JSON.parse(text) : {};
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400, headers: NO_STORE_HEADERS });
  }
  if (!isRecord(body)) {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400, headers: NO_STORE_HEADERS });
  }

  const message = typeof body.message === "string" ? body.message.trim() : "";
  const hasCompletedPhotoPreview = body.hasCompletedPhotoPreview === true;
  if (!message && !hasCompletedPhotoPreview) {
    return NextResponse.json(
      { error: "message is required unless hasCompletedPhotoPreview is true." },
      { status: 422, headers: NO_STORE_HEADERS },
    );
  }
  if (message.length > MAX_MESSAGE_LENGTH) {
    return NextResponse.json(
      { error: "message must be at most 2000 characters." },
      { status: 422, headers: NO_STORE_HEADERS },
    );
  }

  const currentClientId = typeof body.currentClientId === "string" ? body.currentClientId : null;
  const currentAnalysisId = typeof body.currentAnalysisId === "string" ? body.currentAnalysisId : null;
  // Stage 4/5: forwarded raw -- resolveOrchestratorDecisionAndPlan itself
  // validates both against their own closed vocabularies (see that
  // function's own header comment); this route never needs to know
  // either one.
  const pendingDecision = typeof body.pendingDecision === "string" ? body.pendingDecision : null;
  const activePlanGoal = typeof body.activePlanGoal === "string" ? body.activePlanGoal : null;

  const { decision, plan } = await resolveOrchestratorDecisionAndPlan({
    message,
    roleClass: resolveOrchestratorRoleClass(sessionUser.role),
    ownerUserId: sessionUser.id,
    currentClientId,
    currentAnalysisId,
    hasCompletedPhotoPreview,
    pendingDecision,
    activePlanGoal,
  });

  // Stage 5: `plan` is additive -- null whenever no registered goal
  // applies this turn, never present at the expense of `decision`'s own
  // unchanged shape (see orchestrator-plan-contracts.ts's own header
  // comment on why this is a separate, parallel field).
  return NextResponse.json({ decision, plan }, { status: 200, headers: NO_STORE_HEADERS });
}
