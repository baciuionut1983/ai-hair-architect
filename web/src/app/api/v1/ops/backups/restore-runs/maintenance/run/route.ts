import { randomUUID } from "crypto";

import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { BackupArtifactError } from "@/lib/backup-v13-artifact";
import { runBackupRestoreRunMaintenance } from "@/lib/backup-v13-restore-run-maintenance";
import type { BackupRestoreRunMaintenanceRequest } from "@/lib/contracts";
import { ensureRequestId } from "@/lib/hardening";
import { resolveOpsSessionUserReadOnly } from "@/lib/ops-persistence";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" } as const;
const REQUEST_ID_REGEX = /^[A-Za-z0-9._:-]{1,120}$/;

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const token = cookieStore.get("aha_session")?.value ?? null;
  const sessionUser = await resolveOpsSessionUserReadOnly(token);

  if (!sessionUser) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401, headers: NO_STORE_HEADERS });
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json(
      { error: "BACKUP_RESTORE_MAINTENANCE_REQUEST_INVALID_JSON", message: "Request body must be valid JSON." },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  if (!rawBody || typeof rawBody !== "object" || Array.isArray(rawBody)) {
    return NextResponse.json(
      { error: "BACKUP_RESTORE_MAINTENANCE_REQUEST_INVALID_JSON", message: "Request body must be a JSON object." },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  const body = rawBody as Record<string, unknown>;
  const mode = body.mode;
  const allowedFields =
    mode === "execution"
      ? new Set([
        "mode",
        "staleThresholdMinutes",
        "evaluationTime",
        "maintenanceFingerprint",
        "acknowledgeMutation",
        "executionIdempotencyKey",
      ])
      : new Set(["mode", "staleThresholdMinutes"]);
  const unknownFields = Object.keys(body).filter((key) => !allowedFields.has(key));
  if (unknownFields.length > 0) {
    return NextResponse.json(
      { error: "BACKUP_RESTORE_MAINTENANCE_REQUEST_INVALID_FIELD", message: "Unexpected request fields.", fields: unknownFields },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  try {
    const maintenanceRequest = parseRequest(body);
    const headerRequestId = request.headers?.get?.("x-request-id") ?? null;
    const normalizedRequestId = ensureRequestId(headerRequestId);
    const correlationRequestId = REQUEST_ID_REGEX.test(normalizedRequestId) ? normalizedRequestId : randomUUID();
    const response = await runBackupRestoreRunMaintenance({
      ownerUserId: sessionUser.id,
      actorUserId: sessionUser.id,
      correlationRequestId,
      request: maintenanceRequest,
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
      { error: "INTERNAL_ERROR", message: "Restore run maintenance failed." },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}

function parseRequest(body: Record<string, unknown>): BackupRestoreRunMaintenanceRequest {
  if (body.mode === "dry_run") {
    if (typeof body.staleThresholdMinutes !== "number") {
      throw new BackupArtifactError(
        "BACKUP_RESTORE_MAINTENANCE_REQUEST_INVALID",
        400,
        "Dry-run request payload is invalid.",
      );
    }

    return {
      mode: "dry_run",
      staleThresholdMinutes: body.staleThresholdMinutes,
    };
  }

  if (
    body.mode !== "execution" ||
    typeof body.staleThresholdMinutes !== "number" ||
    typeof body.evaluationTime !== "string" ||
    typeof body.maintenanceFingerprint !== "string" ||
    body.acknowledgeMutation !== true ||
    typeof body.executionIdempotencyKey !== "string"
  ) {
    throw new BackupArtifactError(
      "BACKUP_RESTORE_MAINTENANCE_REQUEST_INVALID",
      400,
      "Execution request payload is invalid.",
    );
  }

  return {
    mode: "execution",
    staleThresholdMinutes: body.staleThresholdMinutes,
    evaluationTime: body.evaluationTime,
    maintenanceFingerprint: body.maintenanceFingerprint,
    acknowledgeMutation: true,
    executionIdempotencyKey: body.executionIdempotencyKey,
  };
}