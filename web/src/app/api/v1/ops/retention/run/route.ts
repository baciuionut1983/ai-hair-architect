import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { getSession, runRetentionJobForUser } from "@/lib/milestone1-store";

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const token = cookieStore.get("aha_session")?.value ?? null;
  const sessionUser = getSession(token);

  if (!sessionUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as {
    olderThanDays?: number;
    dryRun?: boolean;
  };

  const olderThanDays = Number.isFinite(body.olderThanDays) ? Math.max(1, Number(body.olderThanDays)) : 30;
  const dryRun = body.dryRun !== false;

  const result = runRetentionJobForUser({
    userId: sessionUser.id,
    olderThanDays,
    dryRun
  });

  return NextResponse.json({ result }, { status: 200 });
}
