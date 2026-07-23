import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { BackupArtifactError } from "@/lib/backup-v13-artifact";
import { listBackupRestoreRunsForUser } from "@/lib/backup-v13-restore-run-history";
import type { BackupRestoreRunStatus } from "@/lib/contracts";
import { resolveOpsSessionUserReadOnly } from "@/lib/ops-persistence";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const cookieStore = await cookies();
  const token = cookieStore.get("aha_session")?.value ?? null;
  const sessionUser = await resolveOpsSessionUserReadOnly(token);

  if (!sessionUser) {
    return NextResponse.json(
      { error: "UNAUTHORIZED" },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  const url = new URL(request.url);
  const limitParam = url.searchParams.get("limit");
  const statusParam = url.searchParams.get("status");

  const limit = limitParam === null ? undefined : Number.parseInt(limitParam, 10);

  try {
    const response = await listBackupRestoreRunsForUser({
      ownerUserId: sessionUser.id,
      limit,
      cursor: url.searchParams.get("cursor"),
      backupId: url.searchParams.get("backupId") ?? undefined,
      status: (statusParam ?? undefined) as BackupRestoreRunStatus | undefined,
      from: url.searchParams.get("from") ?? undefined,
      to: url.searchParams.get("to") ?? undefined,
      correlationRequestId: url.searchParams.get("correlationRequestId") ?? undefined,
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
      { error: "INTERNAL_ERROR", message: "Failed to list restore history." },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
