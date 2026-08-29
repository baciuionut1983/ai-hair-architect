import { NextResponse } from "next/server";

import { resolveOwnedClient } from "@/lib/client-repository";
import {
  TechnicalVisualMapConcurrencyError,
  TechnicalVisualMapDependencyError,
  TechnicalVisualMapPersistenceError,
  TechnicalVisualMapStateError,
  TechnicalVisualMapValidationError,
  applyAdjustmentsToDraft,
  findMapForOwner,
  resolveEffectiveMapForRecord,
  type TechnicalVisualMapRecord,
} from "@/lib/technical-visual-map-repository";
import { isRecord, type MapAdjustmentEntry } from "@/lib/technical-visual-map-validators";
import { authenticateSessionRequest } from "@/lib/session-request-auth";

// Technical Visual Map, Stage 3 -- read one map (GET) and apply professional
// adjustments to a DRAFT (PATCH). Both first resolve the map AND verify it
// belongs to THIS exact client and THIS exact proposal, using one generic
// "Technical Visual Map not found." (404) for every not-found cause
// (nonexistent id, foreign owner, foreign client, foreign proposal) so a map
// id can never be used as a cross-client / cross-proposal discovery oracle.

function toMapResponse(map: TechnicalVisualMapRecord) {
  return { map, effectiveMap: resolveEffectiveMapForRecord(map) };
}

function mapDomainError(error: unknown): Response {
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

async function resolveOwnedMap(
  ownerUserId: string,
  clientId: string,
  proposalId: string,
  mapId: string,
): Promise<TechnicalVisualMapRecord | null> {
  const map = await findMapForOwner(ownerUserId, mapId);
  if (!map || map.clientId !== clientId || map.analysisProposalId !== proposalId) return null;
  return map;
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string; proposalId: string; mapId: string }> },
) {
  const sessionUser = await authenticateSessionRequest();
  if (!sessionUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id, proposalId, mapId } = await context.params;
  const client = await resolveOwnedClient(sessionUser.id, id);
  if (client instanceof Response) return client;
  if (!client) {
    return NextResponse.json({ error: "Client not found." }, { status: 404 });
  }

  try {
    const map = await resolveOwnedMap(sessionUser.id, id, proposalId, mapId);
    if (!map) {
      return NextResponse.json({ error: "Technical Visual Map not found." }, { status: 404 });
    }
    return NextResponse.json(toMapResponse(map), { status: 200 });
  } catch (error) {
    return mapDomainError(error);
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string; proposalId: string; mapId: string }> },
) {
  const sessionUser = await authenticateSessionRequest();
  if (!sessionUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id, proposalId, mapId } = await context.params;
  const client = await resolveOwnedClient(sessionUser.id, id);
  if (client instanceof Response) return client;
  if (!client) {
    return NextResponse.json({ error: "Client not found." }, { status: 404 });
  }

  try {
    const map = await resolveOwnedMap(sessionUser.id, id, proposalId, mapId);
    if (!map) {
      return NextResponse.json({ error: "Technical Visual Map not found." }, { status: 404 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
    }

    // Route-level shape check only -- each adjustment entry is validated by
    // applyAdjustmentsToDraft itself (isMapAdjustmentEntry). Do not
    // hand-validate individual entries here; this is deliberately NOT a
    // generic JSON-patch endpoint -- the closed MapAdjustmentEntry union is
    // what makes an attempt to mutate a proposal-global field (or the map's
    // own baseline/version/status fields) fail validation rather than a
    // silent no-op.
    if (!isRecord(body) || !Array.isArray(body.adjustments) || body.adjustments.length === 0) {
      return NextResponse.json({ error: "adjustments must be a non-empty array." }, { status: 400 });
    }
    const adjustments = body.adjustments as MapAdjustmentEntry[];

    const updated = await applyAdjustmentsToDraft(sessionUser.id, mapId, adjustments);
    if (!updated) {
      return NextResponse.json({ error: "Technical Visual Map not found." }, { status: 404 });
    }
    return NextResponse.json(toMapResponse(updated), { status: 200 });
  } catch (error) {
    return mapDomainError(error);
  }
}
