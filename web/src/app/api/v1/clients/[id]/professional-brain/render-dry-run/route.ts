import { NextResponse } from "next/server";

import { resolveOwnedClient } from "@/lib/client-repository";
import { isRecord } from "@/lib/proposal-validators";
import { authenticateSessionRequest } from "@/lib/session-request-auth";
import { ProfessionalBrainAccessError, ProfessionalBrainStateError } from "@/lib/professional-brain-orchestrator";
import { professionalBrainRenderDryRun } from "@/lib/professional-brain-dry-run";

// AI Hair Architect, Stage 8.5A -- PRE-RENDER DRY RUN, POST. Composes the
// full pre-render diagnostic for one scene: pipeline status, per-scene
// Render Readiness, provider config PRESENT/MISSING, provider instruction
// fingerprint, "request would be allowed YES/NO", and every blocker.
//
// THIS ROUTE NEVER SENDS A PROVIDER REQUEST. It creates no generation
// job, no providerOperationId, and performs no polling. `providerRequestSent`
// in the response is always false. No secret is read or logged (only
// PRESENT/MISSING).

function mapError(error: unknown): Response {
  if (error instanceof ProfessionalBrainAccessError) {
    return NextResponse.json({ error: error.code, message: error.message }, { status: error.httpStatus });
  }
  if (error instanceof ProfessionalBrainStateError) {
    return NextResponse.json({ error: error.code, message: error.message }, { status: error.httpStatus });
  }
  throw error;
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const sessionUser = await authenticateSessionRequest();
  if (!sessionUser) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await context.params;
  const client = await resolveOwnedClient(sessionUser.id, id);
  if (client instanceof Response) return client;
  if (!client) return NextResponse.json({ error: "Client not found." }, { status: 404 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  if (!isRecord(body) || typeof body.sceneId !== "string" || body.sceneId.length === 0) {
    return NextResponse.json({ error: "A non-empty `sceneId` string is required." }, { status: 400 });
  }

  try {
    const result = await professionalBrainRenderDryRun(sessionUser.id, id, body.sceneId, process.env);
    return NextResponse.json({ dryRun: result }, { status: 200, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return mapError(error);
  }
}
