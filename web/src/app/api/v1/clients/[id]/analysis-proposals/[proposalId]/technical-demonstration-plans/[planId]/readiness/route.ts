import { NextResponse } from "next/server";

import { resolveOwnedClient } from "@/lib/client-repository";
import {
  TechnicalDemonstrationConcurrencyError,
  TechnicalDemonstrationDependencyError,
  TechnicalDemonstrationInvariantError,
  TechnicalDemonstrationOverrideValidationError,
  TechnicalDemonstrationPersistenceError,
  TechnicalDemonstrationStateError,
  TechnicalDemonstrationValidationError,
  findTechnicalDemonstrationPlanForOwner,
  listTechnicalDemonstrationStepsForPlan,
  resolveEffectiveCuttingStepsForRecord,
} from "@/lib/technical-demonstration-repository";
import type { TechnicalDemonstrationPlanRecord } from "@/lib/technical-demonstration-contracts";
import { evaluatePlanReadiness } from "@/lib/technical-demonstration-cutting-video-readiness";
import { authenticateSessionRequest } from "@/lib/session-request-auth";

// Technical Demonstration, Stage 2.5.c -- Technical Execution Video
// READINESS GATE, read-only. Mirrors [planId]/route.ts's own GET exactly
// (owner-scoped lookup, then explicit clientId AND analysisProposalId
// equality, same "one generic not-found for every not-found cause"
// discipline -- a plan id is never a cross-client/cross-proposal discovery
// oracle). Deliberately its OWN sub-route rather than a field folded into
// the existing GET response: readiness is a DERIVED, server-computed
// property, never a persisted column on TechnicalDemonstrationPlan (the
// Stage 2.5.c core semantic lock: CONFIRMED != VIDEO_READY) -- keeping it
// its own endpoint keeps that boundary visible in the API surface itself,
// not just in code comments.
//
// SECURITY + COST SAFETY (Stage 2.5.c's own explicit requirement): this
// route makes ZERO paid provider calls, computes readiness purely from
// already-persisted plan/step/override data, and is the ONLY authority a
// future Technical Execution Video request path may ever trust -- the
// browser can read this result, but can never assert VIDEO_READY=true on
// its own.

function mapDomainError(error: unknown): Response {
  if (error instanceof TechnicalDemonstrationDependencyError) {
    return NextResponse.json({ error: error.code, message: error.message }, { status: error.httpStatus });
  }
  if (error instanceof TechnicalDemonstrationStateError) {
    return NextResponse.json({ error: error.code, message: error.message }, { status: error.httpStatus });
  }
  if (error instanceof TechnicalDemonstrationOverrideValidationError) {
    return NextResponse.json({ error: error.code, message: error.message }, { status: error.httpStatus });
  }
  if (error instanceof TechnicalDemonstrationValidationError) {
    return NextResponse.json({ error: error.code, message: error.message }, { status: error.httpStatus });
  }
  if (error instanceof TechnicalDemonstrationConcurrencyError) {
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

async function resolveOwnedPlan(
  ownerUserId: string,
  clientId: string,
  proposalId: string,
  planId: string,
): Promise<TechnicalDemonstrationPlanRecord | null> {
  const plan = await findTechnicalDemonstrationPlanForOwner(ownerUserId, planId);
  if (!plan || plan.clientId !== clientId || plan.analysisProposalId !== proposalId) return null;
  return plan;
}

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
    const plan = await resolveOwnedPlan(sessionUser.id, id, proposalId, planId);
    if (!plan) {
      return NextResponse.json({ error: "Technical Demonstration Plan not found." }, { status: 404 });
    }

    const steps = await listTechnicalDemonstrationStepsForPlan(sessionUser.id, id, plan.id);
    const effectiveSteps = resolveEffectiveCuttingStepsForRecord(plan, steps);
    const readiness = evaluatePlanReadiness(plan, effectiveSteps);
    return NextResponse.json({ readiness }, { status: 200 });
  } catch (error) {
    return mapDomainError(error);
  }
}
