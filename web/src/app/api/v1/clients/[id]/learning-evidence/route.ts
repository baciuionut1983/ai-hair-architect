import { NextResponse } from "next/server";

import { resolveOwnedClient } from "@/lib/client-repository";
import { checkRateLimit } from "@/lib/hardening";
import {
  resolveLearningEvidenceTitle,
  resolveLearningEvidenceVertical,
  resolveSubmissionId,
  DEFAULT_LEARNING_EVIDENCE_RIGHTS_CLASSIFICATION,
} from "@/lib/learning-evidence-request-shared";
import {
  createLearningEvidence,
  isProfessionalLearningEvidencePersistenceError,
  professionalLearningEvidencePersistenceUnavailableResponse,
  ProfessionalLearningEvidenceValidationError,
} from "@/lib/professional-learning-evidence-repository";
import { authenticateSessionRequest } from "@/lib/session-request-auth";

// Professional Skill Engine, Stage 8.5L3 -- TEXT / VOICE-TRANSCRIPT
// LEARNING EVIDENCE. Client-scoped URL purely for the SAME reason
// /clients/[id]/memories already is (resolveOwnedClient proves this
// authenticated professional genuinely has an active, owned client
// context open) -- `id` is never stored on the resulting evidence row
// (Stage 8.5L2: ProfessionalLearningEvidence has no clientId at all).
// Exactly mirrors /clients/[id]/memories' own request shape (content +
// optional transcriptId) so the SAME reviewed draft the Teach-the-AI
// panel already holds can be sent to either action -- this route creates
// a DISTINCT, additive action, never a silent duplicate of a memory save
// (Stage 8.5L3 Part 4's own explicit "do not silently double-write"
// instruction; see teach-ai-panel.tsx for the two separate, explicit
// buttons this feeds).
const MAX_TEXT_LENGTH = 4000;

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await authenticateSessionRequest();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const limiter = checkRateLimit(`learning-evidence:${user.id}`, 20, 60_000);
  if (!limiter.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded." }, { status: 429 });
  }

  const { id } = await context.params;
  const client = await resolveOwnedClient(user.id, id);
  if (client instanceof Response) return client;
  if (!client) {
    return NextResponse.json({ error: "Client not found." }, { status: 404 });
  }

  const body = (await request.json()) as {
    evidenceType?: string;
    content?: string;
    transcriptId?: string;
    title?: string;
    vertical?: string;
    submissionId?: string;
  };

  if (body.evidenceType !== "TEXT" && body.evidenceType !== "VOICE_TRANSCRIPT") {
    return NextResponse.json({ error: "evidenceType must be TEXT or VOICE_TRANSCRIPT." }, { status: 400 });
  }

  const content = typeof body.content === "string" ? body.content.trim() : "";
  if (!content || content.length > MAX_TEXT_LENGTH) {
    return NextResponse.json({ error: "Invalid learning evidence request." }, { status: 400 });
  }

  const transcriptId = typeof body.transcriptId === "string" && body.transcriptId.trim() ? body.transcriptId.trim() : undefined;
  // A VOICE_TRANSCRIPT row must be genuinely reviewed voice -- see
  // teach-ai-panel.tsx: the button that calls this with
  // evidenceType="VOICE_TRANSCRIPT" is only ever enabled once a real
  // transcriptId exists from the STT flow. Enforced here too (never only
  // client-side): a request claiming VOICE_TRANSCRIPT with no
  // transcriptId is rejected outright.
  if (body.evidenceType === "VOICE_TRANSCRIPT" && !transcriptId) {
    return NextResponse.json({ error: "VOICE_TRANSCRIPT evidence requires a transcriptId." }, { status: 400 });
  }

  try {
    const evidence = await createLearningEvidence(
      user.id,
      {
        evidenceType: body.evidenceType,
        vertical: resolveLearningEvidenceVertical(body.vertical),
        title: resolveLearningEvidenceTitle(body.title),
        originalText: content,
        provenance: { channel: body.evidenceType === "VOICE_TRANSCRIPT" ? "voice" : "typed", transcriptId: transcriptId ?? null },
        rightsClassification: DEFAULT_LEARNING_EVIDENCE_RIGHTS_CLASSIFICATION,
      },
      { submissionId: resolveSubmissionId(body.submissionId) },
    );

    return NextResponse.json({ evidence }, { status: 201 });
  } catch (error) {
    if (error instanceof ProfessionalLearningEvidenceValidationError) {
      return NextResponse.json({ error: error.message }, { status: error.httpStatus });
    }
    if (isProfessionalLearningEvidencePersistenceError(error)) {
      return professionalLearningEvidencePersistenceUnavailableResponse();
    }
    throw error;
  }
}
