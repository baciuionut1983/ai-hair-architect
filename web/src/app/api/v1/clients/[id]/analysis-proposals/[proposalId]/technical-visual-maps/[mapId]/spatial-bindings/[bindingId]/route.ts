import { NextResponse } from "next/server";

import { resolveOwnedClient } from "@/lib/client-repository";
import {
  TechnicalVisualMapSpatialBindingConcurrencyError,
  TechnicalVisualMapSpatialBindingDependencyError,
  TechnicalVisualMapSpatialBindingPersistenceError,
  TechnicalVisualMapSpatialBindingStateError,
  TechnicalVisualMapSpatialBindingValidationError,
  applySpatialBindingEdits,
  findSpatialBindingForOwner,
  type TechnicalVisualMapSpatialBindingRecord,
} from "@/lib/technical-visual-map-spatial-binding-repository";
import type { SpatialBindingEditOperation } from "@/lib/technical-visual-map-spatial-validators";
import { isRecord } from "@/lib/technical-visual-map-validators";
import { authenticateSessionRequest } from "@/lib/session-request-auth";

// Technical Visual Map, Stage 5B -- read one spatial binding (GET) and apply
// typed DRAFT edit operations (PATCH). Both first resolve the binding AND
// verify it belongs to THIS exact client and THIS exact map, using one
// generic "Technical Visual Map Spatial Binding not found." (404) for every
// not-found cause so a binding id can never be used as a cross-client /
// cross-map discovery oracle.

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

async function resolveOwnedBinding(
  ownerUserId: string,
  clientId: string,
  technicalVisualMapId: string,
  bindingId: string,
): Promise<TechnicalVisualMapSpatialBindingRecord | null> {
  const binding = await findSpatialBindingForOwner(ownerUserId, bindingId);
  if (!binding || binding.clientId !== clientId || binding.technicalVisualMapId !== technicalVisualMapId) return null;
  return binding;
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string; proposalId: string; mapId: string; bindingId: string }> },
) {
  const sessionUser = await authenticateSessionRequest();
  if (!sessionUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id, mapId, bindingId } = await context.params;
  const client = await resolveOwnedClient(sessionUser.id, id);
  if (client instanceof Response) return client;
  if (!client) {
    return NextResponse.json({ error: "Client not found." }, { status: 404 });
  }

  try {
    const binding = await resolveOwnedBinding(sessionUser.id, id, mapId, bindingId);
    if (!binding) {
      return NextResponse.json({ error: "Technical Visual Map Spatial Binding not found." }, { status: 404 });
    }
    return NextResponse.json({ binding }, { status: 200 });
  } catch (error) {
    return mapDomainError(error);
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string; proposalId: string; mapId: string; bindingId: string }> },
) {
  const sessionUser = await authenticateSessionRequest();
  if (!sessionUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id, mapId, bindingId } = await context.params;
  const client = await resolveOwnedClient(sessionUser.id, id);
  if (client instanceof Response) return client;
  if (!client) {
    return NextResponse.json({ error: "Client not found." }, { status: 404 });
  }

  try {
    const binding = await resolveOwnedBinding(sessionUser.id, id, mapId, bindingId);
    if (!binding) {
      return NextResponse.json({ error: "Technical Visual Map Spatial Binding not found." }, { status: 404 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
    }

    // Route-level shape check only -- each operation is validated by
    // applySpatialBindingEdits itself (isSpatialBindingEditOperation). This
    // is deliberately NOT a generic JSON-patch endpoint -- the closed
    // operation vocabulary is what makes an attempt to mutate the frozen
    // snapshot, the map/image binding, spatialVersion, schema version, or
    // status fail validation rather than a silent no-op.
    if (!isRecord(body) || !Array.isArray(body.operations) || body.operations.length === 0) {
      return NextResponse.json({ error: "operations must be a non-empty array." }, { status: 400 });
    }
    const operations = body.operations as SpatialBindingEditOperation[];

    const updated = await applySpatialBindingEdits(sessionUser.id, bindingId, operations);
    if (!updated) {
      return NextResponse.json({ error: "Technical Visual Map Spatial Binding not found." }, { status: 404 });
    }
    return NextResponse.json({ binding: updated }, { status: 200 });
  } catch (error) {
    return mapDomainError(error);
  }
}
