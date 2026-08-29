import { NextResponse } from "next/server";

import { resolveOwnedClient } from "@/lib/client-repository";
import { findProposalForOwner } from "@/lib/proposal-repository";
import {
  TechnicalVisualMapConcurrencyError,
  TechnicalVisualMapDependencyError,
  TechnicalVisualMapPersistenceError,
  TechnicalVisualMapStateError,
  TechnicalVisualMapValidationError,
  findCurrentConfirmedMap,
  resolveEffectiveMapForRecord,
} from "@/lib/technical-visual-map-repository";
import { authenticateSessionRequest } from "@/lib/session-request-auth";

// Technical Visual Map, Stage 3 -- the current authoritative CONFIRMED map for
// one owned (client, proposal) scope. `map` may legitimately be null (the
// scope is valid, there simply is no confirmed map yet); that is a 200, never
// a 404 -- mirrors AnalysisProposal's own current/route.ts convention exactly.
// Authority comes entirely from findCurrentConfirmedMap; this route never
// selects "latest" ad hoc. A TechnicalVisualMapInvariantError (the "more than
// one CONFIRMED" impossible state, guarded by the Stage 1 partial unique
// index) is never swallowed -- it falls through and rethrows.

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

    const map = await findCurrentConfirmedMap(sessionUser.id, id, proposalId, proposal.vertical);
    return NextResponse.json({ map, effectiveMap: map ? resolveEffectiveMapForRecord(map) : null }, { status: 200 });
  } catch (error) {
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
}
