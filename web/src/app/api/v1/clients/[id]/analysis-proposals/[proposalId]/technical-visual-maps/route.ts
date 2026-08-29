import { NextResponse } from "next/server";

import { resolveOwnedClient } from "@/lib/client-repository";
import { findProposalForOwner } from "@/lib/proposal-repository";
import { TechnicalVisualMapAssemblyError } from "@/lib/technical-visual-map-assembler";
import {
  TechnicalVisualMapConcurrencyError,
  TechnicalVisualMapDependencyError,
  TechnicalVisualMapPersistenceError,
  TechnicalVisualMapStateError,
  TechnicalVisualMapValidationError,
  createDraftFromConfirmedProposal,
  listMapsForProposal,
  resolveEffectiveMapForRecord,
  type TechnicalVisualMapRecord,
} from "@/lib/technical-visual-map-repository";
import { authenticateSessionRequest } from "@/lib/session-request-auth";

// Technical Visual Map, Stage 3 -- the owner-scoped HTTP surface over the
// already-complete Stage 2 domain layer. This file only authenticates,
// resolves ownership, calls the domain layer, and maps its typed outcomes to
// HTTP -- lifecycle rules, assembly, and concurrency comparison all live in
// technical-visual-map-repository.ts / -assembler.ts and are only called from
// here, never re-implemented.

function toMapResponse(map: TechnicalVisualMapRecord) {
  return { map, effectiveMap: resolveEffectiveMapForRecord(map) };
}

function mapDomainError(error: unknown): Response {
  if (error instanceof TechnicalVisualMapAssemblyError) {
    return NextResponse.json({ error: error.code, message: error.message }, { status: 422 });
  }
  if (error instanceof TechnicalVisualMapDependencyError) {
    return NextResponse.json({ error: error.code, message: error.message }, { status: error.httpStatus });
  }
  if (error instanceof TechnicalVisualMapStateError) {
    return NextResponse.json({ error: error.code, message: error.message }, { status: error.httpStatus });
  }
  if (error instanceof TechnicalVisualMapValidationError) {
    return NextResponse.json({ error: error.code, message: error.message }, { status: error.httpStatus });
  }
  if (error instanceof TechnicalVisualMapConcurrencyError) {
    return NextResponse.json({ error: error.code, message: error.message }, { status: error.httpStatus });
  }
  if (error instanceof TechnicalVisualMapPersistenceError) {
    return NextResponse.json(
      { error: error.code, message: error.message },
      { status: error.httpStatus, headers: { "Cache-Control": "no-store" } },
    );
  }
  throw error;
}

// GET -- version history for this exact owned (client, proposal) scope,
// newest mapVersion first. Requires the proposal to genuinely belong to this
// client, using the same generic "Proposal not found." 404 the AnalysisProposal
// read-one route uses for every not-found cause -- a proposal id can never be
// used as a cross-client / cross-owner discovery oracle.
export async function GET(_request: Request, context: { params: Promise<{ id: string; proposalId: string }> }) {
  const sessionUser = await authenticateSessionRequest();
  if (!sessionUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id, proposalId } = await context.params;
  const client = await resolveOwnedClient(sessionUser.id, id);
  if (client instanceof Response) return client;
  if (!client) {
    return NextResponse.json({ error: "Client not found." }, { status: 404 });
  }

  try {
    const proposal = await findProposalForOwner(sessionUser.id, proposalId);
    if (!proposal || proposal.clientId !== id) {
      return NextResponse.json({ error: "Proposal not found." }, { status: 404 });
    }

    const maps = await listMapsForProposal(sessionUser.id, id, proposalId, proposal.vertical);
    return NextResponse.json({ maps }, { status: 200 });
  } catch (error) {
    return mapDomainError(error);
  }
}

// POST -- create a DRAFT map assembled server-side from the exact owned
// CONFIRMED proposal identified by the URL alone. Deliberately reads NO
// request body: the only identity needed to locate the authoritative source
// proposal is already in the URL (client id + proposal id), and every other
// field (payload, schemaVersion, generatorVersion, source image ids,
// mapVersion, constraints) is derived server-side by
// technical-visual-map-assembler.ts / allocated by the repository -- there is
// structurally nothing for a caller to inject.
export async function POST(_request: Request, context: { params: Promise<{ id: string; proposalId: string }> }) {
  const sessionUser = await authenticateSessionRequest();
  if (!sessionUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id, proposalId } = await context.params;
  const client = await resolveOwnedClient(sessionUser.id, id);
  if (client instanceof Response) return client;
  if (!client) {
    return NextResponse.json({ error: "Client not found." }, { status: 404 });
  }

  try {
    const map = await createDraftFromConfirmedProposal(sessionUser.id, id, proposalId);
    return NextResponse.json(toMapResponse(map), { status: 201 });
  } catch (error) {
    return mapDomainError(error);
  }
}
