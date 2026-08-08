import { NextResponse } from "next/server";
import { randomUUID } from "crypto";

import { BackupArtifactError } from "@/lib/backup-v13-artifact";
import {
  BackupM15V2RestoreExecutionError,
  type BackupM15V2RestoreExecutionErrorCode,
} from "@/lib/backup-m15-v2-restore-execution";
import {
  BackupM15V2RestoreExecutionRuntimeError,
  runBackupM15V2RestoreForUser,
} from "@/lib/backup-m15-v2-restore-execution-runtime";
import { executeBackupRestoreWithHistory } from "@/lib/backup-v13-restore-run-history";
import { ensureRequestId } from "@/lib/hardening";
import { prisma } from "@/lib/prisma";
import { authenticateSessionRequest } from "@/lib/session-request-auth";

export const dynamic = "force-dynamic";

const FINGERPRINT_REGEX = /^[0-9a-f]{64}$/;
const REQUEST_ID_REGEX = /^[A-Za-z0-9._:-]{1,120}$/;

function mapM15V2RestoreExecutionErrorStatus(code: BackupM15V2RestoreExecutionErrorCode): number {
  switch (code) {
    case "SNAPSHOT_NOT_FOUND":
      return 404;
    case "REQUEST_INVALID":
    case "SNAPSHOT_SCHEMA_UNSUPPORTED":
    case "SNAPSHOT_PAYLOAD_INVALID":
    case "SNAPSHOT_IDENTITY_MISMATCH":
    case "SNAPSHOT_CHECKSUM_MISMATCH":
      return 400;
    case "PRECHECK_FAILED":
    case "RESTORE_BLOCKED_BY_PREVIEW":
    case "PREVIEW_FINGERPRINT_STALE":
    case "SAFETY_BACKUP_REQUIRED":
    case "SAFETY_BACKUP_INVALID":
    case "SAFETY_BACKUP_STATE_MISMATCH":
    case "CURRENT_STATE_CHANGED":
    case "OWNER_COLLISION":
    case "CONCURRENCY_CONFLICT":
      return 409;
    case "POSTCONDITION_FAILED":
      return 500;
    default:
      return 500;
  }
}

