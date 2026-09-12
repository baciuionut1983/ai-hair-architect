import { NextResponse } from "next/server";

import { resolveOwnedClient } from "@/lib/client-repository";
import { checkRateLimit } from "@/lib/hardening";
import { ObjectStorageWriteModeRequiredError } from "@/lib/image-analysis-service";
import { LearningEvidenceImageMagicBytesError, LearningEvidenceImageValidationError, uploadLearningEvidenceImageAssets } from "@/lib/learning-evidence-image-upload";
import {
  resolveLearningEvidenceTitle,
  resolveLearningEvidenceVertical,
  resolveSubmissionId,
  DEFAULT_LEARNING_EVIDENCE_RIGHTS_CLASSIFICATION,
} from "@/lib/learning-evidence-request-shared";
import {
  createLearningEvidence,
  findLearningEvidenceForOwner,
  isProfessionalLearningEvidencePersistenceError,
  professionalLearningEvidencePersistenceUnavailableResponse,
  ProfessionalLearningEvidenceValidationError,
} from "@/lib/professional-learning-evidence-repository";
import { authenticateSessionRequest } from "@/lib/session-request-auth";

// Professional Skill Engine, Stage 8.5L3 -- SINGLE IMAGE / DIAGRAM
// LEARNING EVIDENCE. Uploads exactly one file through the canonical
// ImageAsset pipeline (learning-evidence-image-upload.ts -- reuses
// existing validation/storage, creates NO ImageAnalysis row), then links
// it as a ProfessionalLearningEvidence(IMAGE|DIAGRAM) row. `evidenceType`
// form field defaults to IMAGE; DIAGRAM is the only other accepted value
// for this endpoint (task Part 8: "Technical graphics may use the
// PHOTO/IMAGE ingestion surface if that is the cleanest UX" -- one more
// route just for diagrams would be unnecessary complexity).
//
// TRANSACTIONAL CONSISTENCY (Part 12): the ImageAsset is created FIRST,
// then the evidence row. If evidence creation fails after a successful
// upload, the ImageAsset is left in place (never deleted here) --
// recoverable by a retry with the SAME submissionId (idempotent: see
// createLearningEvidence's own submissionId handling) or, if truly
// abandoned, by the EXISTING ImageAsset retention lifecycle (an
// unreferenced ImageAsset is never force-purged automatically; a
// professional would soft-delete it like any other photo). Never
// physically deletes an asset from this route under any failure path.
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await authenticateSessionRequest();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const limiter = checkRateLimit(`learning-evidence-upload:${user.id}`, 20, 60_000);
  if (!limiter.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded." }, { status: 429 });
  }

  const { id } = await context.params;
  const client = await resolveOwnedClient(user.id, id);
  if (client instanceof Response) return client;
  if (!client) {
    return NextResponse.json({ error: "Client not found." }, { status: 404 });
  }

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "A file is required." }, { status: 400 });
  }

  const evidenceTypeField = form.get("evidenceType");
  const evidenceType = evidenceTypeField === "DIAGRAM" ? "DIAGRAM" : "IMAGE";

  const submissionId = resolveSubmissionId(form.get("submissionId"));

  // Idempotency (Part 13): checked BEFORE any upload work, so a retry of
  // the same logical submission never re-uploads the file or creates a
  // second ImageAsset -- it simply returns the already-persisted result.
  if (submissionId) {
    const existing = await findLearningEvidenceForOwner(user.id, submissionId);
    if (existing) {
      return NextResponse.json({ evidence: existing }, { status: 201 });
    }
  }

  try {
    const [asset] = await uploadLearningEvidenceImageAssets(user.id, id, [file]);

    const evidence = await createLearningEvidence(
      user.id,
      {
        evidenceType,
        vertical: resolveLearningEvidenceVertical(form.get("vertical")),
        title: resolveLearningEvidenceTitle(form.get("title")),
        imageAssetId: asset.id,
        provenance: { channel: "upload" },
        rightsClassification: DEFAULT_LEARNING_EVIDENCE_RIGHTS_CLASSIFICATION,
      },
      { submissionId },
    );

    return NextResponse.json({ evidence }, { status: 201 });
  } catch (error) {
    if (error instanceof LearningEvidenceImageValidationError) {
      return NextResponse.json({ error: error.detail.code, message: error.message }, { status: 400 });
    }
    if (error instanceof LearningEvidenceImageMagicBytesError) {
      return NextResponse.json({ error: "INVALID_MAGIC_BYTES", message: error.message }, { status: 400 });
    }
    if (error instanceof ObjectStorageWriteModeRequiredError) {
      return NextResponse.json({ error: "IMAGE_STORAGE_UNAVAILABLE", message: error.message }, { status: 503 });
    }
    if (error instanceof ProfessionalLearningEvidenceValidationError) {
      return NextResponse.json({ error: error.message }, { status: error.httpStatus });
    }
    if (isProfessionalLearningEvidencePersistenceError(error)) {
      return professionalLearningEvidencePersistenceUnavailableResponse();
    }
    throw error;
  }
}
