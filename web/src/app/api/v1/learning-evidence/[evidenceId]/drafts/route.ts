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
import { buildProceduralInterpretation } from "@/lib/professional-learning-video-temporal-to-procedural-adapter";
import { randomUUID } from "crypto";
import { hydrateProceduralDraft } from "@/lib/professional-learning-procedural-read";

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
  // Stage 8.5T1.2.R1 -- EXPLICIT REANALYSIS SEMANTICS. The only value this
  // route ever trusts from the caller here is a closed-set mode flag --
  // never an arbitrary "force" bypass. Anything other than the literal
  // string "REANALYZE" (missing body, malformed JSON, an invalid value)
  // fails safe to the existing, unchanged "ANALYZE" default; the caller
  // cannot use this to skip authentication/ownership/evidence validation,
  // all of which still run exactly as before inside processEvidenceIntoDraft.
  const body = (await request.json().catch(() => null)) as { mode?: unknown } | null;
  const mode = body?.mode === "REANALYZE" ? "REANALYZE" : "ANALYZE";

  try {
    const extractor = selectProfessionalLearningExtractor(process.env);
    const registry = buildCanonicalCandidateSkillRegistry();
    const outcome = await processEvidenceIntoDraft({
      ownerUserId: user.id,
      evidenceId,
      draftId: randomUUID(),
      extractor,
      registry,
      mode,
    });

    if (outcome.kind === "skipped") {
      return NextResponse.json({ status: "skipped", reason: outcome.reason }, { status: 200 });
    }
    // Stage 8.5T1.4.a -- TEMPORAL EVIDENCE -> PROCEDURAL INTERPRETATION.
    // Computed at response time ONLY, never persisted: a pure, read-only,
    // INFERRED-authority derivation over this exact draft's own already-
    // persisted temporalEvidence, reusing the existing (previously
    // dormant) procedural reasoning engine verbatim. Absent (null) is
    // the honest result whenever there is no derivable action sequence.
    const proceduralInterpretation = buildProceduralInterpretation(outcome.draft.id, outcome.draft.temporalEvidence);
    return NextResponse.json({ status: outcome.kind, draft: { ...outcome.draft, proceduralInterpretation } }, { status: outcome.kind === "created" ? 201 : 200 });
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
    return NextResponse.json({ drafts: drafts.map(hydrateProceduralDraft) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (isProfessionalLearningDraftPersistenceError(error)) return professionalLearningDraftPersistenceUnavailableResponse();
    throw error;
  }
}
