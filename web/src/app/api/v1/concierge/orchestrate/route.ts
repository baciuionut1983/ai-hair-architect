import { NextResponse } from "next/server";

import { authenticateSessionRequest } from "@/lib/session-request-auth";
import { resolveOrchestratorDecision } from "@/lib/orchestrator-service";
import { resolveOrchestratorRoleClass } from "@/lib/orchestrator-contracts";
import { isRecord } from "@/lib/technical-visual-map-validators";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" } as const;
const MAX_MESSAGE_LENGTH = 2000;

// AI Concierge / Orchestrator, Stage 1 -- the ONLY HTTP surface this stage
// exposes. Session-authenticated (task section 11: no path to any
// orchestration effect without a real, authenticated owner). Accepts a
// free-text message plus OPTIONAL context ids the caller believes are
// current -- every one of those ids is re-verified server-side against
// real ownership by resolveOrchestratorDecision itself before ever
// influencing the response; this route never trusts them directly.
//
// Returns a validated OrchestratorDecision (never raw model/classifier
// output) -- see orchestrator-contracts.ts's own isOrchestratorDecision,
// which resolveOrchestratorDecision always runs the result through.
//
// This route NEVER calls into Video/Photo Preview/any other engine's own
// create/execute endpoints -- it only ever returns a decision describing
// where the client should navigate next. See orchestrator-action-registry.ts's
// own header comment for why that is true by construction in this stage.
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
  if (!message || message.length > MAX_MESSAGE_LENGTH) {
    return NextResponse.json(
      { error: "message is required and must be at most 2000 characters." },
      { status: 422, headers: NO_STORE_HEADERS },
    );
  }

  const currentClientId = typeof body.currentClientId === "string" ? body.currentClientId : null;
  const currentAnalysisId = typeof body.currentAnalysisId === "string" ? body.currentAnalysisId : null;
  const hasCompletedPhotoPreview = body.hasCompletedPhotoPreview === true;

  const decision = await resolveOrchestratorDecision({
    message,
    roleClass: resolveOrchestratorRoleClass(sessionUser.role),
    ownerUserId: sessionUser.id,
    currentClientId,
    currentAnalysisId,
    hasCompletedPhotoPreview,
  });

  return NextResponse.json({ decision }, { status: 200, headers: NO_STORE_HEADERS });
}