export async function POST(request: Request, context: { params: Promise<{ backupId: string }> }) {
  const { backupId } = await context.params;

  const sessionUser = await authenticateSessionRequest();

  if (!sessionUser) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }

  // Owner-scoped, single read: decides the dispatch branch below. A snapshot belonging
  // to another owner never matches this query, so it falls through identically to a
  // genuinely absent one, into the unchanged M13/M15v1 path's own not-found handling.
  const snapshotHeader = await prisma.opsBackupSnapshot.findFirst({
    where: { id: backupId, ownerUserId: sessionUser.id },
    select: { schemaVersion: true },
  });

  if (snapshotHeader?.schemaVersion === "m15.v2") {
    let m15v2Body: unknown;
    try {
      m15v2Body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "REQUEST_INVALID", message: "The restore request is not valid." },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    }

    try {
      const result = await runBackupM15V2RestoreForUser(sessionUser.id, backupId, m15v2Body, { now: () => new Date() });
      return NextResponse.json(result, { status: 200, headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      if (error instanceof BackupM15V2RestoreExecutionError) {
        return NextResponse.json(
          { error: error.code, message: error.message },
          { status: mapM15V2RestoreExecutionErrorStatus(error.code), headers: { "Cache-Control": "no-store" } },
        );
      }
      if (error instanceof BackupM15V2RestoreExecutionRuntimeError) {
        return NextResponse.json(
          { error: error.code, message: error.message },
          { status: error.httpStatus, headers: { "Cache-Control": "no-store" } },
        );
      }
      return NextResponse.json(
        { error: "INTERNAL_ERROR", message: "Backup restore failed." },
        { status: 500, headers: { "Cache-Control": "no-store" } },
      );
    }
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json(
      { error: "BACKUP_RESTORE_REQUEST_INVALID_JSON", message: "Request body must be valid JSON." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  if (!rawBody || typeof rawBody !== "object" || Array.isArray(rawBody)) {
    return NextResponse.json(
      { error: "BACKUP_RESTORE_REQUEST_INVALID_JSON", message: "Request body must be a JSON object." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const body = rawBody as Record<string, unknown>;
  const allowedFields = new Set([
    "previewFingerprint",
    "currentStateFingerprint",
    "strategy",
    "acknowledgeDataLoss",
    "previewGeneratedAt",
    "acknowledgeLegacyClientDataLoss",
    "safetyBackupId",
  ]);
  const unknownFields = Object.keys(body).filter((key) => !allowedFields.has(key));
  if (unknownFields.length > 0) {
    return NextResponse.json(
      { error: "BACKUP_RESTORE_REQUEST_INVALID_FIELD", message: "Unexpected request fields.", fields: unknownFields },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  if (
    typeof body.previewFingerprint !== "string" ||
    typeof body.currentStateFingerprint !== "string" ||
    body.strategy !== "replace_all" ||
    body.acknowledgeDataLoss !== true
  ) {
    return NextResponse.json(
      { error: "BACKUP_RESTORE_REQUEST_INVALID", message: "Restore request payload is invalid." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const invalidFingerprintFields: string[] = [];
  if (!FINGERPRINT_REGEX.test(body.previewFingerprint)) {
    invalidFingerprintFields.push("previewFingerprint");
  }
  if (!FINGERPRINT_REGEX.test(body.currentStateFingerprint)) {
    invalidFingerprintFields.push("currentStateFingerprint");
  }
  if (invalidFingerprintFields.length > 0) {
    return NextResponse.json(
      {
        error: "BACKUP_RESTORE_REQUEST_INVALID_FIELD",
        message: "Invalid fingerprint format.",
        fields: invalidFingerprintFields,
      },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  if (
    (body.previewGeneratedAt !== undefined &&
      (typeof body.previewGeneratedAt !== "string" || Number.isNaN(Date.parse(body.previewGeneratedAt)))) ||
    (body.acknowledgeLegacyClientDataLoss !== undefined && body.acknowledgeLegacyClientDataLoss !== true) ||
    (body.safetyBackupId !== undefined &&
      (typeof body.safetyBackupId !== "string" || body.safetyBackupId.length === 0 || body.safetyBackupId.length > 120))
  ) {
    return NextResponse.json(
      { error: "BACKUP_RESTORE_REQUEST_INVALID_FIELD", message: "Legacy safety binding fields are invalid." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const headerRequestId = request.headers?.get?.("x-request-id") ?? null;
    const normalizedRequestId = ensureRequestId(headerRequestId);
    const correlationRequestId = REQUEST_ID_REGEX.test(normalizedRequestId) ? normalizedRequestId : randomUUID();

    const response = await executeBackupRestoreWithHistory({
      ownerUserId: sessionUser.id,
      actorUserId: sessionUser.id,
      backupId,
      correlationRequestId,
      request: {
      previewFingerprint: body.previewFingerprint,
      currentStateFingerprint: body.currentStateFingerprint,
      strategy: "replace_all",
      acknowledgeDataLoss: true,
      ...(typeof body.previewGeneratedAt === "string" ? { previewGeneratedAt: body.previewGeneratedAt } : {}),
      ...(body.acknowledgeLegacyClientDataLoss === true ? { acknowledgeLegacyClientDataLoss: true as const } : {}),
      ...(typeof body.safetyBackupId === "string" ? { safetyBackupId: body.safetyBackupId } : {}),
      },
    });

    return NextResponse.json(response, {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (error instanceof BackupArtifactError) {
      return NextResponse.json(
        { error: error.code, message: error.message, details: error.details },
        { status: error.httpStatus, headers: { "Cache-Control": "no-store" } },
      );
    }

    return NextResponse.json(
      { error: "INTERNAL_ERROR", message: "Backup restore failed." },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}