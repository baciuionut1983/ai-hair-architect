import { NextResponse } from "next/server";

import { resolveOwnedClient } from "@/lib/client-repository";
import {
  findCurrentConfirmedProposal,
  ProposalConcurrencyError,
  ProposalDependencyError,
  ProposalPersistenceError,
  ProposalStateError,
  ProposalValidationError,
} from "@/lib/proposal-repository";
import { isProposalVertical } from "@/lib/proposal-validators";
import { authenticateSessionRequest } from "@/lib/session-request-auth";

// AI Proposed Look (Phase 2), Stage 4 -- the current authoritative CONFIRMED
// proposal for one client + vertical. `proposal` may legitimately be null (the
// scope is valid, there simply is no confirmed proposal yet); that is a 200,
// never a 404. A ProposalInvariantError (the "more than one CONFIRMED" impossible
// state) is never swallowed -- it falls through the generic chain and rethrows.

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
    const proposal = await findCurrentConfirmedProposal(sessionUser.id, id, vertical);
    return NextResponse.json({ proposal }, { status: 200 });
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
