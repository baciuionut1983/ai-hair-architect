import { NextResponse } from "next/server";

import { ObjectStorageWriteModeRequiredError } from "@/lib/image-analysis-service";
import { resolveVideoMultipartStorageDependencies } from "@/lib/professional-learning-video-multipart-upload-runtime";
import { listUploadedParts, UploadSessionStateError, UploadSessionValidationError } from "@/lib/professional-learning-video-multipart-upload-service";
import {
  findUploadSessionForOwner,
  isUploadSessionPersistenceError,
  uploadSessionPersistenceUnavailableResponse,
} from "@/lib/professional-learning-upload-session-repository";
import { authenticateSessionRequest } from "@/lib/session-request-auth";

// Professional Skill Engine, Stage 8.5L3.1 -- SESSION STATUS + RESUME
// (task Part 9: real resume-after-page-refresh support). Top-level,
// owner-scoped only -- the session already durably carries its own
// clientId (infrastructure-only, see the model's own header comment);
// no client-context re-validation is needed for a read of a session this
// exact caller already owns.
export async function GET(_request: Request, context: { params: Promise<{ sessionId: string }> }) {
  const user = await authenticateSessionRequest();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { sessionId } = await context.params;

  try {
    const session = await findUploadSessionForOwner(user.id, sessionId);
    if (!session) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    let uploadedParts: readonly { partNumber: number; etag: string }[] = [];
    try {
      const deps = await resolveVideoMultipartStorageDependencies();
      uploadedParts = await listUploadedParts(user.id, sessionId, deps);
    } catch (error) {
      // A resumed client can still see the session's own persisted state
      // even if the storage provider is momentarily unreachable for the
      // live parts list -- the parts list is a resume convenience, not
      // the session's own authority.
      if (!(error instanceof ObjectStorageWriteModeRequiredError)) throw error;
    }

    return NextResponse.json({
      sessionId: session.id,
      status: session.status,
      fileName: session.fileName,
      expectedSizeBytes: session.expectedSizeBytes,
      partSizeBytes: session.partSizeBytes,
      expiresAt: session.expiresAt,
      evidenceId: session.evidenceId,
      uploadedPartNumbers: uploadedParts.map((part) => part.partNumber).sort((a, b) => a - b),
    });
  } catch (error) {
    if (error instanceof UploadSessionValidationError || error instanceof UploadSessionStateError) {
      return NextResponse.json({ error: error.code, message: error.message }, { status: error.httpStatus });
    }
    if (isUploadSessionPersistenceError(error)) {
      return uploadSessionPersistenceUnavailableResponse();
    }
    throw error;
  }
}
