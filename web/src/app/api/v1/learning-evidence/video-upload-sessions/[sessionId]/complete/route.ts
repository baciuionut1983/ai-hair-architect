import { NextResponse } from "next/server";

import { checkRateLimit } from "@/lib/hardening";
import { ObjectStorageWriteModeRequiredError } from "@/lib/image-analysis-service";
import { resolveLearningEvidenceTitle, resolveLearningEvidenceVertical } from "@/lib/learning-evidence-request-shared";
import { resolveVideoMultipartStorageDependencies } from "@/lib/professional-learning-video-multipart-upload-runtime";
import {
  completeVideoUploadSession,
  UploadSessionProviderError,
  UploadSessionStateError,
  UploadSessionValidationError,
} from "@/lib/professional-learning-video-multipart-upload-service";
import { isUploadSessionPersistenceError, uploadSessionPersistenceUnavailableResponse } from "@/lib/professional-learning-upload-session-repository";
import { ProfessionalLearningEvidenceValidationError, isProfessionalLearningEvidencePersistenceError } from "@/lib/professional-learning-evidence-repository";
import { authenticateSessionRequest } from "@/lib/session-request-auth";

// Professional Skill Engine, Stage 8.5L3.1 -- FINALIZATION. The client
// reporting its own part list is NOT trusted as proof of completion
// (Part 11) -- completeVideoUploadSession independently verifies the
// real object with the provider before ever creating a VideoAsset.
export async function POST(request: Request, context: { params: Promise<{ sessionId: string }> }) {
  const user = await authenticateSessionRequest();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const limiter = checkRateLimit(`learning-evidence-upload-session-complete:${user.id}`, 20, 60_000);
  if (!limiter.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded." }, { status: 429 });
  }

  const { sessionId } = await context.params;
  const body = (await request.json().catch(() => ({}))) as {
    parts?: { partNumber?: number; etag?: string }[];
    title?: string;
    vertical?: string;
  };

  if (!Array.isArray(body.parts) || body.parts.length === 0) {
    return NextResponse.json({ error: "INVALID_REQUEST", message: "parts is required." }, { status: 400 });
  }
  const parts = body.parts.map((part) => ({ partNumber: Number(part.partNumber), etag: String(part.etag ?? "") }));

  try {
    const deps = await resolveVideoMultipartStorageDependencies();
    const { evidence } = await completeVideoUploadSession(
      user.id,
      sessionId,
      { parts, title: resolveLearningEvidenceTitle(body.title) ?? undefined, vertical: resolveLearningEvidenceVertical(body.vertical) },
      deps,
    );
    return NextResponse.json({ evidence }, { status: 201 });
  } catch (error) {
    if (error instanceof UploadSessionValidationError || error instanceof UploadSessionStateError) {
      return NextResponse.json({ error: error.code, message: error.message }, { status: error.httpStatus });
    }
    if (error instanceof UploadSessionProviderError) {
      return NextResponse.json({ error: error.code, message: error.message }, { status: error.httpStatus });
    }
    if (error instanceof ObjectStorageWriteModeRequiredError) {
      return NextResponse.json({ error: "LARGE_VIDEO_UPLOAD_UNAVAILABLE", message: "Large video upload is not available in this environment." }, { status: 503 });
    }
    if (error instanceof ProfessionalLearningEvidenceValidationError) {
      return NextResponse.json({ error: error.message }, { status: error.httpStatus });
    }
    if (isUploadSessionPersistenceError(error) || isProfessionalLearningEvidencePersistenceError(error)) {
      return uploadSessionPersistenceUnavailableResponse();
    }
    throw error;
  }
}
