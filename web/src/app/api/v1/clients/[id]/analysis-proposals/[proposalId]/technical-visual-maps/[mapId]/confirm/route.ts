import { NextResponse } from "next/server";

import { resolveOwnedClient } from "@/lib/client-repository";
import {
  TechnicalVisualMapConcurrencyError,
  TechnicalVisualMapDependencyError,
  TechnicalVisualMapPersistenceError,
  TechnicalVisualMapStateError,
  TechnicalVisualMapValidationError,
  confirmDraftMap,
  findMapForOwner,
  resolveEffectiveMapForRecord,
} from "@/lib/technical-visual-map-repository";
import { isRecord } from "@/lib/technical-visual-map-validators";
import { authenticateSessionRequest } from "@/lib/session-request-auth";

// The stated expected-version: exactly `null` or a non-empty string. An empty
// string, a number, an object, a boolean, or `undefined` are all rejected.
function isExpectedConfirmedMapIdValue(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && value.length > 0);
}

// Technical Visual Map, Stage 3 -- confirm a DRAFT map. The caller MUST
// explicitly state, via `expectedCurrentConfirmedMapId` (string or null), what
// it last observed to be the authoritative CONFIRMED map for this proposal +
// vertical scope; the route never defaults it. All optimistic-concurrency
// comparison happens inside confirmDraftMap -- this route only forwards the
// stated expectation and maps a TechnicalVisualMapConcurrencyError to a
// single, safe 409 that leaks nothing about which map won the race. No
// silent retry, no automatic supersession on stale state -- a conflict
// performs zero writes and leaves the losing map exactly DRAFT.

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

  const map = await findMapForOwner(sessionUser.id, mapId);
  if (!map || map.clientId !== id || map.analysisProposalId !== proposalId) {
    return NextResponse.json({ error: "Technical Visual Map not found." }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  // The `expectedCurrentConfirmedMapId` KEY must be present explicitly
  // (checked with `in`, so an omitted key is caught) and its value must be
  // exactly `null` or a non-empty string. Anything else -- key missing,
  // number, object, empty string, undefined -- is a 400. Never silently
  // default to null.
  if (
    !isRecord(body) ||
    !("expectedCurrentConfirmedMapId" in body) ||
    !isExpectedConfirmedMapIdValue(body.expectedCurrentConfirmedMapId)
  ) {
    return NextResponse.json({ error: "expectedCurrentConfirmedMapId (string or null) is required." }, { status: 400 });
  }
  const expectedCurrentConfirmedMapId = body.expectedCurrentConfirmedMapId;

  try {
    const confirmed = await confirmDraftMap(sessionUser.id, mapId, expectedCurrentConfirmedMapId);
    if (!confirmed) {
      return NextResponse.json({ error: "Technical Visual Map not found." }, { status: 404 });
    }
    return NextResponse.json({ map: confirmed, effectiveMap: resolveEffectiveMapForRecord(confirmed) }, { status: 200 });
  } catch (error) {
    if (error instanceof TechnicalVisualMapConcurrencyError) {
      // SPECIAL CASE -- a deliberately different machine-readable code and a
      // fixed safe message, NOT the repository's own code/message. The text
      // below is complete and final; nothing about the winning map is ever
      // appended.
      return NextResponse.json(
        {
          error: "TECHNICAL_VISUAL_MAP_CONFIRMATION_CONFLICT",
          message:
            "Another map was confirmed for this proposal while this draft was open. Review the current confirmed map before replacing it.",
        },
        { status: 409 },
      );
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
    if (error instanceof TechnicalVisualMapPersistenceError) {
      return NextResponse.json(
        { error: error.code, message: error.message },
        { status: error.httpStatus, headers: { "Cache-Control": "no-store" } },
      );
    }
    throw error;
  }
}
