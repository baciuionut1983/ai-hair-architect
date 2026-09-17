import { NextResponse } from "next/server";

import { checkRateLimit } from "@/lib/hardening";
import { buildCanonicalCandidateSkillRegistry } from "@/lib/professional-brain-skill-templates";
import { processEvidenceIntoDraft, ProfessionalLearningDraftServiceError } from "@/lib/professional-learning-draft-service";
import { ProfessionalLearningExtractionValidationError } from "@/lib/professional-learning-draft-extraction-validator";
import { isProfessionalLearningDraftPersistenceError, listDraftsForOwner, professionalLearningDraftPersistenceUnavailableResponse } from "@/lib/professional-learning-draft-repository";
import { isProfessionalLearningEvidencePersistenceError, professionalLearningEvidencePersistenceUnavailableResponse } from "@/lib/professional-learning-evidence-repository";
import {
  isProfessionalLearningExtractorProviderError,
  professionalLearningExtractorProviderErrorHttpStatus,
  ProfessionalLearningExtractorSelectionError,
  selectProfessionalLearningExtractor,
} from "@/lib/professional-learning-extractor-selection";
import { authenticateSessionRequest } from "@/lib/session-request-auth";
import { randomUUID } from "crypto";

// Professional Skill Engine, Stage 8.5L4 -- PROFESSIONAL LEARNING DRAFT,
// service boundary (Part 28). POST runs the full evidence -> discernment
// -> extraction -> validation -> compare-before-create pipeline. This
// route NEVER creates, updates, or activates a ProfessionalSkillDefinition
// row, regardless of the resulting comparisonOutcome -- see
// professional-learning-draft-service.ts's own header for why.
//
// Stage 8.5T1.1 -- the extractor is no longer hardcoded to the mock. It is
// resolved per-request via selectProfessionalLearningExtractor(process.env)
// (professional-learning-extractor-selection.ts): mock when real
// extraction is not explicitly enabled (the same safe default as before),
// the real Gemini adapter when it is. A misconfigured "enabled" flag, or a
// real provider failure during extraction, fails this request honestly
// (503/502/504/429 as appropriate) -- it never silently falls back to a
// mock-shaped "insufficient evidence" response that would hide the real
// failure.
export async function POST(request: Request, context: { params: Promise<{ evidenceId: string }> }) {
  const user = await authenticateSessionRequest();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const limiter = checkRateLimit(`learning-draft-process:${user.id}`, 30, 60_000);
  if (!limiter.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded." }, { status: 429 });
  }

  const { evidenceId } = await context.params;

  try {
    const extractor = selectProfessionalLearningExtractor(process.env);
    const registry = buildCanonicalCandidateSkillRegistry();
    const outcome = await processEvidenceIntoDraft({
      ownerUserId: user.id,
      evidenceId,
      draftId: randomUUID(),
      extractor,
      registry,
    });

    if (outcome.kind === "skipped") {
      return NextResponse.json({ status: "skipped", reason: outcome.reason }, { status: 200 });
    }
    return NextResponse.json({ status: outcome.kind, draft: outcome.draft }, { status: outcome.kind === "created" ? 201 : 200 });
  } catch (error) {
    if (error instanceof ProfessionalLearningExtractorSelectionError) {
      return NextResponse.json({ error: error.code, message: error.message }, { status: error.httpStatus });
    }
    if (isProfessionalLearningExtractorProviderError(error)) {
      return NextResponse.json({ error: error.code, message: error.message }, { status: professionalLearningExtractorProviderErrorHttpStatus(error) });
    }
    if (error instanceof ProfessionalLearningDraftServiceError) {
      return NextResponse.json({ error: error.code, message: error.message }, { status: error.httpStatus });
    }
    if (error instanceof ProfessionalLearningExtractionValidationError) {
      return NextResponse.json({ error: error.code, message: error.message }, { status: 502 });
    }
    if (isProfessionalLearningEvidencePersistenceError(error)) return professionalLearningEvidencePersistenceUnavailableResponse();
    if (isProfessionalLearningDraftPersistenceError(error)) return professionalLearningDraftPersistenceUnavailableResponse();
    throw error;
  }
}

export async function GET(request: Request, context: { params: Promise<{ evidenceId: string }> }) {
  const user = await authenticateSessionRequest();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { evidenceId } = await context.params;

  try {
    const drafts = await listDraftsForOwner(user.id, { sourceEvidenceId: evidenceId });
    return NextResponse.json({ drafts });
  } catch (error) {
    if (isProfessionalLearningDraftPersistenceError(error)) return professionalLearningDraftPersistenceUnavailableResponse();
    throw error;
  }
}
