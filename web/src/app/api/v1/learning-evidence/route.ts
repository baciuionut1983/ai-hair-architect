import { NextResponse } from "next/server";

import {
  isProfessionalLearningEvidencePersistenceError,
  listLearningEvidenceForOwner,
  professionalLearningEvidencePersistenceUnavailableResponse,
  revokeLearningEvidence,
  type ListLearningEvidenceFilter,
} from "@/lib/professional-learning-evidence-repository";
import { isProfessionalLearningEvidenceStatus, isProfessionalLearningEvidenceType } from "@/lib/professional-learning-evidence-validators";
import { authenticateSessionRequest } from "@/lib/session-request-auth";

// Professional Skill Engine, Stage 8.5L3 -- LEARNING EVIDENCE LIBRARY
// (task Part 17: "a minimal way ... to see recently submitted learning
// evidence"), top-level rather than client-scoped -- evidence itself has
// no clientId (Stage 8.5L2) and listing/revoking it needs no client
// context at all, unlike the 4 create routes which upload through
// client-scoped canonical asset infrastructure. Owner is ALWAYS derived
// from the authenticated session (task Part 18) -- never accepted from
// the client, and every underlying repository call is itself owner-
// scoped in its own WHERE clause (fail-closed by construction, not by
// this route's own diligence alone).

export async function GET(request: Request) {
  const user = await authenticateSessionRequest();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const evidenceTypeParam = url.searchParams.get("evidenceType");
  const statusParam = url.searchParams.get("status");

  const filter: ListLearningEvidenceFilter = {
    ...(evidenceTypeParam && isProfessionalLearningEvidenceType(evidenceTypeParam) ? { evidenceType: evidenceTypeParam } : {}),
    ...(statusParam && isProfessionalLearningEvidenceStatus(statusParam) ? { status: statusParam } : {}),
  };

  try {
    const evidence = await listLearningEvidenceForOwner(user.id, filter);
    return NextResponse.json({ evidence });
  } catch (error) {
    if (isProfessionalLearningEvidencePersistenceError(error)) {
      return professionalLearningEvidencePersistenceUnavailableResponse();
    }
    throw error;
  }
}

// REVOKE only (task Part 17/18): never physically deletes source media
// from this route -- see professional-learning-evidence-repository.ts's
// own revokeLearningEvidence, a soft ACTIVE->REVOKED transition only.
export async function DELETE(request: Request) {
  const user = await authenticateSessionRequest();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const evidenceId = new URL(request.url).searchParams.get("evidenceId");
  if (!evidenceId) {
    return NextResponse.json({ error: "evidenceId is required." }, { status: 400 });
  }

  try {
    const revoked = await revokeLearningEvidence(user.id, evidenceId);
    return revoked ? NextResponse.json({ revoked: true }) : NextResponse.json({ error: "Learning evidence not found." }, { status: 404 });
  } catch (error) {
    if (isProfessionalLearningEvidencePersistenceError(error)) {
      return professionalLearningEvidencePersistenceUnavailableResponse();
    }
    throw error;
  }
}
