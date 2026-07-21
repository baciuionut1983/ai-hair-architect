import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { randomUUID } from "crypto";

import { resolveOpsSessionUser, runPersistentRetention } from "@/lib/ops-persistence";

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const token = cookieStore.get("aha_session")?.value ?? null;
  const sessionUser = await resolveOpsSessionUser(token);

  if (!sessionUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as {
    olderThanDays?: number;
    dryRun?: boolean;
    confirmationToken?: string;
    executionIdempotencyKey?: string;
    reason?: string;
  };

  const olderThanDays = Number.isFinite(body.olderThanDays) ? Number(body.olderThanDays) : 30;
  const dryRun = body.dryRun !== false;

  const response = await runPersistentRetention({
    userId: sessionUser.id,
    olderThanDays,
    dryRun,
    confirmationToken: body.confirmationToken,
    executionIdempotencyKey: body.executionIdempotencyKey,
    reason: body.reason,
    correlationRequestId: randomUUID(),
  });

  return NextResponse.json(response.body, { status: response.httpStatus });
}
