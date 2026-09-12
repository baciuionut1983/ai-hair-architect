import { NextResponse } from "next/server";

import { resolveOwnedClient } from "@/lib/client-repository";
import { checkRateLimit } from "@/lib/hardening";
import { ObjectStorageWriteModeRequiredError, resolveObjectStorageWriteTarget } from "@/lib/image-analysis-service";
import { LearningEvidenceVideoValidationError, MAX_LEARNING_VIDEO_BYTES, uploadLearningEvidenceVideoAsset } from "@/lib/learning-evidence-video-upload";
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
import { VideoAssetStorageError } from "@/lib/video-asset-storage";

// Professional Skill Engine, Stage 8.5L3 -- VIDEO LEARNING EVIDENCE, the
// most sensitive ingestion path (task Part 9). Uploads exactly one video
// file, persists it as a durable, PRIVATE VideoAsset with
// origin="uploaded_source" (learning-evidence-video-upload.ts /
// video-asset-storage.ts's own persistUploadedLearningVideoAsset -- see
// that file's header comment for the full standard-vs-large-video
// architecture audit), then links a ProfessionalLearningEvidence(VIDEO)
// row to it.
//
// ABSOLUTELY NO video analysis/frame extraction/transcription/
// segmentation/vision/Veo/AI call happens anywhere in this route or
// anything it calls -- this proves safe storage only (task's own
// Absolute Rule: "INGESTION != INTERPRETATION").
//
// LARGE VIDEO: a file exceeding MAX_LEARNING_VIDEO_BYTES is rejected with
// a clear, honest error naming the current standard-upload limit -- never
// silently truncated, never accepted and then failing later.
//
// Stage 8.5L3.1 -- SUPERSEDED WHEN S3 IS CONFIGURED. "One video ingestion
// architecture is better than two": once object storage is genuinely
// configured (OBJECT_STORAGE_WRITE_MODE=enabled -- true in every real
// production deployment, since ObjectStorageWriteModeRequiredError
// already forbids production from running without it), this buffered,
// whole-file-through-application-memory path is refused outright in
// favor of /learning-evidence/video-upload-sessions' real multipart
// direct-to-S3 flow (professional-learning-video-multipart-upload-
// service.ts), which safely covers every size from small to GB-scale.
// This endpoint remains reachable ONLY as the local-development fallback
// for the one case that has no multipart-capable backend at all: no S3
// configured (the local-disk backend has no multipart concept -- see
// object-storage.ts's own MultipartObjectStorage header comment). It was
// never reachable in production before this stage either (the identical
// ObjectStorageWriteModeRequiredError guard below already made a
// misconfigured production instance fail closed here, same as always) --
// this change only closes the narrow window where an OPERATOR had
// correctly configured S3 but a client bundle still called this older
// endpoint instead of the new one.
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await authenticateSessionRequest();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const limiter = checkRateLimit(`learning-evidence-upload:${user.id}`, 10, 60_000);
  if (!limiter.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded." }, { status: 429 });
  }

  if (resolveObjectStorageWriteTarget()) {
    return NextResponse.json(
      {
        error: "USE_MULTIPART_UPLOAD",
        message: "This endpoint has been superseded. Use /api/v1/clients/{id}/learning-evidence/video-upload-sessions for video uploads.",
      },
      { status: 410 },
    );
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
    return NextResponse.json({ error: "A video file is required." }, { status: 400 });
  }

  const submissionId = resolveSubmissionId(form.get("submissionId"));

  if (submissionId) {
    const existing = await findLearningEvidenceForOwner(user.id, submissionId);
    if (existing) {
      return NextResponse.json({ evidence: existing }, { status: 201 });
    }
  }

  try {
    const asset = await uploadLearningEvidenceVideoAsset(user.id, id, file);

    const evidence = await createLearningEvidence(
      user.id,
      {
        evidenceType: "VIDEO",
        vertical: resolveLearningEvidenceVertical(form.get("vertical")),
        title: resolveLearningEvidenceTitle(form.get("title")),
        videoAssetId: asset.id,
        provenance: { channel: "upload" },
        rightsClassification: DEFAULT_LEARNING_EVIDENCE_RIGHTS_CLASSIFICATION,
      },
      { submissionId },
    );

    return NextResponse.json({ evidence }, { status: 201 });
  } catch (error) {
    if (error instanceof LearningEvidenceVideoValidationError) {
      const status = error.code === "FILE_TOO_LARGE" ? 413 : 400;
      return NextResponse.json(
        { error: error.code, message: error.message, maxBytes: error.code === "FILE_TOO_LARGE" ? MAX_LEARNING_VIDEO_BYTES : undefined },
        { status },
      );
    }
    if (error instanceof ObjectStorageWriteModeRequiredError) {
      return NextResponse.json({ error: "VIDEO_STORAGE_UNAVAILABLE", message: error.message }, { status: 503 });
    }
    if (error instanceof VideoAssetStorageError) {
      return NextResponse.json({ error: "VIDEO_STORAGE_FAILED", message: error.message }, { status: 502 });
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
