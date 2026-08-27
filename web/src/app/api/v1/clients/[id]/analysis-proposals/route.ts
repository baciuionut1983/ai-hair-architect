import { NextResponse } from "next/server";

import {
  analysisPersistenceUnavailableResponse,
  findAnalysisForOwner,
  isAnalysisPersistenceError,
} from "@/lib/analysis-repository";
import { resolveOwnedClient } from "@/lib/client-repository";
import { assembleCuttingProposalCreationInput, ProposalAssemblyError } from "@/lib/proposal-assembler";
import {
  createProposalForOwner,
  listProposalsForOwner,
  ProposalConcurrencyError,
  ProposalDependencyError,
  ProposalPersistenceError,
  ProposalStateError,
  ProposalValidationError,
} from "@/lib/proposal-repository";
import { isProposalVertical, isRecord } from "@/lib/proposal-validators";
import { authenticateSessionRequest } from "@/lib/session-request-auth";

// AI Proposed Look (Phase 2), Stage 4 -- the owner-scoped HTTP surface over the
// already-complete Stage 2 domain layer (proposal-repository.ts) and Stage 3
// assembler (proposal-assembler.ts). This file only authenticates, validates
// input, resolves ownership, calls the domain layer, and maps its typed
// outcomes to HTTP. Lifecycle rules, concurrency comparison, and
// evidence-snapshot assembly all live in the domain layer and are only called
// from here -- never re-implemented.

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const sessionUser = await authenticateSessionRequest();

  if (!sessionUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  const client = await resolveOwnedClient(sessionUser.id, id);
  if (client instanceof Response) return client;
  if (!client) {
    return NextResponse.json({ error: "Client not found." }, { status: 404 });
  }

  const vertical = new URL(request.url).searchParams.get("vertical");
  if (!vertical || !isProposalVertical(vertical)) {
    return NextResponse.json(
      { error: "PROPOSAL_INVALID_VERTICAL", message: `"${vertical}" is not a supported proposal vertical.` },
      { status: 400 }
    );
  }

  try {
    const proposals = await listProposalsForOwner(sessionUser.id, id, vertical);
    return NextResponse.json({ proposals }, { status: 200 });
  } catch (error) {
    if (error instanceof ProposalDependencyError) {
      return NextResponse.json({ error: error.code, message: error.message }, { status: error.httpStatus });
    }
    if (error instanceof ProposalStateError) {
      return NextResponse.json({ error: error.code, message: error.message }, { status: error.httpStatus });
    }
    if (error instanceof ProposalValidationError) {
      return NextResponse.json({ error: error.code, message: error.message }, { status: error.httpStatus });
    }
    if (error instanceof ProposalConcurrencyError) {
      return NextResponse.json({ error: error.code, message: error.message }, { status: error.httpStatus });
    }
    if (error instanceof ProposalPersistenceError) {
      return NextResponse.json(
        { error: error.code, message: error.message },
        { status: error.httpStatus, headers: { "Cache-Control": "no-store" } }
      );
    }
    throw error;
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const sessionUser = await authenticateSessionRequest();

  if (!sessionUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  const client = await resolveOwnedClient(sessionUser.id, id);
  if (client instanceof Response) return client;
  if (!client) {
    return NextResponse.json({ error: "Client not found." }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  if (!isRecord(body)) {
    return NextResponse.json({ error: "analysisId and vertical are required." }, { status: 400 });
  }
  const { analysisId, vertical } = body;
  if (
    typeof analysisId !== "string" ||
    analysisId.length === 0 ||
    typeof vertical !== "string" ||
    vertical.length === 0
  ) {
    return NextResponse.json({ error: "analysisId and vertical are required." }, { status: 400 });
  }

  if (!isProposalVertical(vertical)) {
    return NextResponse.json(
      { error: "PROPOSAL_INVALID_VERTICAL", message: `"${vertical}" is not a supported proposal vertical.` },
      { status: 422 }
    );
  }

  let analysis;
  try {
    analysis = await findAnalysisForOwner(sessionUser.id, analysisId);
  } catch (error) {
    if (isAnalysisPersistenceError(error)) return analysisPersistenceUnavailableResponse();
    throw error;
  }
  if (!analysis) {
    return NextResponse.json(
      { error: "PROPOSAL_ANALYSIS_NOT_FOUND", message: "Analysis not found." },
      { status: 404 }
    );
  }

  let assembled;
  try {
    assembled = assembleCuttingProposalCreationInput(analysis);
  } catch (error) {
    if (error instanceof ProposalAssemblyError) {
      return NextResponse.json({ error: error.code, message: error.message }, { status: 422 });
    }
    throw error;
  }

  try {
    // The trailing `extras` argument is deliberately `{}`: sourceImageAssetId /
    // sourceImageAnalysisId are NEVER accepted as caller-supplied input and are
    // NEVER forwarded from the assembler here. An empty extras object lets
    // createProposalForOwner derive both, server-side, from the Analysis row it
    // loads internally.
    const proposal = await createProposalForOwner(
      sessionUser.id,
      id,
      analysisId,
      vertical,
      assembled.payload,
      assembled.evidenceSnapshot,
      assembled.engineVersion,
      {}
    );
    return NextResponse.json({ proposal }, { status: 201 });
  } catch (error) {
    if (error instanceof ProposalDependencyError) {
      return NextResponse.json({ error: error.code, message: error.message }, { status: error.httpStatus });
    }
    if (error instanceof ProposalStateError) {
      return NextResponse.json({ error: error.code, message: error.message }, { status: error.httpStatus });
    }
    if (error instanceof ProposalValidationError) {
      return NextResponse.json({ error: error.code, message: error.message }, { status: error.httpStatus });
    }
    if (error instanceof ProposalConcurrencyError) {
      return NextResponse.json({ error: error.code, message: error.message }, { status: error.httpStatus });
    }
    if (error instanceof ProposalPersistenceError) {
      return NextResponse.json(
        { error: error.code, message: error.message },
        { status: error.httpStatus, headers: { "Cache-Control": "no-store" } }
      );
    }
    throw error;
  }
}
