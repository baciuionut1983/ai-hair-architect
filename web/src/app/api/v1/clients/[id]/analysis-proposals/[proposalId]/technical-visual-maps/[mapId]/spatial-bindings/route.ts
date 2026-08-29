import { NextResponse } from "next/server";

import { resolveOwnedClient } from "@/lib/client-repository";
import { findMapForOwner } from "@/lib/technical-visual-map-repository";
import {
  TechnicalVisualMapSpatialBindingConcurrencyError,
  TechnicalVisualMapSpatialBindingDependencyError,
  TechnicalVisualMapSpatialBindingPersistenceError,
  TechnicalVisualMapSpatialBindingStateError,
  TechnicalVisualMapSpatialBindingValidationError,
  createDraftSpatialBinding,
  listSpatialBindingsForMap,
} from "@/lib/technical-visual-map-spatial-binding-repository";
import { isRecord } from "@/lib/technical-visual-map-validators";
import { authenticateSessionRequest } from "@/lib/session-request-auth";

// Technical Visual Map, Stage 5B -- the owner-scoped HTTP surface over the
// Stage 5B spatial-binding domain/repository layer. Thin boundary only:
// authenticate, resolve ownership, call the domain layer, map its typed
// outcomes to HTTP -- no business rule is re-implemented here.

function mapDomainError(error: unknown): Response {
  if (error instanceof TechnicalVisualMapSpatialBindingDependencyError) {
    return NextResponse.json({ error: error.code, message: error.message }, { status: error.httpStatus });
  }
  if (error instanceof TechnicalVisualMapSpatialBindingStateError) {
    return NextResponse.json({ error: error.code, message: error.message }, { status: error.httpStatus });
  }
  if (error instanceof TechnicalVisualMapSpatialBindingValidationError) {
    return NextResponse.json({ error: error.code, message: error.message }, { status: error.httpStatus });
  }
  if (error instanceof TechnicalVisualMapSpatialBindingConcurrencyError) {
    return NextResponse.json({ error: error.code, message: error.message }, { status: error.httpStatus });
  }
  if (error instanceof TechnicalVisualMapSpatialBindingPersistenceError) {
    return NextResponse.json(
      { error: error.code, message: error.message },
      { status: error.httpStatus, headers: { "Cache-Control": "no-store" } },
    );
  }
  throw error;
}

async function resolveOwnedMap(sessionUserId: string, clientId: string, proposalId: string, mapId: string) {
  const map = await findMapForOwner(sessionUserId, mapId);
  if (!map || map.clientId !== clientId || map.analysisProposalId !== proposalId) return null;
  return map;
}

// GET -- full spatial-binding history for this exact owned map, across every
// source image and view. Ordering/authority all come from the repository.
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

  const map = await resolveOwnedMap(sessionUser.id, id, proposalId, mapId);
  if (!map) {
    return NextResponse.json({ error: "Technical Visual Map not found." }, { status: 404 });
  }

  try {
    const bindings = await listSpatialBindingsForMap(sessionUser.id, id, mapId);
    return NextResponse.json({ bindings }, { status: 200 });
  } catch (error) {
    return mapDomainError(error);
  }
}

// POST -- create a DRAFT spatial binding. Accepts ONLY the minimum legitimate
// user choice: sourceImageAssetId + viewLabel. Deliberately reads no other
// field -- payload, frozen snapshot, version, schema version, status,
// ownerUserId, clientId are all derived/allocated server-side by the
// repository; there is structurally nothing else for a caller to inject.
// sourceImageAnalysisId is intentionally NOT accepted in Stage 5B (see the
// Stage 5B report's own "Source Image Analysis" section) -- no legitimate
// use for it yet, so the input surface is not widened to accept it.
export async function POST(
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

  if (
    !isRecord(body) ||
    typeof body.sourceImageAssetId !== "string" ||
    body.sourceImageAssetId.length === 0 ||
    typeof body.viewLabel !== "string" ||
    body.viewLabel.length === 0
  ) {
    return NextResponse.json({ error: "sourceImageAssetId and viewLabel are required." }, { status: 400 });
  }
  const { sourceImageAssetId, viewLabel } = body;

  try {
    const binding = await createDraftSpatialBinding(sessionUser.id, id, mapId, sourceImageAssetId, viewLabel);
    return NextResponse.json({ binding }, { status: 201 });
  } catch (error) {
    return mapDomainError(error);
  }
}
