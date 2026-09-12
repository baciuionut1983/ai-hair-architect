import { NextResponse } from "next/server";

import { checkRateLimit } from "@/lib/hardening";
import { ObjectStorageWriteModeRequiredError } from "@/lib/image-analysis-service";
import { resolveVideoMultipartStorageDependencies } from "@/lib/professional-learning-video-multipart-upload-runtime";
import { abortVideoUploadSession, UploadSessionStateError, UploadSessionValidationError } from "@/lib/professional-learning-video-multipart-upload-service";
import { isUploadSessionPersistenceError, uploadSessionPersistenceUnavailableResponse } from "@/lib/professional-learning-upload-session-repository";
import { authenticateSessionRequest } from "@/lib/session-request-auth";

// Professional Skill Engine, Stage 8.5L3.1 -- CANCEL. Marks the session
// ABORTED and best-effort aborts the real provider multipart upload
// (Part 10) -- never creates a VideoAsset or ProfessionalLearningEvidence
// for an aborted session, under any circumstance.
export async function POST(_request: Request, context: { params: Promise<{ sessionId: string }> }) {
  const user = await authenticateSessionRequest();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const limiter = checkRateLimit(`learning-evidence-upload-session-abort:${user.id}`, 20, 60_000);
  if (!limiter.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded." }, { status: 429 });
  }

  const { sessionId } = await context.params;

  try {
    const deps = await resolveVideoMultipartStorageDependencies();
    await abortVideoUploadSession(user.id, sessionId, deps);
    return NextResponse.json({ aborted: true });
  } catch (error) {
    if (error instanceof UploadSessionValidationError || error instanceof UploadSessionStateError) {
      return NextResponse.json({ error: error.code, message: error.message }, { status: error.httpStatus });
    }
    if (error instanceof ObjectStorageWriteModeRequiredError) {
      return NextResponse.json({ error: "LARGE_VIDEO_UPLOAD_UNAVAILABLE", message: "Large video upload is not available in this environment." }, { status: 503 });
    }
    if (isUploadSessionPersistenceError(error)) {
      return uploadSessionPersistenceUnavailableResponse();
    }
    throw error;
  }
}
