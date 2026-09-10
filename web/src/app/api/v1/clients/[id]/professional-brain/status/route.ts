import { NextResponse } from "next/server";

import { resolveOwnedClient } from "@/lib/client-repository";
import { authenticateSessionRequest } from "@/lib/session-request-auth";
import { ProfessionalBrainAccessError, ProfessionalBrainStateError, getPipelineStatus } from "@/lib/professional-brain-orchestrator";

// AI Hair Architect, Stage 8.5A -- PROFESSIONAL BRAIN PIPELINE STATUS,
// read-only. Reports where this client currently is in the Stage 2 -> 8
// chain, derived SOLELY from already-persisted artifacts. Makes ZERO AI
// calls and ZERO provider calls -- a GET here can never trigger reasoning
// or a render (Part L).

function mapError(error: unknown): Response {
  if (error instanceof ProfessionalBrainAccessError) {
    return NextResponse.json({ error: error.code, message: error.message }, { status: error.httpStatus });
  }
  if (error instanceof ProfessionalBrainStateError) {
    return NextResponse.json({ error: error.code, message: error.message }, { status: error.httpStatus });
  }
  throw error;
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const sessionUser = await authenticateSessionRequest();
  if (!sessionUser) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await context.params;
  const client = await resolveOwnedClient(sessionUser.id, id);
  if (client instanceof Response) return client;
  if (!client) return NextResponse.json({ error: "Client not found." }, { status: 404 });

  try {
    const status = await getPipelineStatus(sessionUser.id, id);
    return NextResponse.json({ pipelineStatus: status }, { status: 200, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return mapError(error);
  }
}
