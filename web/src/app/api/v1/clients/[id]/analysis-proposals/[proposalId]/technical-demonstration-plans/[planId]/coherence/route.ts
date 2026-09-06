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
import { evaluatePlanCoherence, TECHNICAL_DEMONSTRATION_COHERENCE_RULES_VERSION, type CoherenceEvaluation } from "@/lib/technical-demonstration-cutting-coherence";
import { authenticateSessionRequest } from "@/lib/session-request-auth";

// Technical Demonstration, Stage 2.5.g.2 -- Professional Coherence,
// READ-ONLY VISIBILITY. Mirrors the sibling readiness/route.ts exactly
// (same owner-scoped lookup, same clientId/analysisProposalId equality
// checks, same "one generic not-found for every not-found cause"
// discipline, same error mapping, same no-store 503 on persistence
// failure) -- the two engines are deliberately kept as separate endpoints,
// never merged into one response, exactly as the Stage 2.5.g decision lock
// requires (readiness = completeness; coherence = structural consistency).
//
// VISIBILITY ONLY (Stage 2.5.g.2's own explicit scope): this route computes
// and returns the coherence result for the EXACT plan identified by
// planId -- it never blocks, mutates, or influences confirm/readiness/
// VIDEO_READY in any way. Confirming a plan with real coherence blockers
// still succeeds today; enforcement is explicitly a LATER, separately
// authorized stage.
//
// SECURITY + COST SAFETY: zero paid provider calls, computed purely from
// already-persisted plan/step/override data -- identical safety posture to
// the readiness route.

export interface TechnicalDemonstrationCoherenceResponse extends CoherenceEvaluation {
  planId: string;
  planVersion: number;
  coherenceRulesVersion: string;
}

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
    const evaluation = evaluatePlanCoherence(effectiveSteps);
    const coherence: TechnicalDemonstrationCoherenceResponse = {
      planId: plan.id,
      planVersion: plan.planVersion,
      coherenceRulesVersion: TECHNICAL_DEMONSTRATION_COHERENCE_RULES_VERSION,
      ...evaluation,
    };
    return NextResponse.json({ coherence }, { status: 200 });
  } catch (error) {
    return mapDomainError(error);
  }
}
