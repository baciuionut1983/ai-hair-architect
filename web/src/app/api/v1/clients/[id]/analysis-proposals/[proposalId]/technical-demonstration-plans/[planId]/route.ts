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
  applyOverridesToDraft,
  findTechnicalDemonstrationPlanForOwner,
  listTechnicalDemonstrationStepsForPlan,
  resolveEffectiveCuttingStepsForRecord,
} from "@/lib/technical-demonstration-repository";
import type { TechnicalDemonstrationPlanRecord } from "@/lib/technical-demonstration-contracts";
import { isCuttingStepOverrideInput, type CuttingStepOverrideInput } from "@/lib/technical-demonstration-cutting-overrides";
import { isRecord } from "@/lib/technical-visual-map-validators";
import { authenticateSessionRequest } from "@/lib/session-request-auth";

// Technical Demonstration, Stage 2 (GET) + Stage 2.5.b (PATCH) -- one
// specific, owned plan (any status) plus its ordered steps (baseline AND
// effective, the latter resolved server-side via
// resolveEffectiveCuttingStepsForRecord -- the UI never re-implements the
// override merge itself). Owner-scoped lookup, then an explicit clientId
// AND analysisProposalId equality check -- never assuming transitive trust,
// same "one generic not-found for every not-found cause" discipline
// technical-visual-maps/[mapId]/route.ts already established: a plan id can
// never be used as a cross-client / cross-proposal discovery oracle.

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
    return NextResponse.json({ plan, steps, effectiveSteps }, { status: 200 });
  } catch (error) {
    return mapDomainError(error);
  }
}

// PATCH -- append professional overrides to a DRAFT plan (Stage 2.5.b).
// Legal only while the plan is DRAFT (applyOverridesToDraft's own guard);
// a CONFIRMED/SUPERSEDED plan rejects with a 409 illegal-state-transition,
// never silently reopened. Route-level shape check only ("overrides must
// be a non-empty array of structurally plausible entries") -- each entry's
// real validation (field vocabulary, value shape, stepNumber existence) is
// applyOverridesToDraft's own job, mirroring
// technical-visual-maps/[mapId]/route.ts's own identical PATCH discipline
// exactly. `source`/`setAt` are never read from the request body at all --
// structurally impossible to inject, since CuttingStepOverrideInput (the
// only shape this route ever forwards) has no such fields; the repository
// stamps both server-side.
export async function PATCH(
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

  try {
    const plan = await resolveOwnedPlan(sessionUser.id, id, proposalId, planId);
    if (!plan) {
      return NextResponse.json({ error: "Technical Demonstration Plan not found." }, { status: 404 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
    }

    if (!isRecord(body) || !Array.isArray(body.overrides) || body.overrides.length === 0) {
      return NextResponse.json({ error: "overrides must be a non-empty array." }, { status: 400 });
    }
    // Route-level shape gate only -- structurally impossible to smuggle a
    // caller-authored `source`/`setAt` through (CuttingStepOverrideInput
    // has no such fields); a malformed entry here is still safely rejected
    // by applyOverridesToDraft's own real validation below, never trusted
    // blindly.
    if (!body.overrides.every(isCuttingStepOverrideInput)) {
      return NextResponse.json({ error: "One or more overrides are not structurally valid." }, { status: 400 });
    }
    const overrides = body.overrides as CuttingStepOverrideInput[];

    const updated = await applyOverridesToDraft(sessionUser.id, id, planId, overrides);
    if (!updated) {
      return NextResponse.json({ error: "Technical Demonstration Plan not found." }, { status: 404 });
    }
    const steps = await listTechnicalDemonstrationStepsForPlan(sessionUser.id, id, updated.id);
    const effectiveSteps = resolveEffectiveCuttingStepsForRecord(updated, steps);
    return NextResponse.json({ plan: updated, steps, effectiveSteps }, { status: 200 });
  } catch (error) {
    return mapDomainError(error);
  }
}
