import { NextResponse } from "next/server";

import { CAPTURE_SET_VIEW_LABELS, MAX_PROFESSIONAL_LEARNING_SET_IMAGES, type CaptureSetImageInput } from "@/lib/capture-set-validators";
import { CaptureSetConcurrencyError, CaptureSetDependencyError, CaptureSetInvariantError, CaptureSetPersistenceError, CaptureSetValidationError, createCaptureSet } from "@/lib/capture-set-repository";
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

// Professional Skill Engine, Stage 8.5L3 -- MULTI-IMAGE / IMAGE SET
// LEARNING EVIDENCE (task Part 7). Uploads 2-4 files through the same
// canonical ImageAsset pipeline as the single-image route, groups them
// into one CaptureSet (capture-set-repository.ts, entirely unmodified --
// its own MAX_IMAGES=4/validateUploadBatch limit already bounds this),
// then links a single ProfessionalLearningEvidence(IMAGE_SET) row to that
// CaptureSet.
//
// HONEST REUSE, NOT A PERFECT FIT (documented per task Part 8's own
// "document representation" instruction): CaptureSet's four viewLabels
// (FRONT/LEFT/BACK/RIGHT) are a camera-ANGLE vocabulary for a client's
// head, which has no meaning for an arbitrary ordered teaching sequence
// (e.g. "step 1 of a graduation demonstration"). Rather than invent a
// second grouping model, this route repurposes the same four labels
// purely as ORDINAL slots, in upload order -- files[0]->FRONT,
// files[1]->LEFT, etc. Nothing in ProfessionalLearningEvidence's own
// model, nor in this evidence's UI presentation, ever describes these as
// camera angles. This is also why an image set is capped at exactly 4
// images in this stage -- the same cap CaptureSet, and every existing
// image-upload path in this app (image-upload-validation.ts's own
// MAX_IMAGES), already enforces; not a new, invented limitation.
//
// Stage 8.5L3.1 SEMANTIC CLEANUP: the CaptureSet row this route creates
// now carries purpose="PROFESSIONAL_LEARNING_SET" explicitly (default
// for every other CaptureSet caller in this app remains
// "CLIENT_MULTIVIEW", unchanged) and each image its own real
// ordinalPosition -- a future domain/AI engine must consult
// isAnatomicalViewLabelMeaningful(purpose) (capture-set-validators.ts)
// before ever treating this row's viewLabel values as real camera
// angles, and should read ordinalPosition for true sequence instead.
const ORDINAL_VIEW_LABELS = CAPTURE_SET_VIEW_LABELS;

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
  const files = form.getAll("files").filter((entry): entry is File => entry instanceof File);
  if (files.length < 2) {
    return NextResponse.json({ error: "At least 2 files are required for an image set (use the single-image endpoint for one file)." }, { status: 400 });
  }
  if (files.length > MAX_PROFESSIONAL_LEARNING_SET_IMAGES) {
    return NextResponse.json({ error: `A maximum of ${MAX_PROFESSIONAL_LEARNING_SET_IMAGES} images is supported per image set in this stage.` }, { status: 400 });
  }

  const submissionId = resolveSubmissionId(form.get("submissionId"));

  if (submissionId) {
    const existing = await findLearningEvidenceForOwner(user.id, submissionId);
    if (existing) {
      return NextResponse.json({ evidence: existing }, { status: 201 });
    }
  }

  try {
    const assets = await uploadLearningEvidenceImageAssets(user.id, id, files);
    // Stage 8.5L3.1: purpose="PROFESSIONAL_LEARNING_SET" is the
    // server-authoritative marker that this row's viewLabel values are
    // ordinal slots, never anatomical camera angles (see
    // capture-set-validators.ts's own isAnatomicalViewLabelMeaningful).
    // ordinalPosition is the neutral field a future consumer should
    // actually read for sequence.
    const captureSetImages: CaptureSetImageInput[] = assets.map((asset, index) => ({
      viewLabel: ORDINAL_VIEW_LABELS[index],
      imageAssetId: asset.id,
      ordinalPosition: index + 1,
    }));

    const captureSet = await createCaptureSet(user.id, id, captureSetImages, "PROFESSIONAL_LEARNING_SET");

    const evidence = await createLearningEvidence(
      user.id,
      {
        evidenceType: "IMAGE_SET",
        vertical: resolveLearningEvidenceVertical(form.get("vertical")),
        title: resolveLearningEvidenceTitle(form.get("title")),
        captureSetId: captureSet.id,
        provenance: { channel: "upload", imageCount: assets.length },
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
    if (
      error instanceof CaptureSetValidationError ||
      error instanceof CaptureSetDependencyError ||
      error instanceof CaptureSetConcurrencyError ||
      error instanceof CaptureSetInvariantError ||
      error instanceof CaptureSetPersistenceError
    ) {
      return NextResponse.json({ error: error.message }, { status: error.httpStatus });
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
