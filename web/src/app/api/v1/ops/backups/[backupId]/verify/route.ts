import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { BackupArtifactError } from "@/lib/backup-v13-artifact";
import { resolveOpsSessionUser, verifyBackupSnapshotForUser } from "@/lib/ops-persistence";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ backupId: string }> }) {
  const { backupId } = await context.params;

  const cookieStore = await cookies();
  const token = cookieStore.get("aha_session")?.value ?? null;
  const sessionUser = await resolveOpsSessionUser(token);

  if (!sessionUser) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }

  try {
    const verification = await verifyBackupSnapshotForUser(sessionUser.id, backupId);
    return NextResponse.json(verification, {
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
      { error: "INTERNAL_ERROR", message: "Backup verification failed." },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
