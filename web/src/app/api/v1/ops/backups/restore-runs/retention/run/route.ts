import { randomUUID } from "crypto";

import { NextResponse } from "next/server";

import { BackupArtifactError } from "@/lib/backup-v13-artifact";
import { runBackupRestoreRunRetention } from "@/lib/backup-v13-restore-run-retention";
import type { BackupRestoreRunRetentionRequest } from "@/lib/contracts";
import { ensureRequestId } from "@/lib/hardening";
import { authenticateSessionRequest } from "@/lib/session-request-auth";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" } as const;
const REQUEST_ID_REGEX = /^[A-Za-z0-9._:-]{1,120}$/;

export async function POST(request: Request) {
  const sessionUser = await authenticateSessionRequest();

  if (!sessionUser) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401, headers: NO_STORE_HEADERS });
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json(
      { error: "BACKUP_RESTORE_RETENTION_REQUEST_INVALID_JSON", message: "Request body must be valid JSON." },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  if (!rawBody || typeof rawBody !== "object" || Array.isArray(rawBody)) {
    return NextResponse.json(
      { error: "BACKUP_RESTORE_RETENTION_REQUEST_INVALID_JSON", message: "Request body must be a JSON object." },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  const body = rawBody as Record<string, unknown>;
  const mode = body.mode;
  const allowedFields =
    mode === "execution"
      ? new Set([
        "mode",
        "policyVersion",
        "batchLimit",
        "evaluationTime",
        "retentionFingerprint",
        "executionIdempotencyKey",
        "acknowledgeDeletion",
      ])
      : new Set(["mode", "policyVersion", "batchLimit"]);

  const unknownFields = Object.keys(body).filter((key) => !allowedFields.has(key));
  if (unknownFields.length > 0) {
    return NextResponse.json(
      { error: "BACKUP_RESTORE_RETENTION_REQUEST_INVALID_FIELD", message: "Unexpected request fields.", fields: unknownFields },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  try {
    const retentionRequest = parseRequest(body);
    const headerRequestId = request.headers?.get?.("x-request-id") ?? null;
    const normalizedRequestId = ensureRequestId(headerRequestId);
    const correlationRequestId = REQUEST_ID_REGEX.test(normalizedRequestId) ? normalizedRequestId : randomUUID();

    const response = await runBackupRestoreRunRetention({
      ownerUserId: sessionUser.id,
      actorUserId: sessionUser.id,
      correlationRequestId,
      request: retentionRequest,
    });

    return NextResponse.json(response, { status: 200, headers: NO_STORE_HEADERS });
  } catch (error) {
    if (error instanceof BackupArtifactError) {
      return NextResponse.json(
        { error: error.code, message: error.message, details: error.details },
        { status: error.httpStatus, headers: NO_STORE_HEADERS },
      );
    }

    return NextResponse.json(
      { error: "INTERNAL_ERROR", message: "Restore run retention failed." },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}

function parseRequest(body: Record<string, unknown>): BackupRestoreRunRetentionRequest {
  if (
    body.mode === "dry_run" &&
    body.policyVersion === "m13f-v1" &&
    typeof body.batchLimit === "number"
  ) {
    return {
      mode: "dry_run",
      policyVersion: "m13f-v1",
      batchLimit: body.batchLimit,
    };
  }

  if (
    body.mode !== "execution" ||
    body.policyVersion !== "m13f-v1" ||
    typeof body.batchLimit !== "number" ||
    typeof body.evaluationTime !== "string" ||
    typeof body.retentionFingerprint !== "string" ||
    typeof body.executionIdempotencyKey !== "string" ||
    body.acknowledgeDeletion !== true
  ) {
    throw new BackupArtifactError(
      "BACKUP_RESTORE_RETENTION_REQUEST_INVALID",
      400,
      "Retention request payload is invalid.",
    );
  }

  return {
    mode: "execution",
    policyVersion: "m13f-v1",
    batchLimit: body.batchLimit,
    evaluationTime: body.evaluationTime,
    retentionFingerprint: body.retentionFingerprint,
    executionIdempotencyKey: body.executionIdempotencyKey,
    acknowledgeDeletion: true,
  };
}
