import { NextResponse } from "next/server";

import { resolveOwnedClient } from "@/lib/client-repository";
import { findMapForOwner } from "@/lib/technical-visual-map-repository";
import {
  TechnicalVisualMapSpatialBindingConcurrencyError,
  TechnicalVisualMapSpatialBindingDependencyError,
  TechnicalVisualMapSpatialBindingPersistenceError,
  TechnicalVisualMapSpatialBindingStateError,
  TechnicalVisualMapSpatialBindingValidationError,
  findCurrentConfirmedSpatialBinding,
} from "@/lib/technical-visual-map-spatial-binding-repository";
import { isViewLabel } from "@/lib/technical-visual-map-spatial-validators";
import { authenticateSessionRequest } from "@/lib/session-request-auth";

// Technical Visual Map, Stage 5B -- the current authoritative CONFIRMED
// spatial binding for one exact owned (map, source image, view) scope.
// `binding` may legitimately be null (the scope is valid, there simply is no
// confirmed binding yet); that is a 200, never a 404 -- mirrors
// TechnicalVisualMap's own current/route.ts convention exactly. Authority
// comes ENTIRELY from findCurrentConfirmedSpatialBinding; this route never
// selects "latest" ad hoc. A TechnicalVisualMapSpatialBindingInvariantError
// (the "more than one CONFIRMED" impossible state) is never swallowed.

export async function GET(
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

  const map = await findMapForOwner(sessionUser.id, mapId);
  if (!map || map.clientId !== id || map.analysisProposalId !== proposalId) {
    return NextResponse.json({ error: "Technical Visual Map not found." }, { status: 404 });
  }

  const url = new URL(request.url);
  const sourceImageAssetId = url.searchParams.get("sourceImageAssetId");
  const viewLabel = url.searchParams.get("viewLabel");
  if (!sourceImageAssetId) {
    return NextResponse.json({ error: "sourceImageAssetId query parameter is required." }, { status: 400 });
  }
  if (!viewLabel || !isViewLabel(viewLabel)) {
    return NextResponse.json(
      { error: "TECHNICAL_VISUAL_MAP_SPATIAL_BINDING_INVALID_VIEW_LABEL", message: `"${viewLabel}" is not a supported view label.` },
      { status: 400 },
    );
  }

  try {
    const binding = await findCurrentConfirmedSpatialBinding(sessionUser.id, id, mapId, sourceImageAssetId, viewLabel);
    return NextResponse.json({ binding }, { status: 200 });
  } catch (error) {
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
}
