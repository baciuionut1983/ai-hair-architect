import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { createBackupSnapshot, getBackupSnapshotsForUser, getSession, sanitize } from "@/lib/milestone1-store";

export async function GET() {
  const cookieStore = await cookies();
  const token = cookieStore.get("aha_session")?.value ?? null;
  const sessionUser = getSession(token);

  if (!sessionUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const backups = getBackupSnapshotsForUser(sessionUser.id);
  return NextResponse.json({ backups }, { status: 200 });
}

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const token = cookieStore.get("aha_session")?.value ?? null;
  const sessionUser = getSession(token);

  if (!sessionUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as { label?: string };
  const label = sanitize(body.label) || "manual-backup";

  const backup = createBackupSnapshot(sessionUser.id, label);
  return NextResponse.json({ backup }, { status: 201 });
}
