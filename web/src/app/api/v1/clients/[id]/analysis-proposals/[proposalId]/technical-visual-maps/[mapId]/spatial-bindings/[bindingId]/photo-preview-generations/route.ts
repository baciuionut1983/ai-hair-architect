import { NextResponse } from "next/server";

import { resolveOwnedClient } from "@/lib/client-repository";
import {
  createPhotoPreviewGeneration,
  createPhotoPreviewGenerationVariation,
  findPhotoPreviewGenerationForOwner,
  listPhotoPreviewGenerationsForBinding,
  PhotoPreviewGenerationConcurrencyError,
  PhotoPreviewGenerationDependencyError,
  PhotoPreviewGenerationInvariantError,
  PhotoPreviewGenerationPersistenceError,
  PhotoPreviewGenerationValidationError,
} from "@/lib/photo-preview-generation-repository";
import { executePhotoPreviewGeneration } from "@/lib/photo-preview-execution-service";
import { PHOTO_PREVIEW_ALLOWED_GEMINI_MODELS, resolvePhotoPreviewProviderConfig } from "@/lib/photo-preview-provider-config";
import { findSpatialBindingForOwner, type TechnicalVisualMapSpatialBindingRecord } from "@/lib/technical-visual-map-spatial-binding-repository";
import { isRecord } from "@/lib/technical-visual-map-validators";
import { authenticateSessionRequest } from "@/lib/session-request-auth";

// Real AI Photo Preview, Stage 2 -- the owner-scoped HTTP surface over the
// Stage 1 sealed-request domain + Stage 2 execution orchestrator. Thin
// boundary only: authenticate, resolve ownership through the FULL exact
// scope named in the URL, call the domain layer, map its typed outcomes to
// HTTP -- no business rule is re-implemented here.
//
// The browser NEVER supplies a provider, a final provider prompt, or an
// arbitrary generation id chain (task §3/§5/§24's own explicit
// prohibitions) -- the only caller-supplied fields are an OPTIONAL `model`
// (validated against the fixed allowlist -- never an arbitrary string) and
// an OPTIONAL `variation` boolean. Provider is always "gemini" (the only
// value Stage 1's own repository allows today) -- never accepted as input.
//
// POST synchronously executes the newly-created (or idempotently-resolved)
// generation in the SAME request/response cycle (task §23: no unawaited
// promise after the response, no setTimeout-as-queue, no in-memory queue --
// this is the smallest correct architecture for this codebase/Railway
// today, mirroring image-analysis-processing-service.ts's own established
// queue-then-process-inline precedent exactly). The separate
// `[generationId]/execute` route exists specifically so a FUTURE external
// trigger (a real Railway cron/worker, once genuinely needed) has an exact,
// already-secured, already-tested boundary to call without any route
// changes -- see this stage's own final report for the exact deployment
// requirement that would entail.

function mapDomainError(error: unknown): Response {
  if (error instanceof PhotoPreviewGenerationDependencyError) {
    return NextResponse.json({ error: error.code, message: error.message }, { status: error.httpStatus });
  }
  if (error instanceof PhotoPreviewGenerationValidationError) {
    return NextResponse.json({ error: error.code, message: error.message }, { status: error.httpStatus });
  }
  if (error instanceof PhotoPreviewGenerationInvariantError) {
    return NextResponse.json({ error: error.code, message: error.message }, { status: error.httpStatus });
  }
  if (error instanceof PhotoPreviewGenerationConcurrencyError) {
    return NextResponse.json({ error: error.code, message: error.message }, { status: error.httpStatus });
  }
  if (error instanceof PhotoPreviewGenerationPersistenceError) {
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

// GET -- every Photo Preview generation ever created for this exact
// (client, map, spatial binding) scope, newest first -- owner-scoped, never
// leaking a foreign owner's generations.
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

  const binding = await resolveOwnedBinding(sessionUser.id, id, mapId, bindingId);
  if (!binding) {
    return NextResponse.json({ error: "Technical Visual Map Spatial Binding not found." }, { status: 404 });
  }

  try {
    const generations = await listPhotoPreviewGenerationsForBinding(sessionUser.id, id, bindingId);
    return NextResponse.json({ generations }, { status: 200 });
  } catch (error) {
    return mapDomainError(error);
  }
}

// POST -- create (or idempotently resolve) a sealed generation for this
// exact CONFIRMED spatial binding, then synchronously attempt to execute it.
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

  const binding = await resolveOwnedBinding(sessionUser.id, id, mapId, bindingId);
  if (!binding) {
    return NextResponse.json({ error: "Technical Visual Map Spatial Binding not found." }, { status: 404 });
  }

  let body: unknown = {};
  try {
    const text = await request.text();
    body = text.length > 0 ? JSON.parse(text) : {};
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  if (!isRecord(body)) {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  // `model` is optional -- absent means "use the server-configured
  // default" (task §3: "Choose an explicit configured default"). Never an
  // arbitrary caller-supplied string -- validated against the fixed
  // allowlist below, same as the repository's own independent check.
  const config = resolvePhotoPreviewProviderConfig(process.env);
  let model: string;
  if (body.model !== undefined) {
    if (typeof body.model !== "string" || !(PHOTO_PREVIEW_ALLOWED_GEMINI_MODELS as readonly string[]).includes(body.model)) {
      return NextResponse.json(
        { error: "PHOTO_PREVIEW_GENERATION_INVALID_MODEL", message: `model must be one of: ${PHOTO_PREVIEW_ALLOWED_GEMINI_MODELS.join(", ")}.` },
        { status: 422 },
      );
    }
    model = body.model;
  } else if (config.status === "enabled") {
    model = config.model;
  } else {
    // No model given and no server default configured -- there is nothing
    // valid to seal a request against yet. A clear, safe 503, never a
    // silently-invented model choice.
    return NextResponse.json(
      { error: "PHOTO_PREVIEW_CONFIGURATION_ERROR", message: "Photo Preview is not configured yet." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  const wantsVariation = body.variation === true;

  try {
    const outcome = wantsVariation
      ? await createPhotoPreviewGenerationVariation(sessionUser.id, id, bindingId, "gemini", model)
      : await createPhotoPreviewGeneration(sessionUser.id, id, bindingId, "gemini", model);

    // Synchronous execution (task §23) -- safe to call unconditionally even
    // when `outcome.created` is false (an idempotent repeat resolving to an
    // already-COMPLETED/FAILED row): the claim step is a no-op for any row
    // that is not currently eligible, so this never re-executes a
    // terminal generation.
    const executed = await executePhotoPreviewGeneration(outcome.record.id, sessionUser.id);
    // Always the LATEST persisted state, regardless of which branch
    // executePhotoPreviewGeneration returned -- never the stale
    // pre-execution snapshot from the create/resolve step above.
    const latest = await findPhotoPreviewGenerationForOwner(sessionUser.id, outcome.record.id);

    const status = outcome.created ? 201 : 200;
    return NextResponse.json({ generation: latest ?? outcome.record, executionOutcome: executed }, { status });
  } catch (error) {
    return mapDomainError(error);
  }
}
