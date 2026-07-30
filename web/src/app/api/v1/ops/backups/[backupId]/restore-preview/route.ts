import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { BackupArtifactError } from "@/lib/backup-v13-artifact";
import { getRuntimeBackupRestorePreviewForUser } from "@/lib/backup-restore-preview-runtime";
import {
  BackupM15V2RestorePreviewRuntimeError,
  getBackupM15V2RestorePreviewForUser,
} from "@/lib/backup-m15-v2-restore-preview-runtime";
import { resolveOpsSessionUserReadOnly } from "@/lib/ops-persistence";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

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
      { error: "BACKUP_PREVIEW_REQUEST_INVALID_JSON", message: "Request body must be an empty JSON object." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  if (!rawBody || typeof rawBody !== "object" || Array.isArray(rawBody) || Object.keys(rawBody as Record<string, unknown>).length !== 0) {
    return NextResponse.json(
      { error: "BACKUP_PREVIEW_REQUEST_INVALID_JSON", message: "Request body must be an empty JSON object." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  // Owner-scoped, single read: decides the dispatch branch below. A snapshot belonging
  // to another owner never matches this query, so it falls through identically to a
  // genuinely absent one, into the unchanged M13/M15v1 path's own not-found handling.
  const snapshotHeader = await prisma.opsBackupSnapshot.findFirst({
    where: { id: backupId, ownerUserId: sessionUser.id },
    select: { schemaVersion: true },
  });

  if (snapshotHeader?.schemaVersion === "m15.v2") {
    try {
      const preview = await getBackupM15V2RestorePreviewForUser(sessionUser.id, backupId, { now: () => new Date() });
      return NextResponse.json(preview, {
        status: 200,
        headers: {
          "Cache-Control": "no-store",
        },
      });
    } catch (error) {
      if (error instanceof BackupM15V2RestorePreviewRuntimeError) {
        return NextResponse.json(
          {
            error: error.code,
            message: error.message,
          },
          {
            status: error.httpStatus,
            headers: {
              "Cache-Control": "no-store",
            },
          },
        );
      }

      return NextResponse.json(
        { error: "INTERNAL_ERROR", message: "Backup restore preview failed." },
        { status: 500, headers: { "Cache-Control": "no-store" } },
      );
    }
  }

  try {
    const preview = await getRuntimeBackupRestorePreviewForUser(sessionUser.id, backupId);
    return NextResponse.json(preview, {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    if (error instanceof BackupArtifactError) {
      return NextResponse.json(
        {
          error: error.code,
          message: error.message,
          details: error.details,
        },
        {
          status: error.httpStatus,
          headers: {
            "Cache-Control": "no-store",
          },
        },
      );
    }

    return NextResponse.json(
      { error: "INTERNAL_ERROR", message: "Backup restore preview failed." },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
