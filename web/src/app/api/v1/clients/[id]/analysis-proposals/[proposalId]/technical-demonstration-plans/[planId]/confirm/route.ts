import { NextResponse } from "next/server";

import { resolveOwnedClient } from "@/lib/client-repository";
import {
  TechnicalDemonstrationConcurrencyError,
  TechnicalDemonstrationDependencyError,
  TechnicalDemonstrationInvariantError,
  TechnicalDemonstrationPersistenceError,
  TechnicalDemonstrationStateError,
  TechnicalDemonstrationValidationError,
  confirmTechnicalDemonstrationPlan,
  findTechnicalDemonstrationPlanForOwner,
  listTechnicalDemonstrationStepsForPlan,
} from "@/lib/technical-demonstration-repository";
import { isRecord } from "@/lib/technical-visual-map-validators";
import { authenticateSessionRequest } from "@/lib/session-request-auth";

// The stated expected-version: exactly `null` or a non-empty string. Mirrors
// technical-visual-maps/[mapId]/confirm/route.ts's own
// isExpectedConfirmedMapIdValue exactly.
function isExpectedConfirmedPlanIdValue(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && value.length > 0);
}

// Technical Demonstration, Stage 2 -- confirm a DRAFT plan. The caller MUST
// explicitly state, via `expectedCurrentConfirmedPlanId` (string or null),
// what it last observed to be the authoritative CONFIRMED plan for this
// proposal + vertical scope; the route never defaults it. All optimistic-
// concurrency comparison happens inside confirmTechnicalDemonstrationPlan --
// this route only forwards the stated expectation and maps a
// TechnicalDemonstrationConcurrencyError to a single, safe 409 that leaks
// nothing about which plan won the race. No silent retry, no automatic
// supersession on stale state -- a conflict performs zero writes and leaves
// the losing plan exactly DRAFT (server-authoritative, per Stage 2's own
// confirmation requirement).
export async function POST(
  request: Request,
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

  const plan = await findTechnicalDemonstrationPlanForOwner(sessionUser.id, planId);
  if (!plan || plan.clientId !== id || plan.analysisProposalId !== proposalId) {
    return NextResponse.json({ error: "Technical Demonstration Plan not found." }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  // The `expectedCurrentConfirmedPlanId` KEY must be present explicitly
  // (checked with `in`, so an omitted key is caught) and its value must be
  // exactly `null` or a non-empty string. Never silently defaults to null.
  if (
    !isRecord(body) ||
    !("expectedCurrentConfirmedPlanId" in body) ||
    !isExpectedConfirmedPlanIdValue(body.expectedCurrentConfirmedPlanId)
  ) {
    return NextResponse.json({ error: "expectedCurrentConfirmedPlanId (string or null) is required." }, { status: 400 });
  }
  const expectedCurrentConfirmedPlanId = body.expectedCurrentConfirmedPlanId;

  try {
    const confirmed = await confirmTechnicalDemonstrationPlan(sessionUser.id, planId, expectedCurrentConfirmedPlanId);
    if (!confirmed) {
      return NextResponse.json({ error: "Technical Demonstration Plan not found." }, { status: 404 });
    }
    const steps = await listTechnicalDemonstrationStepsForPlan(sessionUser.id, id, confirmed.id);
    return NextResponse.json({ plan: confirmed, steps }, { status: 200 });
  } catch (error) {
    if (error instanceof TechnicalDemonstrationConcurrencyError) {
      // SPECIAL CASE -- a deliberately different machine-readable code and a
      // fixed safe message, NOT the repository's own code/message. Mirrors
      // technical-visual-maps/[mapId]/confirm/route.ts's own identical
      // precedent exactly -- nothing about the winning plan is ever
      // appended.
      return NextResponse.json(
        {
          error: "TECHNICAL_DEMONSTRATION_CONFIRMATION_CONFLICT",
          message:
            "Another Technical Demonstration Plan was confirmed for this proposal while this draft was open. Review the current confirmed plan before replacing it.",
        },
        { status: 409 },
      );
    }
    if (error instanceof TechnicalDemonstrationDependencyError) {
      return NextResponse.json({ error: error.code, message: error.message }, { status: error.httpStatus });
    }
    if (error instanceof TechnicalDemonstrationStateError) {
      return NextResponse.json({ error: error.code, message: error.message }, { status: error.httpStatus });
    }
    if (error instanceof TechnicalDemonstrationValidationError) {
      return NextResponse.json({ error: error.code, message: error.message }, { status: error.httpStatus });
    }
    if (error instanceof TechnicalDemonstrationInvariantError) {
      return NextResponse.json({ error: error.code, message: error.message }, { status: error.httpStatus });
    }
    if (error instanceof TechnicalDemonstrationPersistenceError) {
      return NextResponse.json(
        { error: error.code, message: error.message },
        { status: error.httpStatus, headers: { "Cache-Control": "no-store" } },
      );
    }
    throw error;
  }
}
