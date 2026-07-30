import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { BackupArtifactError } from "@/lib/backup-v13-artifact";
import {
  BackupM15V2SnapshotPersistenceError,
  type BackupM15V2SnapshotPersistenceErrorCode,
} from "@/lib/backup-m15-v2-snapshot-persistence";
import { verifyBackupM15V2SnapshotForUser } from "@/lib/backup-m15-v2-snapshot-persistence-runtime";
import { resolveOpsSessionUser, verifyBackupSnapshotForUser } from "@/lib/ops-persistence";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

function mapM15V2SnapshotErrorStatus(code: BackupM15V2SnapshotPersistenceErrorCode): number {
  switch (code) {
    case "SNAPSHOT_NOT_FOUND":
      return 404;
    case "SNAPSHOT_SCHEMA_UNSUPPORTED":
    case "SNAPSHOT_PAYLOAD_INVALID":
    case "SNAPSHOT_IDENTITY_MISMATCH":
    case "SNAPSHOT_CHECKSUM_MISMATCH":
      return 422;
    default:
      return 500;
  }
}

export async function GET(_request: Request, context: { params: Promise<{ backupId: string }> }) {
  const { backupId } = await context.params;

  const cookieStore = await cookies();
  const token = cookieStore.get("aha_session")?.value ?? null;
  const sessionUser = await resolveOpsSessionUser(token);

  if (!sessionUser) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }

  // Owner-scoped, single read: decides the dispatch branch below. A snapshot belonging
  // to another owner never matches this query, so it falls through identically to a
  // genuinely absent one, into the unchanged M13 path's own not-found handling.
  const snapshotHeader = await prisma.opsBackupSnapshot.findFirst({
    where: { id: backupId, ownerUserId: sessionUser.id },
    select: { schemaVersion: true },
  });

  if (snapshotHeader?.schemaVersion === "m15.v2") {
    try {
      const verification = await verifyBackupM15V2SnapshotForUser(sessionUser.id, backupId, { now: () => new Date() });
      return NextResponse.json(verification, {
        status: 200,
        headers: {
          "Cache-Control": "no-store",
        },
      });
    } catch (error) {
      if (error instanceof BackupM15V2SnapshotPersistenceError) {
        return NextResponse.json(
          {
            error: error.code,
            message: error.message,
          },
          {
            status: mapM15V2SnapshotErrorStatus(error.code),
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
