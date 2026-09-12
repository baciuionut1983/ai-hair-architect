import { NextResponse } from "next/server";

import { checkRateLimit } from "@/lib/hardening";
import { ObjectStorageWriteModeRequiredError } from "@/lib/image-analysis-service";
import { resolveVideoMultipartStorageDependencies } from "@/lib/professional-learning-video-multipart-upload-runtime";
import {
  requestUploadPartUrl,
  UploadSessionProviderError,
  UploadSessionStateError,
  UploadSessionValidationError,
} from "@/lib/professional-learning-video-multipart-upload-service";
import { isUploadSessionPersistenceError, uploadSessionPersistenceUnavailableResponse } from "@/lib/professional-learning-upload-session-repository";
import { authenticateSessionRequest } from "@/lib/session-request-auth";

// Professional Skill Engine, Stage 8.5L3.1 -- PART UPLOAD AUTHORIZATION.
// Returns a short-lived, single-part-scoped presigned PUT URL -- the
// browser uploads that ONE part's bytes DIRECTLY to S3, never through
// this route (Part 31's own absolute rule: this handler never reads the
// request body's bytes, only a JSON {partNumber}).
export async function POST(request: Request, context: { params: Promise<{ sessionId: string }> }) {
  const user = await authenticateSessionRequest();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const limiter = checkRateLimit(`learning-evidence-upload-session-part:${user.id}`, 1000, 60_000);
  if (!limiter.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded." }, { status: 429 });
  }

  const { sessionId } = await context.params;
  const body = (await request.json().catch(() => ({}))) as { partNumber?: number };
  if (typeof body.partNumber !== "number") {
    return NextResponse.json({ error: "INVALID_REQUEST", message: "partNumber is required." }, { status: 400 });
  }

  try {
    const deps = await resolveVideoMultipartStorageDependencies();
    const result = await requestUploadPartUrl(user.id, sessionId, body.partNumber, deps);
    return NextResponse.json(result);
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
    if (isUploadSessionPersistenceError(error)) {
      return uploadSessionPersistenceUnavailableResponse();
    }
    throw error;
  }
}
