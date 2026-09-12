import { NextResponse } from "next/server";

import { resolveOwnedClient } from "@/lib/client-repository";
import { checkRateLimit } from "@/lib/hardening";
import { ObjectStorageWriteModeRequiredError } from "@/lib/image-analysis-service";
import { resolveVideoMultipartStorageDependencies, resolveVideoUploadBucketAlias } from "@/lib/professional-learning-video-multipart-upload-runtime";
import {
  initiateVideoUploadSession,
  UploadSessionProviderError,
  UploadSessionValidationError,
} from "@/lib/professional-learning-video-multipart-upload-service";
import { isUploadSessionPersistenceError, uploadSessionPersistenceUnavailableResponse } from "@/lib/professional-learning-upload-session-repository";
import { authenticateSessionRequest } from "@/lib/session-request-auth";

// Professional Skill Engine, Stage 8.5L3.1 -- LARGE VIDEO UPLOAD,
// SESSION INITIATION. The ONLY step where this route touches object
// storage configuration directly (resolveVideoUploadBucketAlias) --
// every other step in the lifecycle reads the bucket alias back off the
// session row itself. If S3/object storage is not configured
// (OBJECT_STORAGE_WRITE_MODE != enabled), this fails closed with the
// same ObjectStorageWriteModeRequiredError every other upload path in
// this app already throws -- never a silent fallback to buffering large
// bytes through application memory.
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await authenticateSessionRequest();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const limiter = checkRateLimit(`learning-evidence-upload-session:${user.id}`, 10, 60_000);
  if (!limiter.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded." }, { status: 429 });
  }

  const { id } = await context.params;
  const client = await resolveOwnedClient(user.id, id);
  if (client instanceof Response) return client;
  if (!client) {
    return NextResponse.json({ error: "Client not found." }, { status: 404 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    sessionId?: string;
    fileName?: string;
    contentType?: string;
    expectedSizeBytes?: number;
    expectedChecksumSha256?: string;
  };

  if (typeof body.sessionId !== "string" || !body.sessionId) {
    return NextResponse.json({ error: "INVALID_SESSION_ID", message: "sessionId is required." }, { status: 400 });
  }
  if (typeof body.fileName !== "string" || typeof body.contentType !== "string" || typeof body.expectedSizeBytes !== "number") {
    return NextResponse.json({ error: "INVALID_REQUEST", message: "fileName, contentType, and expectedSizeBytes are required." }, { status: 400 });
  }

  try {
    const bucketAlias = resolveVideoUploadBucketAlias();
    const deps = await resolveVideoMultipartStorageDependencies();

    const { session, plan } = await initiateVideoUploadSession(
      user.id,
      body.sessionId,
      {
        clientId: id,
        fileName: body.fileName,
        contentType: body.contentType,
        expectedSizeBytes: body.expectedSizeBytes,
        expectedChecksumSha256: typeof body.expectedChecksumSha256 === "string" ? body.expectedChecksumSha256 : undefined,
      },
      deps,
    );

    return NextResponse.json({
      sessionId: session.id,
      status: session.status,
      bucketAlias,
      partSizeBytes: plan.partSizeBytes,
      partCount: plan.partCount,
      expiresAt: session.expiresAt,
    }, { status: 201 });
  } catch (error) {
    if (error instanceof UploadSessionValidationError) {
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
