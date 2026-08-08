import { NextResponse } from "next/server";

import {
  BackupM15V2SnapshotPersistenceError,
  type BackupM15V2SnapshotPersistenceErrorCode,
} from "@/lib/backup-m15-v2-snapshot-persistence";
import { createBackupM15V2SnapshotForUser } from "@/lib/backup-m15-v2-snapshot-persistence-runtime";
import { sanitize } from "@/lib/milestone1-store";
import { listBackupSnapshotsForUser } from "@/lib/ops-persistence";
import { authenticateSessionRequest } from "@/lib/session-request-auth";

function mapM15V2CreationErrorStatus(code: BackupM15V2SnapshotPersistenceErrorCode): number {
  switch (code) {
    case "ROW_LIMIT_EXCEEDED":
      return 413;
    default:
      return 500;
  }
}

export async function GET() {
  const sessionUser = await authenticateSessionRequest();

  if (!sessionUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const backups = await listBackupSnapshotsForUser(sessionUser.id);
  return NextResponse.json({ backups }, { status: 200 });
}

export async function POST(request: Request) {
  const sessionUser = await authenticateSessionRequest();

  if (!sessionUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json(
      { error: "BACKUP_REQUEST_INVALID_JSON", message: "Request body must be valid JSON." },
      { status: 400 },
    );
  }

  if (!rawBody || typeof rawBody !== "object" || Array.isArray(rawBody)) {
    return NextResponse.json(
      { error: "BACKUP_REQUEST_INVALID_JSON", message: "Request body must be a JSON object." },
      { status: 400 },
    );
  }

  const body = rawBody as Record<string, unknown>;
  const allowedFields = new Set(["label"]);
  const unknownFields = Object.keys(body).filter((key) => !allowedFields.has(key));
  if (unknownFields.length > 0) {
    return NextResponse.json(
      {
        error: "BACKUP_REQUEST_INVALID_FIELD",
        message: "Unexpected request fields.",
        fields: unknownFields,
      },
      { status: 400 },
    );
  }

  if (body.label !== undefined && typeof body.label !== "string") {
    return NextResponse.json(
      {
        error: "BACKUP_LABEL_INVALID_TYPE",
        message: "label must be a string.",
      },
      { status: 400 },
    );
  }

  const normalizedLabel = sanitize(typeof body.label === "string" ? body.label : "") || "manual-backup";
  if (normalizedLabel.length > 120) {
    return NextResponse.json(
      {
        error: "BACKUP_LABEL_TOO_LONG",
        message: "label must not exceed 120 characters.",
      },
      { status: 400 },
    );
  }

  try {
    const backup = await createBackupM15V2SnapshotForUser(
      sessionUser.id,
      sessionUser.id,
      normalizedLabel,
      { now: () => new Date() },
    );
    return NextResponse.json({ backup }, { status: 201 });
  } catch (error) {
    if (error instanceof BackupM15V2SnapshotPersistenceError) {
      return NextResponse.json(
        {
          error: error.code,
          message: error.message,
        },
        { status: mapM15V2CreationErrorStatus(error.code) },
      );
    }

    return NextResponse.json(
      {
        error: "INTERNAL_ERROR",
        message: "Failed to create backup snapshot.",
      },
      { status: 500 },
    );
  }
}
