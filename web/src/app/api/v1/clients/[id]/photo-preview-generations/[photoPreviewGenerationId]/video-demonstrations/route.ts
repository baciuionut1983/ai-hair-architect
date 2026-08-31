import { NextResponse } from "next/server";

import { resolveOwnedClient } from "@/lib/client-repository";
import { findPhotoPreviewGenerationForOwner } from "@/lib/photo-preview-generation-repository";
import {
  createVideoDemonstrationGeneration,
  createVideoDemonstrationGenerationVariation,
  findVideoDemonstrationGenerationForOwner,
  listVideoDemonstrationGenerationsForPhotoPreview,
  VideoDemonstrationGenerationConcurrencyError,
  VideoDemonstrationGenerationDependencyError,
  VideoDemonstrationGenerationInvariantError,
  VideoDemonstrationGenerationPersistenceError,
  VideoDemonstrationGenerationValidationError,
} from "@/lib/video-generation-repository";
import { executeVideoDemonstrationGeneration } from "@/lib/video-generation-execution-service";
import { VIDEO_DEMONSTRATION_ALLOWED_VEO_MODELS, resolveVideoDemonstrationProviderConfig } from "@/lib/video-generation-provider-config";
import { isRecord } from "@/lib/technical-visual-map-validators";
import { authenticateSessionRequest } from "@/lib/session-request-auth";

// Real AI Video Demonstration, Stage 1 -- the owner-scoped HTTP surface.
// Deliberately FLAT (mounted directly under the client, keyed only by the
// source PhotoPreviewGeneration id) rather than mirroring Photo Preview's
// own full analysis-proposal/map/spatial-binding ancestor chain in the URL
// -- Video Stage 0 Decision Lock ("client sends only photoPreviewId, server
// resolves everything"): the browser never supplies (or even knows) the
// proposal/map/binding ids for a video request, because the authority chain
// is resolved server-side from the source Photo Preview's own ALREADY
// FROZEN snapshot (video-generation-repository.ts's own resolveAuthorityChain),
// never re-derived from the live chain.
//
// The browser NEVER supplies a provider, a final provider prompt/instruction,
// or an arbitrary generation id chain -- the only caller-supplied fields are
// an OPTIONAL `model` (validated against the fixed allowlist) and an
// OPTIONAL `variation` boolean. Provider is always "google" -- never
// accepted as input.
//
// POST synchronously performs exactly ONE execution attempt (task's own
// architecture: this is a SUBMIT attempt only, bounded by the provider's
// short submit timeout -- never a wait for the full 11s-6min generation).
// The row is PROCESSING-with-operationId (or REQUESTED-again on a
// retryable submit failure, or FAILED) by the time this responds. Advancing
// a PROCESSING generation to COMPLETED is the separate
// `[generationId]/execute` route's job -- the client polls that
// repeatedly, mirroring Photo Preview's identical "separate execute
// boundary" precedent.

function mapDomainError(error: unknown): Response {
  if (error instanceof VideoDemonstrationGenerationDependencyError) {
    return NextResponse.json({ error: error.code, message: error.message }, { status: error.httpStatus });
  }
  if (error instanceof VideoDemonstrationGenerationValidationError) {
    return NextResponse.json({ error: error.code, message: error.message }, { status: error.httpStatus });
  }
  if (error instanceof VideoDemonstrationGenerationInvariantError) {
    return NextResponse.json({ error: error.code, message: error.message }, { status: error.httpStatus });
  }
  if (error instanceof VideoDemonstrationGenerationConcurrencyError) {
    return NextResponse.json({ error: error.code, message: error.message }, { status: error.httpStatus });
  }
  if (error instanceof VideoDemonstrationGenerationPersistenceError) {
    return NextResponse.json(
      { error: error.code, message: error.message },
      { status: error.httpStatus, headers: { "Cache-Control": "no-store" } },
    );
  }
  throw error;
}

// GET -- every Video Demonstration generation ever created for this exact
// (client, source Photo Preview) scope, newest first -- owner-scoped.
export async function GET(_request: Request, context: { params: Promise<{ id: string; photoPreviewGenerationId: string }> }) {
  const sessionUser = await authenticateSessionRequest();
  if (!sessionUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id, photoPreviewGenerationId } = await context.params;
  const client = await resolveOwnedClient(sessionUser.id, id);
  if (client instanceof Response) return client;
  if (!client) {
    return NextResponse.json({ error: "Client not found." }, { status: 404 });
  }

  const photoPreview = await findPhotoPreviewGenerationForOwner(sessionUser.id, photoPreviewGenerationId);
  if (!photoPreview || photoPreview.clientId !== id) {
    return NextResponse.json({ error: "Photo Preview generation not found." }, { status: 404 });
  }

  try {
    const generations = await listVideoDemonstrationGenerationsForPhotoPreview(sessionUser.id, id, photoPreviewGenerationId);
    return NextResponse.json({ generations }, { status: 200 });
  } catch (error) {
    return mapDomainError(error);
  }
}

// POST -- create (or idempotently resolve) a sealed Video Demonstration
// generation from this exact COMPLETED Photo Preview, then attempt exactly
// one submit.
export async function POST(request: Request, context: { params: Promise<{ id: string; photoPreviewGenerationId: string }> }) {
  const sessionUser = await authenticateSessionRequest();
  if (!sessionUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id, photoPreviewGenerationId } = await context.params;
  const client = await resolveOwnedClient(sessionUser.id, id);
  if (client instanceof Response) return client;
  if (!client) {
    return NextResponse.json({ error: "Client not found." }, { status: 404 });
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
  // default". Never an arbitrary caller-supplied string -- validated
  // against the fixed allowlist below, same as the repository's own
  // independent check.
  const config = resolveVideoDemonstrationProviderConfig(process.env);
  let model: string;
  if (body.model !== undefined) {
    if (typeof body.model !== "string" || !(VIDEO_DEMONSTRATION_ALLOWED_VEO_MODELS as readonly string[]).includes(body.model)) {
      return NextResponse.json(
        { error: "VIDEO_DEMONSTRATION_GENERATION_INVALID_MODEL", message: `model must be one of: ${VIDEO_DEMONSTRATION_ALLOWED_VEO_MODELS.join(", ")}.` },
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
      { error: "VIDEO_DEMONSTRATION_CONFIGURATION_ERROR", message: "Video Demonstration is not configured yet." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  const wantsVariation = body.variation === true;

  try {
    const outcome = wantsVariation
      ? await createVideoDemonstrationGenerationVariation(sessionUser.id, id, photoPreviewGenerationId, "google", model)
      : await createVideoDemonstrationGeneration(sessionUser.id, id, photoPreviewGenerationId, "google", model);

    // Exactly one execution attempt (a SUBMIT, not a wait for completion --
    // see this file's own header comment). Safe to call unconditionally
    // even when `outcome.created` is false (an idempotent repeat resolving
    // to an already-PROCESSING/COMPLETED/FAILED row): claim/poll both
    // no-op correctly for a row that is not currently eligible for their
    // respective phase.
    const executed = await executeVideoDemonstrationGeneration(outcome.record.id, sessionUser.id);
    const latest = await findVideoDemonstrationGenerationForOwner(sessionUser.id, outcome.record.id);

    const status = outcome.created ? 201 : 200;
    return NextResponse.json({ generation: latest ?? outcome.record, executionOutcome: executed }, { status });
  } catch (error) {
    return mapDomainError(error);
  }
}
