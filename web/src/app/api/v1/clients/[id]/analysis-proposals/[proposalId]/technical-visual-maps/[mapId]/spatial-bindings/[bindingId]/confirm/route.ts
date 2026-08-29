import { NextResponse } from "next/server";

import { resolveOwnedClient } from "@/lib/client-repository";
import {
  TechnicalVisualMapSpatialBindingConcurrencyError,
  TechnicalVisualMapSpatialBindingDependencyError,
  TechnicalVisualMapSpatialBindingPersistenceError,
  TechnicalVisualMapSpatialBindingStateError,
  TechnicalVisualMapSpatialBindingValidationError,
  confirmSpatialBinding,
  findSpatialBindingForOwner,
} from "@/lib/technical-visual-map-spatial-binding-repository";
import { isRecord } from "@/lib/technical-visual-map-validators";
import { authenticateSessionRequest } from "@/lib/session-request-auth";

// The stated expected-version: exactly `null` or a non-empty string.
function isExpectedConfirmedSpatialBindingIdValue(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && value.length > 0);
}

// Technical Visual Map, Stage 5B -- confirm a DRAFT spatial binding. The
// caller MUST explicitly state, via `expectedCurrentConfirmedSpatialBindingId`
// (string or null), what it last observed to be the authoritative CONFIRMED
// binding for this exact (map, source image, view) scope; the route never
// defaults it. All optimistic-concurrency comparison, and the parent-map-
// eligibility re-check, happen inside confirmSpatialBinding -- this route
// only forwards the stated expectation and maps a
// TechnicalVisualMapSpatialBindingConcurrencyError to a single, safe,
// dedicated 409 that leaks nothing about which binding won the race.

export async function POST(
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

  const binding = await findSpatialBindingForOwner(sessionUser.id, bindingId);
  if (!binding || binding.clientId !== id || binding.technicalVisualMapId !== mapId) {
    return NextResponse.json({ error: "Technical Visual Map Spatial Binding not found." }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  if (
    !isRecord(body) ||
    !("expectedCurrentConfirmedSpatialBindingId" in body) ||
    !isExpectedConfirmedSpatialBindingIdValue(body.expectedCurrentConfirmedSpatialBindingId)
  ) {
    return NextResponse.json(
      { error: "expectedCurrentConfirmedSpatialBindingId (string or null) is required." },
      { status: 400 },
    );
  }
  const expectedCurrentConfirmedSpatialBindingId = body.expectedCurrentConfirmedSpatialBindingId;

  try {
    const confirmed = await confirmSpatialBinding(sessionUser.id, bindingId, expectedCurrentConfirmedSpatialBindingId);
    if (!confirmed) {
      return NextResponse.json({ error: "Technical Visual Map Spatial Binding not found." }, { status: 404 });
    }
    return NextResponse.json({ binding: confirmed }, { status: 200 });
  } catch (error) {
    if (error instanceof TechnicalVisualMapSpatialBindingConcurrencyError) {
      // SPECIAL CASE -- a deliberately different, stable, machine-readable
      // code and a fixed safe message, NOT the repository's own code/
      // message. Nothing about the winning binding is ever appended.
      return NextResponse.json(
        {
          error: "TECHNICAL_VISUAL_MAP_SPATIAL_BINDING_CONFIRMATION_CONFLICT",
          message:
            "Another spatial binding was confirmed for this image and view while this draft was open. Review the current confirmed binding before replacing it.",
        },
        { status: 409 },
      );
    }
    if (error instanceof TechnicalVisualMapSpatialBindingDependencyError) {
      return NextResponse.json({ error: error.code, message: error.message }, { status: error.httpStatus });
    }
    if (error instanceof TechnicalVisualMapSpatialBindingStateError) {
      return NextResponse.json({ error: error.code, message: error.message }, { status: error.httpStatus });
    }
    if (error instanceof TechnicalVisualMapSpatialBindingValidationError) {
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
