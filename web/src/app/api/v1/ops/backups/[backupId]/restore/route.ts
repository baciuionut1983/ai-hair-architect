import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { randomUUID } from "crypto";

import { BackupArtifactError } from "@/lib/backup-v13-artifact";
import { executeBackupRestoreWithHistory } from "@/lib/backup-v13-restore-run-history";
import { ensureRequestId } from "@/lib/hardening";
import { resolveOpsSessionUserReadOnly } from "@/lib/ops-persistence";

export const dynamic = "force-dynamic";

const FINGERPRINT_REGEX = /^[0-9a-f]{64}$/;
const REQUEST_ID_REGEX = /^[A-Za-z0-9._:-]{1,120}$/;

export async function POST(request: Request, context: { params: Promise<{ backupId: string }> }) {
  const { backupId } = await context.params;

  const cookieStore = await cookies();
  const token = cookieStore.get("aha_session")?.value ?? null;
  const sessionUser = await resolveOpsSessionUserReadOnly(token);

  if (!sessionUser) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401, headers: { "Cache-Control": "no-store" } });
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