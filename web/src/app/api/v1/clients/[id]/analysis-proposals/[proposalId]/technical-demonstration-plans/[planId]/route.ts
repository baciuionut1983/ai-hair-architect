import { NextResponse } from "next/server";

import { resolveOwnedClient } from "@/lib/client-repository";
import {
  TechnicalDemonstrationPersistenceError,
  findTechnicalDemonstrationPlanForOwner,
  listTechnicalDemonstrationStepsForPlan,
} from "@/lib/technical-demonstration-repository";
import { authenticateSessionRequest } from "@/lib/session-request-auth";

// Technical Demonstration, Stage 2 -- one specific, owned plan (any status)
// plus its ordered steps. Used by the UI to resume reviewing an existing
// DRAFT plan found via the history list (which only ever returns bare
// metadata, no steps -- see technical-demonstration-plans/route.ts's own GET
// header comment). Owner-scoped lookup, then an explicit clientId AND
// analysisProposalId equality check -- never assuming transitive trust,
// mirrors technical-visual-maps/[mapId]/confirm/route.ts's own identical
// pattern: a real plan id belonging to a DIFFERENT client or a DIFFERENT
// proposal of the SAME owner must never resolve here.
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string; proposalId: string; planId: string }> },
) {
  const sessionUser = await authenticateSessionRequest();
  if (!sessionUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id, proposalId, planId } = await context.params;
  const client = await resolveOwnedClient(sessionUser.id, id);
  if (client instanceof Response) return client;
  if (!client) {
    return NextResponse.json({ error: "Client not found." }, { status: 404 });
  }

  try {
    const plan = await findTechnicalDemonstrationPlanForOwner(sessionUser.id, planId);
    if (!plan || plan.clientId !== id || plan.analysisProposalId !== proposalId) {
      return NextResponse.json({ error: "Technical Demonstration Plan not found." }, { status: 404 });
    }

    const steps = await listTechnicalDemonstrationStepsForPlan(sessionUser.id, id, plan.id);
    return NextResponse.json({ plan, steps }, { status: 200 });
  } catch (error) {
    if (error instanceof TechnicalDemonstrationPersistenceError) {
      return NextResponse.json(
        { error: error.code, message: error.message },
        { status: error.httpStatus, headers: { "Cache-Control": "no-store" } },
      );
    }
    throw error;
  }
}
